const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
    tripCode: { type: String, required: true, unique: true, index: true },
    tripName: { type: String, required: true },
    budget: { type: Number, default: 0 },
    memberCount: { type: Number, default: 0 },
    tripDate: { type: String, default: '' },
    adminPin: { type: String, default: '' },
    members: [{
        id: String,
        name: String,
        expectedContribution: { type: Number, default: 0 },
        actualContribution: { type: Number, default: 0 },
        remainingContribution: { type: Number, default: 0 },
        balance: { type: Number, default: 0 },
        personal: { type: Number, default: 0 },
        reimbursed: { type: Number, default: 0 },
        customExpected: { type: Boolean, default: false },
        customPersonal: { type: Boolean, default: false },
        customBalance: { type: Boolean, default: false }
    }],
    expenses: [{
        id: String,
        title: String,
        amount: Number,
        category: String,
        paidBy: String,
        description: String,
        timestamp: String
    }],
    pendingExpenses: [{
        id: String,
        title: String,
        amount: Number,
        category: String,
        paidBy: String,
        description: String,
        timestamp: String,
        status: String
    }],
    pendingMembers: [{
        id: String,
        name: String,
        status: String
    }],
    pendingContributions: [{
        id: String,
        memberId: String,
        memberName: String,
        amount: Number,
        timestamp: String
    }],
    pendingBudgetRequests: [{
        id: String,
        memberId: String,
        memberName: String,
        amount: Number,
        reason: String,
        timestamp: String
    }],
    pendingDeletions: [{
        id: String,
        memberId: String,
        memberName: String,
        timestamp: String
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Trip', tripSchema);
