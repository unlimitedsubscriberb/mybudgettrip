// server.js - Trip Budget Manager backend
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// Helper to generate random 6-character trip code
const generateTripCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

// Read data from JSON file (creates default if missing)
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        return {
            tripName: "",
            tripCode: "",
            budget: 0,
            memberCount: 0,
            tripDate: "",
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: []
        };
    }
    const raw = fs.readFileSync(DATA_FILE);
    return JSON.parse(raw);
};

// Write data back to file
const writeData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

/**
 * Recalculate each member's expected contribution, remaining contribution, and balance.
 * Expected contribution is based on ACTUAL joined members (updates dynamically).
 * Balance = actualContribution - shareOfExpenses (equal split among all members).
 */
const recalculateState = (data) => {
    // Use ACTUAL joined members for expected contribution calculation
    const actualMemberCount = data.members.length;

    console.log('>>> recalculateState called');
    console.log('>>> Budget:', data.budget);
    console.log('>>> Member count:', actualMemberCount);

    // Expected contribution is based on ACTUAL joined members (dynamically updates)
    // e.g., 30000 ÷ 1 = 30000, then 30000 ÷ 2 = 15000, then 30000 ÷ 3 = 10000
    const expected = actualMemberCount > 0 ? data.budget / actualMemberCount : 0;

    console.log('>>> Expected per member:', expected);

    // Initialize member stats - UPDATE ALL MEMBERS
    // Initialize member stats - UPDATE ALL MEMBERS
    data.members.forEach(m => {
        // Auto-fix missing ID
        if (!m.id) m.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);

        m.expectedContribution = expected;
        m.personal = 0; // Reset personal expenses for recalculation
        if (typeof m.reimbursed !== 'number') m.reimbursed = 0; // Track reimbursements
        if (typeof m.actualContribution !== 'number') m.actualContribution = 0;
    });

    // Calculate totals
    let totalExpenses = 0;

    data.expenses.forEach(e => {
        const amount = parseFloat(e.amount) || 0;
        totalExpenses += amount;

        // Track who paid for the expense (for display/tracking)
        if (e.paidBy && e.paidBy !== 'all_members') {
            const member = data.members.find(m => m.id === e.paidBy);
            if (member) {
                member.personal += amount;
            }
        }
    });

    // Expense share is divided among actual members who have joined
    const expenseShare = actualMemberCount > 0 ? totalExpenses / actualMemberCount : 0;

    // Finalize member balances
    data.members.forEach(m => {
        const actual = m.actualContribution || 0;
        // Remaining contribution is what the member still owes based on expected amount
        m.remainingContribution = Math.max(expected - actual, 0);

        // Net Personal = Total Personal Paid - Reimbursed Amount
        const netPersonal = Math.max(m.personal - m.reimbursed, 0);

        // Balance = Actual Contribution + Net Personal - Share of Total Expenses
        // If they were reimbursed, it reduces their credit (balance)
        const balance = actual + netPersonal - expenseShare;

        m.balance = Math.round(balance * 100) / 100;
        m.personal = Math.round(netPersonal * 100) / 100; // Display outstanding personal amount
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
app.post('/api/trip', (req, res) => {
    const data = readData();
    const { tripName, budget, memberCount, tripDate } = req.body;
    data.tripName = tripName;
    data.budget = parseFloat(budget) || 0;
    data.memberCount = parseInt(memberCount) || 0;
    data.tripDate = tripDate;
    if (!data.tripCode) data.tripCode = generateTripCode();
    // Recalculate expected contributions for existing members
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Trip details updated', data });
});

// Join trip (creates pending member request or adds member directly)
app.post('/api/join', (req, res) => {
    const { code, name } = req.body;
    const data = readData();

    if (data.tripCode !== code) {
        return res.status(400).json({ message: 'Invalid Trip Code' });
    }

    // If already a member, return it
    const existing = data.members.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        return res.json({ message: 'Welcome back!', member: existing, data });
    }

    // Get admin name (first member)
    const adminName = data.members.length > 0 ? data.members[0].name : 'Admin';

    // Check if member limit exceeded
    if (data.members.length >= data.memberCount) {
        return res.status(400).json({
            message: `Member limit exceeded. Please contact admin (${adminName}).`
        });
    }

    // Check pending list
    const pending = data.pendingMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (pending) {
        return res.json({ message: 'Join request already pending', status: 'pending' });
    }

    // Create pending join request
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
    // Ensure expected contribution is set based on current budget/member count
    data.members.push(newMember);
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Member added', member: newMember, data });
});

// Member contribution update
app.post('/api/members/contribute', (req, res) => {
    const { id, amount, isAdmin } = req.body;
    const data = readData();
    const member = data.members.find(m => m.id === id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const contrib = parseFloat(amount);
    if (isNaN(contrib)) return res.status(400).json({ message: 'Invalid amount' });

    // Only admin can add contributions directly
    if (!isAdmin) {
        return res.status(403).json({ message: 'Members must request contribution approval' });
    }

    member.actualContribution = (member.actualContribution || 0) + contrib;
    // Recalculate balances after contribution
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Contribution updated', member, data });
});

// Member requests to add contribution (requires approval)
app.post('/api/contributions/request', (req, res) => {
    const { memberId, amount, memberName } = req.body;
    const data = readData();

    if (!data.pendingContributions) data.pendingContributions = [];

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

    if (!data.pendingContributions) data.pendingContributions = [];

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

    // Remove from pending
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

    // Decrease actual contribution
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
    // Recalculate balances after expense
    recalculateState(data);
    writeData(data);
    res.json({ message: 'Expense added', expense: newExpense, data });
});

// Member requests an expense (pending approval)
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
    const { id, action } = req.body; // action: 'approve' or 'reject'
    const data = readData();
    const idx = data.pendingExpenses.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ message: 'Request not found' });
    const expense = data.pendingExpenses[idx];
    if (action === 'approve') {
        delete expense.status;
        data.expenses.push(expense);
        // Recalculate after approval
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
        // Get member name from pending list or memberDetails
        const memberName = memberDetails?.name || data.pendingMembers[idx].name;

        // Create new member with minimal info - recalculateState will set expected amounts
        const newMember = {
            id: Date.now().toString(),
            name: memberName,
            expectedContribution: 0, // Will be set by recalculateState
            actualContribution: 0,
            remainingContribution: 0, // Will be set by recalculateState
            balance: 0,
            personal: 0
        };

        data.members.push(newMember);

        console.log('After adding member - Member count:', data.members.length);

        // Recalculate after adding member - this will update expected amounts for ALL members
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
    const data = readData();
    const { id } = req.params;

    // Find member to delete
    const memberIdx = data.members.findIndex(m => m.id === id);
    if (memberIdx === -1) return res.status(404).json({ message: 'Member not found' });

    // Remove member
    data.members.splice(memberIdx, 1);

    // Recalculate state (redistribute expenses and expected amounts among remaining members)
    recalculateState(data);
    writeData(data);

    res.json({ message: 'Member deleted', data });
});

// Member requests account deletion (requires approval)
app.post('/api/members/delete-request', (req, res) => {
    const { memberId, memberName } = req.body;
    const data = readData();

    if (!data.pendingDeletions) data.pendingDeletions = [];

    // Check if request already exists
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

    if (!data.pendingDeletions) data.pendingDeletions = [];

    const requestIndex = data.pendingDeletions.findIndex(r => r.id === id);
    if (requestIndex === -1) return res.status(404).json({ message: 'Request not found' });

    const request = data.pendingDeletions[requestIndex];

    if (action === 'approve') {
        // Remove member from members array
        const memberIndex = data.members.findIndex(m => m.id === request.memberId);
        if (memberIndex !== -1) {
            data.members.splice(memberIndex, 1);
            recalculateState(data);
        }
    }

    // Remove from pending
    data.pendingDeletions.splice(requestIndex, 1);
    writeData(data);
    res.json({ message: `Deletion ${action}d`, data, deletedMemberId: action === 'approve' ? request.memberId : null });
});

// Delete an expense
app.delete('/api/expenses/:id', (req, res) => {
    const data = readData();
    const { id } = req.params;
    data.expenses = data.expenses.filter(e => e.id !== id);
    // Recalculate after deletion
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
        members: [],
        expenses: [],
        pendingExpenses: [],
        pendingMembers: []
    };
    writeData(emptyData);
    res.json({ message: 'App reset successfully', data: emptyData });
});

// Sync entire state (replace local storage)
app.post('/api/sync', (req, res) => {
    const data = req.body;
    writeData(data);
    res.json({ message: 'Data synced successfully', data });
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

    if (!data.pendingBudgetRequests) data.pendingBudgetRequests = [];
    data.pendingBudgetRequests.push(request);
    writeData(data);

    res.json({ message: 'Budget increase request sent to Admin', data });
});

// Delete/Handle Budget Request
app.delete('/api/budget/request/:id', (req, res) => {
    const { id } = req.params;
    const data = readData();

    if (data.pendingBudgetRequests) {
        data.pendingBudgetRequests = data.pendingBudgetRequests.filter(r => r.id !== id);
        writeData(data);
    }

    res.json({ message: 'Request processed', data });
});

// ========================================
// KEEP-ALIVE MECHANISM FOR FREE HOSTING
// ========================================
// Prevents server sleep on platforms like Render.com
// This pings the server every 14 minutes to keep it awake

const RENDER_URL = process.env.RENDER_EXTERNAL_URL; // Render provides this env variable
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

    // Force recalculation on startup to fix any data inconsistencies
    try {
        const data = readData();
        console.log('Performing startup recalculation...');
        recalculateState(data);
        writeData(data);
        console.log('Startup recalculation complete.');
    } catch (error) {
        console.error('Startup recalculation failed:', error);
    }

    // Start keep-alive mechanism (only on Render)
    startKeepAlive();
});
