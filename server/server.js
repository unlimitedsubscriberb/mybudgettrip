// server.js - Trip Budget Manager backend with MongoDB
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const https = require('https');
const Trip = require('./models/Trip');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/trip-budget-manager';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Helper to generate random 6-character trip code
const generateTripCode = async () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    let isUnique = false;

    while (!isUnique) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // Check if code already exists
        const existing = await Trip.findOne({ tripCode: code });
        if (!existing) isUnique = true;
    }

    return code;
};

// Get current trip (we'll use a single trip for now, identified by tripCode in session)
// For multi-trip support, we'd need to track which trip the user is viewing
const getCurrentTrip = async () => {
    // For now, get the first trip or create a default one
    let trip = await Trip.findOne();
    if (!trip) {
        // Create default empty trip
        trip = new Trip({
            tripCode: await generateTripCode(),
            tripName: "",
            budget: 0,
            memberCount: 0,
            tripDate: "",
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: [],
            pendingContributions: [],
            pendingBudgetRequests: [],
            pendingDeletions: []
        });
        await trip.save();
    }
    return trip;
};

/**
 * Recalculate each member's expected contribution, remaining contribution, and balance.
 */
const recalculateState = (data) => {
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

    // Calculate totals
    let totalExpenses = 0;

    data.expenses.forEach(e => {
        const amount = parseFloat(e.amount) || 0;
        totalExpenses += amount;

        if (e.paidBy && e.paidBy !== 'all_members') {
            const member = data.members.find(m => m.id === e.paidBy);
            if (member && !member.customPersonal) {
                member.personal += amount;
            }
        }
    });

    const expenseShare = actualMemberCount > 0 ? totalExpenses / actualMemberCount : 0;

    // Finalize member balances
    data.members.forEach(m => {
        const actual = m.actualContribution || 0;
        m.remainingContribution = Math.max(m.expectedContribution - actual, 0);

        const netPersonal = Math.max(m.personal - m.reimbursed, 0);

        // Only recalculate balance if not custom
        if (!m.customBalance) {
            const balance = actual + netPersonal - expenseShare;
            m.balance = Math.round(balance * 100) / 100;
        }
    });

    console.log('>>> After recalc, members:', data.members.map(m => ({ name: m.name, expected: m.expectedContribution })));
    console.log('>>> Total expected:', data.members.reduce((sum, m) => sum + m.expectedContribution, 0));
};

// ---------- API Endpoints ---------- //

// Update member details (Admin only)
app.post('/api/members/update', async (req, res) => {
    const { id, name, expectedContribution, actualContribution, personal, balance, customExpected, customPersonal, customBalance } = req.body;

    try {
        const trip = await getCurrentTrip();
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
        await trip.save();

        console.log('>>> Final member data:', member);
        res.json({ message: 'Member updated successfully', member, data: trip });
    } catch (error) {
        console.error('Update member error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get full trip data
app.get('/api/trip', async (req, res) => {
    try {
        const trip = await getCurrentTrip();
        res.json(trip);
    } catch (error) {
        console.error('Get trip error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create or update trip details (setup)
app.post('/api/trip', async (req, res) => {
    const { tripName, budget, memberCount, tripDate, adminPin } = req.body;

    console.log('>>> Setup Trip:', { tripName, adminPin });

    try {
        const trip = await getCurrentTrip();

        trip.tripName = tripName;
        trip.budget = parseFloat(budget) || 0;
        trip.memberCount = parseInt(memberCount) || 0;
        trip.tripDate = tripDate;
        if (adminPin) {
            trip.adminPin = adminPin;
            console.log('>>> Admin PIN saved:', trip.adminPin);
        }
        if (!trip.tripCode) trip.tripCode = await generateTripCode();

        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Trip details updated', data: trip });
    } catch (error) {
        console.error('Setup trip error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Join trip
app.post('/api/join', async (req, res) => {
    const { code, name, pin } = req.body;

    console.log('>>> Join Request:', { code, name, pin });

    try {
        const trip = await Trip.findOne({ tripCode: code });

        if (!trip) {
            return res.status(400).json({ message: 'Invalid Trip Code' });
        }

        console.log('>>> Stored Admin PIN:', trip.adminPin);

        // Check if joining as Admin
        const isAdmin = trip.members.length > 0 && trip.members[0].name.toLowerCase() === name.toLowerCase();
        console.log('>>> Is Admin?', isAdmin);

        // If Admin, verify PIN
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

        // If already a member, return it
        const existing = trip.members.find(m => m.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            return res.json({ message: 'Welcome back!', member: existing, data: trip });
        }

        const adminName = trip.members.length > 0 ? trip.members[0].name : 'Admin';

        // Check if member limit exceeded
        if (trip.members.length >= trip.memberCount) {
            return res.status(400).json({
                message: `Member limit exceeded. Please contact admin (${adminName}).`
            });
        }

        // Check pending list
        const pending = trip.pendingMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
        if (pending) {
            return res.json({ message: 'Join request already pending', status: 'pending' });
        }

        // Create pending join request
        const request = { id: Date.now().toString(), name, status: 'pending' };
        trip.pendingMembers.push(request);
        await trip.save();

        res.json({ message: 'Join request sent to Admin', status: 'pending', data: trip });
    } catch (error) {
        console.error('Join error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin adds a member directly
app.post('/api/members', async (req, res) => {
    try {
        const trip = await getCurrentTrip();
        const newMember = req.body;
        if (!newMember.id) newMember.id = Date.now().toString();

        trip.members.push(newMember);
        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Member added', member: newMember, data: trip });
    } catch (error) {
        console.error('Add member error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Member contribution update
app.post('/api/members/contribute', async (req, res) => {
    const { id, amount, isAdmin } = req.body;

    try {
        const trip = await getCurrentTrip();
        const member = trip.members.find(m => m.id === id);
        if (!member) return res.status(404).json({ message: 'Member not found' });

        const contrib = parseFloat(amount);
        if (isNaN(contrib)) return res.status(400).json({ message: 'Invalid amount' });

        if (!isAdmin) {
            return res.status(403).json({ message: 'Members must request contribution approval' });
        }

        member.actualContribution = (member.actualContribution || 0) + contrib;
        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Contribution updated', member, data: trip });
    } catch (error) {
        console.error('Contribution error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Member requests to add contribution
app.post('/api/contributions/request', async (req, res) => {
    const { memberId, amount, memberName } = req.body;

    try {
        const trip = await getCurrentTrip();

        const request = {
            id: Date.now().toString(),
            memberId,
            memberName,
            amount: parseFloat(amount),
            timestamp: new Date().toISOString()
        };

        trip.pendingContributions.push(request);
        await trip.save();

        res.json({ message: 'Contribution request sent for approval', data: trip });
    } catch (error) {
        console.error('Contribution request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin approves or rejects contribution request
app.post('/api/contributions/approve', async (req, res) => {
    const { id, action } = req.body;

    try {
        const trip = await getCurrentTrip();

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
        await trip.save();

        res.json({ message: `Contribution ${action}d`, data: trip });
    } catch (error) {
        console.error('Contribution approval error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Settle/Reimburse a member's personal expenses
app.post('/api/members/reimburse', async (req, res) => {
    const { id, amount } = req.body;

    try {
        const trip = await getCurrentTrip();
        const member = trip.members.find(m => m.id === id);
        if (!member) return res.status(404).json({ message: 'Member not found' });

        const reimburseAmount = parseFloat(amount);
        if (isNaN(reimburseAmount) || reimburseAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        member.reimbursed = (member.reimbursed || 0) + reimburseAmount;

        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Member reimbursed', member, data: trip });
    } catch (error) {
        console.error('Reimburse error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Refund a member's overpaid contribution
app.post('/api/members/refund', async (req, res) => {
    const { id, amount } = req.body;

    try {
        const trip = await getCurrentTrip();
        const member = trip.members.find(m => m.id === id);
        if (!member) return res.status(404).json({ message: 'Member not found' });

        const refundAmount = parseFloat(amount);
        if (isNaN(refundAmount) || refundAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        member.actualContribution = (member.actualContribution || 0) - refundAmount;

        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Member refunded', member, data: trip });
    } catch (error) {
        console.error('Refund error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin adds an expense directly
app.post('/api/expenses', async (req, res) => {
    try {
        const trip = await getCurrentTrip();
        const newExpense = req.body;
        if (!newExpense.id) newExpense.id = Date.now().toString();

        trip.expenses.push(newExpense);
        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Expense added', expense: newExpense, data: trip });
    } catch (error) {
        console.error('Add expense error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Member requests an expense
app.post('/api/expenses/request', async (req, res) => {
    try {
        const trip = await getCurrentTrip();
        const newExpense = req.body;
        if (!newExpense.id) newExpense.id = Date.now().toString();
        newExpense.status = 'pending';

        trip.pendingExpenses.push(newExpense);
        await trip.save();

        res.json({ message: 'Expense request sent to Admin', expense: newExpense, data: trip });
    } catch (error) {
        console.error('Expense request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve or reject a pending expense
app.post('/api/expenses/approve', async (req, res) => {
    const { id, action } = req.body;

    try {
        const trip = await getCurrentTrip();
        const idx = trip.pendingExpenses.findIndex(e => e.id === id);
        if (idx === -1) return res.status(404).json({ message: 'Request not found' });

        const expense = trip.pendingExpenses[idx];
        if (action === 'approve') {
            delete expense.status;
            trip.expenses.push(expense);
            recalculateState(trip);
        }

        trip.pendingExpenses.splice(idx, 1);
        await trip.save();

        res.json({ message: `Expense ${action}d`, data: trip });
    } catch (error) {
        console.error('Expense approval error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve or reject a pending member
app.post('/api/members/approve', async (req, res) => {
    const { id, action, memberDetails } = req.body;

    try {
        const trip = await getCurrentTrip();
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
        await trip.save();

        console.log('=== END DEBUG ===');
        res.json({ message: `Member ${action}d`, data: trip });
    } catch (error) {
        console.error('Member approval error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a member
app.delete('/api/members/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const trip = await getCurrentTrip();
        const memberIdx = trip.members.findIndex(m => m.id === id);
        if (memberIdx === -1) return res.status(404).json({ message: 'Member not found' });

        // Prevent deleting admin (first member)
        if (memberIdx === 0) {
            return res.status(403).json({ message: 'Cannot delete admin' });
        }

        trip.members.splice(memberIdx, 1);
        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Member deleted', data: trip });
    } catch (error) {
        console.error('Delete member error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Member requests account deletion
app.post('/api/members/delete-request', async (req, res) => {
    const { memberId, memberName } = req.body;

    try {
        const trip = await getCurrentTrip();

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
        await trip.save();

        res.json({ message: 'Deletion request sent for approval', data: trip });
    } catch (error) {
        console.error('Deletion request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin approves or rejects member deletion request
app.post('/api/members/delete-approve', async (req, res) => {
    const { id, action } = req.body;

    try {
        const trip = await getCurrentTrip();

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
        await trip.save();

        res.json({ message: `Deletion ${action}d`, data: trip, deletedMemberId: action === 'approve' ? request.memberId : null });
    } catch (error) {
        console.error('Deletion approval error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete an expense
app.delete('/api/expenses/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const trip = await getCurrentTrip();
        trip.expenses = trip.expenses.filter(e => e.id !== id);
        recalculateState(trip);
        await trip.save();

        res.json({ message: 'Expense deleted', data: trip });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reset the entire app state
app.post('/api/reset', async (req, res) => {
    try {
        // Delete all trips
        await Trip.deleteMany({});

        // Create new empty trip
        const emptyTrip = new Trip({
            tripCode: await generateTripCode(),
            tripName: "",
            budget: 0,
            memberCount: 0,
            tripDate: "",
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: [],
            pendingContributions: [],
            pendingBudgetRequests: [],
            pendingDeletions: []
        });

        await emptyTrip.save();

        res.json({ message: 'App reset successfully', data: emptyTrip });
    } catch (error) {
        console.error('Reset error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reset member data (keep trip and admin)
app.post('/api/reset-data', async (req, res) => {
    try {
        const trip = await getCurrentTrip();

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
        await trip.save();

        res.json({ message: 'Member data reset successfully', data: trip });
    } catch (error) {
        console.error('Reset data error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Budget Increase Request
app.post('/api/budget/request', async (req, res) => {
    const { memberId, amount, reason } = req.body;

    try {
        const trip = await getCurrentTrip();
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
        await trip.save();

        res.json({ message: 'Budget increase request sent to Admin', data: trip });
    } catch (error) {
        console.error('Budget request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete/Handle Budget Request
app.delete('/api/budget/request/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const trip = await getCurrentTrip();
        trip.pendingBudgetRequests = trip.pendingBudgetRequests.filter(r => r.id !== id);
        await trip.save();

        res.json({ message: 'Request processed', data: trip });
    } catch (error) {
        console.error('Budget request delete error:', error);
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

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Force recalculation on startup
    try {
        const trip = await getCurrentTrip();
        console.log('Performing startup recalculation...');
        recalculateState(trip);
        await trip.save();
        console.log('Startup recalculation complete.');
    } catch (error) {
        console.error('Startup recalculation failed:', error);
    }

    startKeepAlive();
});
