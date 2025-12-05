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

// ---------- API Endpoints ---------- //

// Get full trip data
app.get('/api/trip', (req, res) => {
    const data = readData();
    res.json(data);
});

// Create or update trip details (setup)
app.post('/api/trip', async (req, res) => {
    const data = readData();
    const { tripName, budget, memberCount, tripDate, adminPin, clearData } = req.body;

    console.log('>>> Setup Trip:', { tripName, adminPin });

    // If clearData is requested (New Trip Setup)
    if (clearData) {
        console.log('>>> Clearing old trip data for new setup');
        data.members = [];
        data.expenses = [];
        data.pendingExpenses = [];
        data.pendingMembers = [];
        data.pendingContributions = [];
        data.pendingBudgetRequests = [];
        data.pendingDeletions = [];
        // Clear trip code to force generation of new code
        data.tripCode = '';
    }

    data.tripName = tripName;
    data.budget = parseFloat(budget) || 0;
    data.memberCount = parseInt(memberCount) || 0;
    data.tripDate = tripDate;
    if (adminPin) {
        data.adminPin = adminPin;
        console.log('>>> Admin PIN saved:', data.adminPin);
    }
    // Always generate new code if empty (including after clearData)
    if (!data.tripCode) {
        data.tripCode = await generateTripCode();
        console.log('>>> New trip code generated:', data.tripCode);
    }

    recalculateState(data);
    writeData(data);
    res.json({ message: 'Trip details updated', data });
});

// Join trip
app.post('/api/join', (req, res) => {
    const { code, name, pin } = req.body;
    const data = readData();

    console.log('>>> Join Request:', { code, name, pin });
    console.log('>>> Stored Admin PIN:', data.adminPin);

    if (data.tripCode !== code) {
        return res.status(400).json({ message: 'Invalid Trip Code' });
    }

    const isAdmin = data.members.length > 0 && data.members[0].name.toLowerCase() === name.toLowerCase();
    console.log('>>> Is Admin?', isAdmin);

    if (isAdmin) {
        if (!data.adminPin) {
            console.log('>>> No Admin PIN stored (Legacy)');
        } else if (!pin) {
            console.log('>>> PIN required but not provided');
            return res.json({ status: 'require_pin', message: 'Admin PIN required' });
        } else if (pin !== data.adminPin) {
            console.log('>>> Invalid PIN provided');
            return res.status(401).json({ message: 'Invalid Admin PIN' });
        } else {
            console.log('>>> PIN verified successfully');
        }
    }

    const existing = data.members.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        return res.json({ message: 'Welcome back!', member: existing, data });
    }

    const adminName = data.members.length > 0 ? data.members[0].name : 'Admin';

    if (data.members.length >= data.memberCount) {
        return res.status(400).json({
            message: `Member limit exceeded. Please contact admin (${adminName}).`
        });
    }

    const pending = data.pendingMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (pending) {
        return res.json({ message: 'Join request already pending', status: 'pending' });
    }

    const request = { id: Date.now().toString(), name, status: 'pending' };
    data.pendingMembers.push(request);
    writeData(data);
    res.json({ message: 'Join request sent to Admin', status: 'pending', data });
});

// Admin adds a member directly
app.post('/api/members', (req, res) => {
    const data = readData();
    const newMember = req.body;
    if (!newMember.id) newMember.id = Date.now().toString();
    data.members.push(newMember);
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Member added', member: newMember, data });
});

// Update member details (Admin only)
app.post('/api/members/update', (req, res) => {
    const { id, name, expectedContribution, actualContribution, personal, balance, customExpected, customPersonal, customBalance } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === id);

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

    recalculateState(data);
    writeData(data);

    console.log('>>> Final member data:', member);
    res.json({ message: 'Member updated successfully', member, data });
});

// Update member activity (lastActive timestamp)
app.post('/api/members/activity', (req, res) => {
    const { memberId } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === memberId);

    if (member) {
        member.lastActive = new Date().toISOString();
        writeData(data);
    }

    res.json({ success: true });
});

// Member contribution update
app.post('/api/members/contribute', (req, res) => {
    const { id, amount, isAdmin } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const contrib = parseFloat(amount);
    if (isNaN(contrib)) return res.status(400).json({ message: 'Invalid amount' });

    if (!isAdmin) {
        return res.status(403).json({ message: 'Members must request contribution approval' });
    }

    member.actualContribution = (member.actualContribution || 0) + contrib;
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Contribution updated', member, data });
});

// Member requests to add contribution
app.post('/api/contributions/request', (req, res) => {
    const { memberId, amount, memberName } = req.body;
    const data = readData();

    const request = {
        id: Date.now().toString(),
        memberId,
        memberName,
        amount: parseFloat(amount),
        timestamp: new Date().toISOString()
    };

    data.pendingContributions.push(request);
    writeData(data);
    res.json({ message: 'Contribution request sent for approval', data });
});

// Admin approves or rejects contribution request
app.post('/api/contributions/approve', (req, res) => {
    const { id, action } = req.body;
    const data = readData();

    const requestIndex = data.pendingContributions.findIndex(r => r.id === id);
    if (requestIndex === -1) return res.status(404).json({ message: 'Request not found' });

    const request = data.pendingContributions[requestIndex];

    if (action === 'approve') {
        const member = data.members.find(m => m.id === request.memberId);
        if (member) {
            member.actualContribution = (member.actualContribution || 0) + request.amount;
            recalculateState(data);
        }
    }

    data.pendingContributions.splice(requestIndex, 1);
    writeData(data);
    res.json({ message: `Contribution ${action}d`, data });
});

// Settle/Reimburse a member's personal expenses
app.post('/api/members/reimburse', (req, res) => {
    const { id, amount } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === id);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const reimburseAmount = parseFloat(amount);
    if (isNaN(reimburseAmount) || reimburseAmount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
    }

    member.reimbursed = (member.reimbursed || 0) + reimburseAmount;

    recalculateState(data);
    writeData(data);
    res.json({ message: 'Member reimbursed', member, data });
});

// Refund a member's overpaid contribution
app.post('/api/members/refund', (req, res) => {
    const { id, amount } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === id);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const refundAmount = parseFloat(amount);
    if (isNaN(refundAmount) || refundAmount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
    }

    member.actualContribution = (member.actualContribution || 0) - refundAmount;

    recalculateState(data);
    writeData(data);
    res.json({ message: 'Member refunded', member, data });
});

// Admin adds an expense directly
app.post('/api/expenses', (req, res) => {
    const data = readData();
    const newExpense = req.body;
    if (!newExpense.id) newExpense.id = Date.now().toString();
    data.expenses.push(newExpense);
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Expense added', expense: newExpense, data });
});

// Member requests an expense
app.post('/api/expenses/request', (req, res) => {
    const data = readData();
    const newExpense = req.body;
    if (!newExpense.id) newExpense.id = Date.now().toString();
    newExpense.status = 'pending';
    data.pendingExpenses.push(newExpense);
    writeData(data);
    res.json({ message: 'Expense request sent to Admin', expense: newExpense, data });
});

// Approve or reject a pending expense
app.post('/api/expenses/approve', (req, res) => {
    const { id, action } = req.body;
    const data = readData();
    const idx = data.pendingExpenses.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ message: 'Request not found' });
    const expense = data.pendingExpenses[idx];
    if (action === 'approve') {
        delete expense.status;
        data.expenses.push(expense);
        recalculateState(data);
    }
    data.pendingExpenses.splice(idx, 1);
    writeData(data);
    res.json({ message: `Expense ${action}d`, data });
});

// Approve or reject a pending member
app.post('/api/members/approve', (req, res) => {
    const { id, action, memberDetails } = req.body;
    const data = readData();
    const idx = data.pendingMembers.findIndex(m => m.id === id);
    if (idx === -1) return res.status(404).json({ message: 'Request not found' });

    console.log('=== MEMBER APPROVAL DEBUG ===');
    console.log('Before approval - Member count:', data.members.length);
    console.log('Before approval - Members:', data.members.map(m => ({ name: m.name, expected: m.expectedContribution })));

    if (action === 'approve') {
        const memberName = memberDetails?.name || data.pendingMembers[idx].name;

        const newMember = {
            id: Date.now().toString(),
            name: memberName,
            expectedContribution: 0,
            actualContribution: 0,
            remainingContribution: 0,
            balance: 0,
            personal: 0
        };

        data.members.push(newMember);

        console.log('After adding member - Member count:', data.members.length);

        recalculateState(data);

        console.log('After recalculation - Members:', data.members.map(m => ({ name: m.name, expected: m.expectedContribution })));
        console.log('Budget:', data.budget);
    }
    data.pendingMembers.splice(idx, 1);
    writeData(data);

    console.log('=== END DEBUG ===');
    res.json({ message: `Member ${action}d`, data });
});

// Delete a member
app.delete('/api/members/:id', (req, res) => {
    const { id } = req.params;
    const data = readData();

    const memberIdx = data.members.findIndex(m => m.id === id);
    if (memberIdx === -1) return res.status(404).json({ message: 'Member not found' });

    // Prevent deleting admin (first member)
    if (memberIdx === 0) {
        return res.status(403).json({ message: 'Cannot delete admin' });
    }

    data.members.splice(memberIdx, 1);
    recalculateState(data);
    writeData(data);

    res.json({ message: 'Member deleted', data });
});

// Member requests account deletion
app.post('/api/members/delete-request', (req, res) => {
    const { memberId, memberName } = req.body;
    const data = readData();

    const exists = data.pendingDeletions.find(d => d.memberId === memberId);
    if (exists) {
        return res.status(400).json({ message: 'Deletion request already pending' });
    }

    const request = {
        id: Date.now().toString(),
        memberId,
        memberName,
        timestamp: new Date().toISOString()
    };

    data.pendingDeletions.push(request);
    writeData(data);
    res.json({ message: 'Deletion request sent for approval', data });
});

// Admin approves or rejects member deletion request
app.post('/api/members/delete-approve', (req, res) => {
    const { id, action } = req.body;
    const data = readData();

    const requestIndex = data.pendingDeletions.findIndex(r => r.id === id);
    if (requestIndex === -1) return res.status(404).json({ message: 'Request not found' });

    const request = data.pendingDeletions[requestIndex];

    if (action === 'approve') {
        const memberIndex = data.members.findIndex(m => m.id === request.memberId);
        if (memberIndex !== -1 && memberIndex !== 0) { // Don't delete admin
            data.members.splice(memberIndex, 1);
            recalculateState(data);
        }
    }

    data.pendingDeletions.splice(requestIndex, 1);
    writeData(data);
    res.json({ message: `Deletion ${action}d`, data, deletedMemberId: action === 'approve' ? request.memberId : null });
});

// Delete an expense
app.delete('/api/expenses/:id', (req, res) => {
    const { id } = req.params;
    const data = readData();

    data.expenses = data.expenses.filter(e => e.id !== id);
    recalculateState(data);
    writeData(data);

    res.json({ message: 'Expense deleted', data });
});

// Reset the entire app state
app.post('/api/reset', (req, res) => {
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
    res.json({ message: 'App reset successfully', data: emptyData });
});

// Reset member data (keep trip and admin)
app.post('/api/reset-data', (req, res) => {
    const data = readData();

    // Keep admin (first member) but reset their stats
    if (data.members.length > 0) {
        const admin = data.members[0];
        admin.actualContribution = 0;
        admin.expectedContribution = 0;
        admin.remainingContribution = 0;
        admin.balance = 0;
        admin.personal = 0;
        admin.reimbursed = 0;
        data.members = [admin];
    } else {
        data.members = [];
    }

    // Clear all other data
    data.expenses = [];
    data.pendingExpenses = [];
    data.pendingMembers = [];
    data.pendingContributions = [];
    data.pendingBudgetRequests = [];
    data.pendingDeletions = [];

    recalculateState(data);
    writeData(data);

    res.json({ message: 'Member data reset successfully', data });
});

// Budget Increase Request
app.post('/api/budget/request', (req, res) => {
    const { memberId, amount, reason } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === memberId);

    if (!member) return res.status(404).json({ message: 'Member not found' });

    const request = {
        id: Date.now().toString(),
        memberId,
        memberName: member.name,
        amount: parseFloat(amount),
        reason: reason || 'Extra contribution',
        timestamp: new Date().toISOString()
    };

    data.pendingBudgetRequests.push(request);
    writeData(data);

    res.json({ message: 'Budget increase request sent to Admin', data });
});

// Delete/Handle Budget Request
app.delete('/api/budget/request/:id', (req, res) => {
    const { id } = req.params;
    const data = readData();

    data.pendingBudgetRequests = data.pendingBudgetRequests.filter(r => r.id !== id);
    writeData(data);

    res.json({ message: 'Request processed', data });
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
