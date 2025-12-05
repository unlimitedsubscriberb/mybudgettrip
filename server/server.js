// server.js - Trip Budget Manager backend with Hybrid Storage (JSON + MongoDB)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const Trip = require('./models/Trip');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/trip-budget-manager';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// MongoDB connection (non-blocking)
let mongoConnected = false;
mongoose.connect(MONGODB_URI).then(() => {
    console.log('✅ Connected to MongoDB (backup storage)');
    mongoConnected = true;
    // Load from MongoDB on startup if JSON is empty
    loadFromMongoDBOnStartup();
}).catch(err => {
    console.warn('⚠️  MongoDB connection failed (using JSON only):', err.message);
    mongoConnected = false;
});

// Helper to generate random 6-character trip code
const generateTripCode = async () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!isUnique && attempts < maxAttempts) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Check uniqueness in JSON
        const data = readData();
        let jsonUnique = !data.tripCode || data.tripCode !== code;

        // Also check MongoDB if connected
        let mongoUnique = true;
        if (mongoConnected) {
            try {
                const existingTrip = await Trip.findOne({ tripCode: code });
                mongoUnique = !existingTrip;
            } catch (err) {
                console.warn('MongoDB uniqueness check failed:', err.message);
            }
        }

        isUnique = jsonUnique && mongoUnique;
        attempts++;
    }

    console.log(`Generated trip code: ${code} (attempts: ${attempts})`);
    return code;
};

// Read data from JSON file (PRIMARY STORAGE)
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        return {
            tripName: "",
            tripCode: "",
            budget: 0,
            memberCount: 0,
            tripDate: "",
            adminPin: "",
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: [],
            pendingContributions: [],
            pendingBudgetRequests: [],
            pendingDeletions: []
        };
    }
    const raw = fs.readFileSync(DATA_FILE);
    return JSON.parse(raw);
};

// Write data to JSON file (PRIMARY STORAGE)
const writeData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    // Sync to MongoDB in background (non-blocking)
    syncToMongoDB(data);
};

// Sync to MongoDB (BACKUP STORAGE - non-blocking)
const syncToMongoDB = async (data) => {
    if (!mongoConnected) return;

    try {
        // Find existing trip or create new one
        let trip = await Trip.findOne();
        if (!trip) {
            trip = new Trip(data);
        } else {
            // Update all fields
            Object.assign(trip, data);
        }
        await trip.save();
        console.log('📦 Synced to MongoDB backup');
    } catch (error) {
        console.warn('⚠️  MongoDB sync failed:', error.message);
    }
};

// Load from MongoDB on startup (if JSON is empty)
const loadFromMongoDBOnStartup = async () => {
    try {
        const jsonData = readData();
        // Only load from MongoDB if JSON is empty
        if (!jsonData.tripName && !jsonData.tripCode) {
            const trip = await Trip.findOne();
            if (trip) {
                console.log('📥 Loading data from MongoDB backup...');
                const mongoData = trip.toObject();
                delete mongoData._id;
                delete mongoData.__v;
                delete mongoData.createdAt;
                delete mongoData.updatedAt;
                writeData(mongoData);
                console.log('✅ Data restored from MongoDB');
            }
        }
    } catch (error) {
        console.warn('⚠️  MongoDB load failed:', error.message);
    }
};

// Recalculate state
const recalculateState = (data) => {
    if (!data.members) data.members = [];
    const actualMemberCount = data.members.length;

    console.log('>>> recalculateState called');
    console.log('>>> Budget:', data.budget);
    console.log('>>> Member count:', actualMemberCount);

    const expected = actualMemberCount > 0 ? data.budget / actualMemberCount : 0;

    console.log('>>> Expected per member:', expected);

    // Initialize member stats
    data.members.forEach(m => {
        if (!m.id) m.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);

        if (!m.customExpected) {
            m.expectedContribution = expected;
        }

        if (!m.customPersonal) {
            m.personal = 0;
        }

        if (typeof m.reimbursed !== 'number') m.reimbursed = 0;
        if (typeof m.actualContribution !== 'number') m.actualContribution = 0;
    });

    // Calculate individual expense shares for each member
    data.members.forEach(m => {
        m.expenseShare = 0; // Initialize expense share (what they owe)
        if (!m.customPersonal) {
            m.personal = 0; // Initialize personal (what they paid from pocket - needs reimbursement)
        }
    });

    data.expenses.forEach(e => {
        const amount = parseFloat(e.amount) || 0;

        // Track who paid for this expense (for reimbursement)
        if (e.paidBy && e.paidBy !== 'pool') {
            const payer = data.members.find(m => m.id === e.paidBy);
            if (payer && !payer.customPersonal) {
                payer.personal += amount; // They paid from pocket, need reimbursement
            }
        }

        // Determine which members to split this expense between (who owes)
        let splitMembers = [];
        if (e.splitBetween && Array.isArray(e.splitBetween) && e.splitBetween.length > 0) {
            // New format: explicit splitBetween array
            splitMembers = e.splitBetween;
        } else if (e.paidBy) {
            // Legacy format: convert paidBy to splitBetween
            if (e.paidBy === 'all_members' || e.paidBy === 'pool') {
                splitMembers = data.members.map(m => m.id);
            } else {
                splitMembers = [e.paidBy];
            }
        }

        // Split expense among selected members
        if (splitMembers.length > 0) {
            const sharePerMember = amount / splitMembers.length;
            splitMembers.forEach(memberId => {
                const member = data.members.find(m => m.id === memberId);
                if (member) {
                    member.expenseShare += sharePerMember;
                }
            });
        }
    });

    // Finalize member balances
    data.members.forEach(m => {
        const actual = m.actualContribution || 0;
        m.remainingContribution = Math.max(m.expectedContribution - actual, 0);

        const netPersonal = Math.max(m.personal - (m.reimbursed || 0), 0);

        if (!m.customBalance) {
            const balance = actual + netPersonal - m.expenseShare;
            m.balance = Math.round(balance * 100) / 100;
        }
    });

    console.log('>>> After recalc, members:', data.members.map(m => ({ name: m.name, expected: m.expectedContribution })));
    console.log('>>> Total expected:', data.members.reduce((sum, m) => sum + m.expectedContribution, 0));
};

// Helper function to get trip by code (MongoDB or fallback to data.json)
const getTripByCode = async (tripCode) => {
    if (!tripCode) {
        // Fallback to data.json for backward compatibility
        return readData();
    }

    if (mongoConnected) {
        const trip = await Trip.findOne({ tripCode });
        return trip;
    }

    // If MongoDB not connected, check data.json
    const data = readData();
    if (data.tripCode === tripCode) {
        return data;
    }

    return null;
};

// Helper function to save trip (MongoDB and data.json)
const saveTrip = async (trip) => {
    if (mongoConnected && trip._id) {
        // It's a Mongoose document
        await trip.save();
    }

    // Also save to data.json for backward compatibility
    const tripData = trip.toObject ? trip.toObject() : trip;
    writeData(tripData);

    return trip;
};

// ---------- API Endpoints ---------- //

// Get trip data by tripCode
app.get('/api/trip/:tripCode?', async (req, res) => {
    try {
        const { tripCode } = req.params;

        // If no tripCode provided, try to get from data.json (backward compatibility)
        if (!tripCode) {
            const data = readData();
            return res.json(data);
        }

        // Query MongoDB for specific trip
        const trip = await Trip.findOne({ tripCode });

        if (!trip) {
            return res.status(404).json({ message: 'Trip not found' });
        }

        res.json(trip);
    } catch (error) {
        console.error('Error fetching trip:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create or update trip details (setup)
app.post('/api/trip', async (req, res) => {
    try {
        const { tripName, budget, memberCount, tripDate, adminPin, clearData, tripCode } = req.body;

        console.log('>>> Setup Trip:', { tripName, adminPin, tripCode, clearData });

        // If tripCode is provided, update existing trip
        if (tripCode && !clearData) {
            const trip = await Trip.findOne({ tripCode });
            if (!trip) {
                return res.status(404).json({ message: 'Trip not found' });
            }

            trip.tripName = tripName;
            trip.budget = parseFloat(budget) || 0;
            trip.memberCount = parseInt(memberCount) || 0;
            trip.tripDate = tripDate;
            if (adminPin) trip.adminPin = adminPin;

            recalculateState(trip);
            await trip.save();

            // Also update data.json for backward compatibility
            writeData(trip.toObject());

            return res.json({ message: 'Trip updated', data: trip });
        }

        // Create NEW trip
        const newTripCode = await generateTripCode();
        console.log('>>> New trip code generated:', newTripCode);

        const newTrip = new Trip({
            tripCode: newTripCode,
            tripName,
            budget: parseFloat(budget) || 0,
            memberCount: parseInt(memberCount) || 0,
            tripDate,
            adminPin: adminPin || '',
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: [],
            pendingContributions: [],
            pendingBudgetRequests: [],
            pendingDeletions: []
        });

        await newTrip.save();
        console.log('>>> New trip created in MongoDB:', newTripCode);

        // Also write to data.json for backward compatibility
        writeData(newTrip.toObject());

        res.json({ message: 'Trip created', data: newTrip, tripCode: newTripCode });
    } catch (error) {
        console.error('Error creating/updating trip:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Join trip
app.post('/api/join', async (req, res) => {
    try {
        const { code, name, pin } = req.body;

        console.log('>>> Join Request:', { code, name, pin });

        const trip = await getTripByCode(code);

        if (!trip) {
            return res.status(400).json({ message: 'Invalid Trip Code' });
        }

        console.log('>>> Stored Admin PIN:', trip.adminPin);

        const isAdmin = trip.members.length > 0 && trip.members[0].name.toLowerCase() === name.toLowerCase();
        console.log('>>> Is Admin?', isAdmin);

        if (isAdmin) {
            if (!trip.adminPin) {
                console.log('>>> No Admin PIN stored (Legacy)');
            } else if (!pin) {
                console.log('>>> PIN required but not provided');
                return res.json({ status: 'require_pin', message: 'Admin PIN required' });
            } else if (pin !== trip.adminPin) {
                console.log('>>> Invalid PIN provided');
                return res.status(401).json({ message: 'Invalid Admin PIN' });
            } else {
                console.log('>>> PIN verified successfully');
            }
        }

        const existing = trip.members.find(m => m.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            return res.json({ message: 'Welcome back!', member: existing, data: trip, tripCode: code });
        }

        const adminName = trip.members.length > 0 ? trip.members[0].name : 'Admin';

        if (trip.members.length >= trip.memberCount) {
            return res.status(400).json({
                message: `Member limit exceeded. Please contact admin (${adminName}).`
            });
        }

        const pending = trip.pendingMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
        if (pending) {
            return res.json({ message: 'Join request already pending', status: 'pending', tripCode: code });
        }

        const request = { id: Date.now().toString(), name, status: 'pending' };
        trip.pendingMembers.push(request);
        await saveTrip(trip);

        res.json({ message: 'Join request sent to Admin', status: 'pending', data: trip, tripCode: code });
    } catch (error) {
        console.error('Error joining trip:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Admin adds a member directly
app.post('/api/members', async (req, res) => {
    try {
        const { tripCode, ...newMember } = req.body;
        const trip = await getTripByCode(tripCode);

        if (!trip) {
            return res.status(404).json({ message: 'Trip not found' });
        }

        if (!newMember.id) newMember.id = Date.now().toString();
        trip.members.push(newMember);
        recalculateState(trip);
        await saveTrip(trip);
        res.json({ message: 'Member added', member: newMember, data: trip, tripCode });
    } catch (error) {
        console.error('Error adding member:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update member details (Admin only)
app.post('/api/members/update', async (req, res) => {
    try {
        const { tripCode, id, name, expectedContribution, actualContribution, personal, balance, customExpected, customPersonal, customBalance } = req.body;
        const trip = await getTripByCode(tripCode);

        if (!trip) {
            return res.status(404).json({ message: 'Trip not found' });
        }

        const member = trip.members.find(m => m.id === id);

        console.log('>>> Member Update Request:', { id, name, expectedContribution, actualContribution, personal, balance, customExpected, customPersonal, customBalance });

        if (!member) return res.status(404).json({ message: 'Member not found' });

        console.log('>>> Before update - Member name:', member.name);

        if (name && name.trim()) {
            member.name = name.trim();
            console.log('>>> After update - Member name:', member.name);
        }

        if (customExpected) {
            member.customExpected = true;
            member.expectedContribution = parseFloat(expectedContribution) || 0;
        } else {
            member.customExpected = false;
        }

        if (customPersonal) {
            member.customPersonal = true;
            member.personal = parseFloat(personal) || 0;
        } else {
            member.customPersonal = false;
        }

        if (customBalance) {
            member.customBalance = true;
            member.balance = parseFloat(balance) || 0;
        } else {
            member.customBalance = false;
        }

        member.actualContribution = parseFloat(actualContribution) || 0;

        recalculateState(trip);
        await saveTrip(trip);

        console.log('>>> Final member data:', member);
        res.json({ message: 'Member updated successfully', member, data: trip, tripCode });
    } catch (error) {
        console.error('Error updating member:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update member activity (lastActive timestamp)
app.post('/api/members/activity', async (req, res) => {
    try {
        const { tripCode, memberId } = req.body;
        const trip = await getTripByCode(tripCode);

        if (!trip) {
            return res.status(404).json({ message: 'Trip not found' });
        }

        const member = trip.members.find(m => m.id === memberId);

        if (member) {
            member.lastActive = new Date().toISOString();
            await saveTrip(trip);
        }

        res.json({ success: true, tripCode });
    } catch (error) {
        console.error('Error updating activity:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Member contribution update
app.post('/api/members/contribute', async (req, res) => {
    try {
        const { tripCode, id, amount, isAdmin } = req.body;
        const trip = await getTripByCode(tripCode);

        if (!trip) {
            return res.status(404).json({ message: 'Trip not found' });
        }

        const member = trip.members.find(m => m.id === id);
        if (!member) return res.status(404).json({ message: 'Member not found' });
        const contrib = parseFloat(amount);
        if (isNaN(contrib)) return res.status(400).json({ message: 'Invalid amount' });

        if (!isAdmin) {
            return res.status(403).json({ message: 'Members must request contribution approval' });
        }

        // Calculate remaining contribution needed
        const remaining = Math.max(member.expectedContribution - (member.actualContribution || 0), 0);

        // If paying more than remaining, add excess to personal
        if (contrib > remaining && remaining > 0) {
            const excess = contrib - remaining;
            member.actualContribution = (member.actualContribution || 0) + remaining;
            member.personal = (member.personal || 0) + excess;
            console.log(`>>> Overpayment detected: ₹${excess} added to personal expenses`);
        } else {
            member.actualContribution = (member.actualContribution || 0) + contrib;
        }

        recalculateState(trip);
        await saveTrip(trip);
        res.json({ message: 'Contribution updated', member, data: trip, tripCode });
    } catch (error) {
        console.error('Error updating contribution:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Member requests to add contribution
app.post('/api/contributions/request', async (req, res) => {
    try {
        const { tripCode, memberId, amount, memberName } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const request = {
            id: Date.now().toString(),
            memberId,
            memberName,
            amount: parseFloat(amount),
            timestamp: new Date().toISOString()
        };

        trip.pendingContributions.push(request);
        await saveTrip(trip);
        res.json({ message: 'Contribution request sent for approval', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin approves or rejects contribution request
app.post('/api/contributions/approve', async (req, res) => {
    try {
        const { tripCode, id, action } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const requestIndex = trip.pendingContributions.findIndex(r => r.id === id);
        if (requestIndex === -1) return res.status(404).json({ message: 'Request not found' });

        const request = trip.pendingContributions[requestIndex];

        if (action === 'approve') {
            const member = trip.members.find(m => m.id === request.memberId);
            if (member) {
                member.actualContribution = (member.actualContribution || 0) + request.amount;
                recalculateState(trip);
            }
        }

        trip.pendingContributions.splice(requestIndex, 1);
        await saveTrip(trip);
        res.json({ message: `Contribution ${action}d`, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Settle/Reimburse a member's personal expenses
app.post('/api/members/reimburse', async (req, res) => {
    try {
        const { tripCode, id, amount } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const member = trip.members.find(m => m.id === id);
        if (!member) return res.status(404).json({ message: 'Member not found' });

        const reimburseAmount = parseFloat(amount);
        if (isNaN(reimburseAmount) || reimburseAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        member.reimbursed = (member.reimbursed || 0) + reimburseAmount;
        recalculateState(trip);
        await saveTrip(trip);
        res.json({ message: 'Member reimbursed', member, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Refund a member's overpaid contribution
app.post('/api/members/refund', async (req, res) => {
    try {
        const { tripCode, id, amount } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const member = trip.members.find(m => m.id === id);
        if (!member) return res.status(404).json({ message: 'Member not found' });

        const refundAmount = parseFloat(amount);
        if (isNaN(refundAmount) || refundAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        member.actualContribution = (member.actualContribution || 0) - refundAmount;
        recalculateState(trip);
        await saveTrip(trip);
        res.json({ message: 'Member refunded', member, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin adds an expense directly
app.post('/api/expenses', async (req, res) => {
    try {
        const { tripCode, ...newExpense } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        if (!newExpense.id) newExpense.id = Date.now().toString();
        trip.expenses.push(newExpense);
        recalculateState(trip);
        await saveTrip(trip);
        res.json({ message: 'Expense added', expense: newExpense, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Member requests an expense
app.post('/api/expenses/request', async (req, res) => {
    try {
        const { tripCode, ...newExpense } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        if (!newExpense.id) newExpense.id = Date.now().toString();
        newExpense.status = 'pending';
        trip.pendingExpenses.push(newExpense);
        await saveTrip(trip);
        res.json({ message: 'Expense request sent to Admin', expense: newExpense, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve or reject a pending expense
app.post('/api/expenses/approve', async (req, res) => {
    try {
        const { tripCode, id, action } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const idx = trip.pendingExpenses.findIndex(e => e.id === id);
        if (idx === -1) return res.status(404).json({ message: 'Request not found' });
        const expense = trip.pendingExpenses[idx];
        if (action === 'approve') {
            delete expense.status;
            trip.expenses.push(expense);
            recalculateState(trip);
        }
        trip.pendingExpenses.splice(idx, 1);
        await saveTrip(trip);
        res.json({ message: `Expense ${action}d`, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve or reject a pending member
app.post('/api/members/approve', async (req, res) => {
    try {
        const { tripCode, id, action, memberDetails } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const idx = trip.pendingMembers.findIndex(m => m.id === id);
        if (idx === -1) return res.status(404).json({ message: 'Request not found' });

        console.log('=== MEMBER APPROVAL DEBUG ===');
        console.log('Before approval - Member count:', trip.members.length);
        console.log('Before approval - Members:', trip.members.map(m => ({ name: m.name, expected: m.expectedContribution })));

        if (action === 'approve') {
            const memberName = memberDetails?.name || trip.pendingMembers[idx].name;

            const newMember = {
                id: Date.now().toString(),
                name: memberName,
                expectedContribution: 0,
                actualContribution: 0,
                remainingContribution: 0,
                balance: 0,
                personal: 0
            };

            trip.members.push(newMember);

            console.log('After adding member - Member count:', trip.members.length);

            recalculateState(trip);

            console.log('After recalculation - Members:', trip.members.map(m => ({ name: m.name, expected: m.expectedContribution })));
            console.log('Budget:', trip.budget);
        }
        trip.pendingMembers.splice(idx, 1);
        await saveTrip(trip);

        console.log('=== END DEBUG ===');
        res.json({ message: `Member ${action}d`, data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a member
app.delete('/api/members/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { tripCode } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const memberIdx = trip.members.findIndex(m => m.id === id);
        if (memberIdx === -1) return res.status(404).json({ message: 'Member not found' });

        // Prevent deleting admin (first member)
        if (memberIdx === 0) {
            return res.status(403).json({ message: 'Cannot delete admin' });
        }

        trip.members.splice(memberIdx, 1);
        recalculateState(trip);
        await saveTrip(trip);

        res.json({ message: 'Member deleted', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Member requests account deletion
app.post('/api/members/delete-request', async (req, res) => {
    try {
        const { tripCode, memberId, memberName } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const exists = trip.pendingDeletions.find(d => d.memberId === memberId);
        if (exists) {
            return res.status(400).json({ message: 'Deletion request already pending' });
        }

        const request = {
            id: Date.now().toString(),
            memberId,
            memberName,
            timestamp: new Date().toISOString()
        };

        trip.pendingDeletions.push(request);
        await saveTrip(trip);
        res.json({ message: 'Deletion request sent for approval', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin approves or rejects member deletion request
app.post('/api/members/delete-approve', async (req, res) => {
    try {
        const { tripCode, id, action } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const requestIndex = trip.pendingDeletions.findIndex(r => r.id === id);
        if (requestIndex === -1) return res.status(404).json({ message: 'Request not found' });

        const request = trip.pendingDeletions[requestIndex];

        if (action === 'approve') {
            const memberIndex = trip.members.findIndex(m => m.id === request.memberId);
            if (memberIndex !== -1 && memberIndex !== 0) { // Don't delete admin
                trip.members.splice(memberIndex, 1);
                recalculateState(trip);
            }
        }

        trip.pendingDeletions.splice(requestIndex, 1);
        await saveTrip(trip);
        res.json({ message: `Deletion ${action}d`, data: trip, tripCode, deletedMemberId: action === 'approve' ? request.memberId : null });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete an expense
app.delete('/api/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { tripCode } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        trip.expenses = trip.expenses.filter(e => e.id !== id);
        recalculateState(trip);
        await saveTrip(trip);

        res.json({ message: 'Expense deleted', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Reset the entire app state
app.post('/api/reset', async (req, res) => {
    try {
        const { tripCode } = req.body;

        if (!tripCode) {
            return res.status(400).json({ message: 'Trip code required' });
        }

        // Delete the specific trip from MongoDB
        if (mongoConnected) {
            await Trip.deleteOne({ tripCode });
        }

        // Clear data.json
        const emptyData = {
            tripName: "",
            tripCode: "",
            budget: 0,
            memberCount: 0,
            tripDate: "",
            adminPin: "",
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: [],
            pendingContributions: [],
            pendingBudgetRequests: [],
            pendingDeletions: []
        };
        writeData(emptyData);
        res.json({ message: 'Trip deleted successfully', data: emptyData });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Reset member data (keep trip and admin)
// Reset member data (keep trip and admin)
app.post('/api/reset-data', async (req, res) => {
    try {
        const { tripCode } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        // Keep admin (first member) but reset their stats
        if (trip.members.length > 0) {
            const admin = trip.members[0];
            admin.actualContribution = 0;
            admin.expectedContribution = 0;
            admin.remainingContribution = 0;
            admin.balance = 0;
            admin.personal = 0;
            admin.reimbursed = 0;
            trip.members = [admin];
        } else {
            trip.members = [];
        }

        // Clear all other data
        trip.expenses = [];
        trip.pendingExpenses = [];
        trip.pendingMembers = [];
        trip.pendingContributions = [];
        trip.pendingBudgetRequests = [];
        trip.pendingDeletions = [];

        recalculateState(trip);
        await saveTrip(trip);

        res.json({ message: 'Member data reset successfully', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Budget Increase Request
app.post('/api/budget/request', async (req, res) => {
    try {
        const { tripCode, memberId, amount, reason } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        const member = trip.members.find(m => m.id === memberId);

        if (!member) return res.status(404).json({ message: 'Member not found' });

        const request = {
            id: Date.now().toString(),
            memberId,
            memberName: member.name,
            amount: parseFloat(amount),
            reason: reason || 'Extra contribution',
            timestamp: new Date().toISOString()
        };

        trip.pendingBudgetRequests.push(request);
        await saveTrip(trip);

        res.json({ message: 'Budget increase request sent to Admin', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete/Handle Budget Request
// Delete/Handle Budget Request
app.delete('/api/budget/request/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { tripCode } = req.body;
        const trip = await getTripByCode(tripCode);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });

        trip.pendingBudgetRequests = trip.pendingBudgetRequests.filter(r => r.id !== id);
        await saveTrip(trip);

        res.json({ message: 'Request processed', data: trip, tripCode });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Keep-alive mechanism
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes

function startKeepAlive() {
    if (!RENDER_URL) {
        console.log('ℹ️  Keep-alive disabled (not on Render)');
        return;
    }

    setInterval(() => {
        const pingUrl = `${RENDER_URL}/api/trip`;

        https.get(pingUrl, (res) => {
            const timestamp = new Date().toLocaleTimeString('en-IN');
            console.log(`🏓 Keep-alive ping successful [${timestamp}] - Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('❌ Keep-alive ping failed:', err.message);
        });
    }, KEEP_ALIVE_INTERVAL);

    console.log('✅ Keep-alive mechanism activated (pinging every 14 minutes)');
    console.log(`📍 Target URL: ${RENDER_URL}`);
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('💾 Storage: JSON (primary) + MongoDB (backup)');

    // Force recalculation on startup
    try {
        const data = readData();
        console.log('Performing startup recalculation...');
        recalculateState(data);
        writeData(data);
        console.log('Startup recalculation complete.');
    } catch (error) {
        console.error('Startup recalculation failed:', error);
    }

    startKeepAlive();
});
