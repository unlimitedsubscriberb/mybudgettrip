// Trip Budget Manager Web App - Complete JavaScript Implementation
class TripBudgetManager {
    constructor() {
        this.tripData = {
            name: '',
            tripCode: '',
            budget: 0,
            memberCount: 0,
            dateTime: '',
            members: [],
            expenses: [],
            pendingExpenses: [],
            pendingMembers: []
        };
        this.currentUser = JSON.parse(localStorage.getItem('tripUser')) || null; // { name: 'Rahul', role: 'admin' | 'member'}
        this.expectedContribution = 0;
        this.init();
    }

    async init() {
        // Check if user is already logged in/joined
        if (this.currentUser) {
            await this.loadFromStorage();
            if (this.tripData.tripName) {
                this.showAppSection();
            } else {
                // Trip might have been reset or invalid
                this.showLandingPage();
            }
        } else {
            this.showLandingPage();
        }

        this.setupEventListeners();

        // Poll for updates every 5 seconds (increased from 2s to prevent form interruptions)
        setInterval(() => this.loadFromStorage(), 5000);

        // Set default datetime
        const now = new Date();
        const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
        const tripDateTimeInput = document.getElementById('tripDateTime');
        if (tripDateTimeInput) {
            tripDateTimeInput.value = localDateTime;
        }
    }

    async loadFromStorage() {
        try {
            const response = await fetch('/api/trip');
            const data = await response.json();

            // Update member's lastActive timestamp if logged in
            if (this.currentUser && this.currentUser.id) {
                fetch('/api/members/activity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ memberId: this.currentUser.id })
                }).catch(err => console.log('Activity update failed:', err));
            }

            // Only update if data has changed to avoid UI flickering and input reset
            if (JSON.stringify(data) !== JSON.stringify(this.tripData)) {
                this.tripData = data;

                // Auto-fix: If currentUser exists but has no ID (legacy session), try to find it
                if (this.currentUser && !this.currentUser.id && this.tripData.members) {
                    const me = this.tripData.members.find(m => m.name === this.currentUser.name);
                    if (me) {
                        this.currentUser.id = me.id;
                        // Re-verify admin role
                        if (this.tripData.members.length > 0 && this.tripData.members[0].id === me.id) {
                            this.currentUser.role = 'admin';
                        }
                        localStorage.setItem('tripUser', JSON.stringify(this.currentUser));
                        console.log('Session auto-repaired: ID added to currentUser');
                    }
                }

                this.updateUI();
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    async saveToStorage() {
        // In this new architecture, we don't save entire state from client.
        // We send specific updates to API.
        // This method is kept for compatibility if needed, but mostly unused now.
    }

    setupEventListeners() {
        // Join Trip Form
        const joinTripForm = document.getElementById('joinTripForm');
        if (joinTripForm) {
            joinTripForm.addEventListener('submit', (e) => this.handleJoinTrip(e));
        }

        // Setup form submission
        const setupForm = document.getElementById('setupForm');
        if (setupForm) {
            setupForm.addEventListener('submit', (e) => this.handleSetupSubmit(e));
        }

        // Member form submission
        const memberForm = document.getElementById('memberForm');
        if (memberForm) {
            memberForm.addEventListener('submit', (e) => this.handleMemberSubmit(e));
        }

        // Expense form submission
        const expenseForm = document.getElementById('expenseForm');
        if (expenseForm) {
            expenseForm.addEventListener('submit', (e) => this.handleExpenseSubmit(e));
        }

        // Edit trip form submission
        const editTripForm = document.getElementById('editTripForm');
        if (editTripForm) {
            editTripForm.addEventListener('submit', (e) => this.handleEditTripSubmit(e));
        }

        // Member names form submission
        const memberNamesForm = document.getElementById('memberNamesForm');
        if (memberNamesForm) {
            memberNamesForm.addEventListener('submit', (e) => this.handleMemberNamesSubmit(e));
        }

        // Filter change
        const filterCategory = document.getElementById('filterCategory');
        if (filterCategory) {
            filterCategory.addEventListener('change', () => this.displayExpenses());
        }

        // Close modals on outside click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideAllModals();
                }
            });
        });

        // Edit Member Form
        const editMemberForm = document.getElementById('editMemberForm');
        if (editMemberForm) {
            editMemberForm.addEventListener('submit', (e) => this.handleEditMemberSubmit(e));
        }
    }

    // --- Navigation & Views ---

    showLandingPage() {
        document.getElementById('landingSection').style.display = 'flex';
        document.getElementById('setupSection').style.display = 'none';
        document.getElementById('memberNamesSection').style.display = 'none';
        document.getElementById('appSection').style.display = 'none';
    }

    showSetupForm() {
        document.getElementById('landingSection').style.display = 'none';
        document.getElementById('setupSection').style.display = 'flex';
    }

    showMemberNamesSetup() {
        document.getElementById('setupSection').style.display = 'none';
        document.getElementById('memberNamesSection').style.display = 'flex';
        document.getElementById('memberCountDisplay').textContent = this.tempTripData.memberCount;
        this.generateMemberNameInputs();
    }

    showAppSection() {
        document.getElementById('landingSection').style.display = 'none';
        document.getElementById('setupSection').style.display = 'none';
        document.getElementById('memberNamesSection').style.display = 'none';
        document.getElementById('appSection').style.display = 'block';
        this.updateUI();
    }

    backToSetup() {
        document.getElementById('memberNamesSection').style.display = 'none';
        document.getElementById('setupSection').style.display = 'flex';
        this.tempTripData = null;
    }

    // --- Handlers ---

    async handleJoinTrip(e, pin = null) {
        if (e && e.preventDefault) e.preventDefault();
        const code = document.getElementById('joinCode').value.trim().toUpperCase();
        const name = document.getElementById('joinName').value.trim();

        if (!code || !name) {
            this.showNotification('Please enter both code and name', 'error');
            return;
        }

        try {
            const body = { code, name };
            if (pin) body.pin = pin;

            const response = await fetch('/api/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();

            if (response.ok) {
                if (result.status === 'require_pin') {
                    // Prompt for PIN
                    const enteredPin = prompt('Enter Admin PIN to login:');
                    if (enteredPin) {
                        this.handleJoinTrip(null, enteredPin);
                    } else {
                        this.showNotification('PIN required for Admin login', 'error');
                    }
                    return;
                }

                if (result.status === 'pending') {
                    this.showNotification('Join request sent to Admin for approval!', 'success');
                    // We don't log them in yet, just notify
                } else {
                    // Already a member or auto-approved (if we change logic later)
                    this.currentUser = { name: name, role: 'member' }; // Default to member

                    // Find member ID
                    if (result.data && result.data.members) {
                        const member = result.data.members.find(m => m.name === name);
                        if (member) {
                            this.currentUser.id = member.id;
                            // Check if this user is actually the admin (first member)
                            if (result.data.members.length > 0 && result.data.members[0].id === member.id) {
                                this.currentUser.role = 'admin';
                            }
                        }
                    }

                    localStorage.setItem('tripUser', JSON.stringify(this.currentUser));
                    this.tripData = result.data;
                    this.showAppSection();
                    this.showNotification(result.message || `Welcome ${name}!`, 'success');
                }
            } else {
                this.showNotification(result.message || 'Failed to join', 'error');
            }
        } catch (error) {
            console.error('Join error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    async handleSetupSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const tripName = formData.get('tripName').trim();
        let budgetAmount = parseFloat(formData.get('budgetAmount'));
        const memberCount = parseInt(formData.get('memberCount'));
        const tripDateTime = formData.get('tripDateTime');
        const adminName = formData.get('adminName').trim();
        const budgetType = document.getElementById('budgetType').value;

        // Calculate total budget if per-person is selected
        if (budgetType === 'person') {
            budgetAmount = budgetAmount * memberCount;
        }

        if (!tripName || !budgetAmount || !memberCount || !tripDateTime || !adminName) {
            this.showNotification('Please fill in all fields correctly', 'error');
            return;
        }

        const expectedContribution = budgetAmount / memberCount;

        // Create initial members array - only Admin
        const members = [];

        // Add Admin (You) - the only initial member
        members.push({
            id: Date.now().toString(),
            name: adminName,
            expectedContribution: expectedContribution,
            actualContribution: 0,
            remainingContribution: expectedContribution,
            balance: 0
        });

        // Other members will join using the trip code

        // Set current user as Admin
        this.currentUser = {
            id: members[0].id,
            name: adminName,
            role: 'admin'
        };
        localStorage.setItem('tripUser', JSON.stringify(this.currentUser));

        try {
            // 1. Setup Trip (with clearData flag to reset old data atomically)
            await fetch('/api/trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tripName: tripName,
                    budget: budgetAmount,
                    memberCount: memberCount,
                    tripDate: tripDateTime,
                    adminPin: formData.get('adminPin'),
                    clearData: true // Clear old data before setup
                })
            });

            // 2. Add Admin Member
            if (members.length > 0) {
                await fetch('/api/members', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(members[0])
                });
            }

            // 3. Wait a moment for data to propagate, then load and show dashboard
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.loadFromStorage();
            this.showAppSection();
            this.showNotification('Trip created successfully!', 'success');

        } catch (error) {
            console.error('Setup error:', error);
            this.showNotification('Error setting up trip', 'error');
        }
    }

    generateMemberNameInputs() {
        // Deprecated: Logic moved to handleSetupSubmit with placeholders
    }

    async handleMemberNamesSubmit(e) {
        // Deprecated: Logic moved to handleSetupSubmit
    }


    async handleExpenseSubmit(e) {
        e.preventDefault();
        const title = document.getElementById('expenseTitle').value.trim();
        const amount = parseFloat(document.getElementById('expenseAmount').value);
        const category = document.getElementById('expenseCategory').value;
        const paidBy = document.getElementById('paidBy').value;
        const description = document.getElementById('expenseDescription').value.trim();

        // Collect selected members for splitting
        const allCheckbox = document.getElementById('splitAllMembers');
        const memberCheckboxes = document.querySelectorAll('#splitMembersList input[type="checkbox"]:checked');

        let splitBetween = [];
        if (allCheckbox && allCheckbox.checked) {
            // Split among all members
            splitBetween = this.tripData.members.map(m => m.id);
        } else {
            // Split among selected members
            splitBetween = Array.from(memberCheckboxes).map(cb => cb.value);
        }

        if (!title || !amount || !category || !paidBy || splitBetween.length === 0) {
            this.showNotification('Please fill all required fields and select members', 'error');
            return;
        }

        const expense = {
            title, amount, category, paidBy, splitBetween, description,
            timestamp: new Date().toISOString()
        };

        try {
            let url = '/api/expenses';
            let msg = 'Expense added successfully!';

            // If Member, send request instead
            if (this.currentUser.role !== 'admin') {
                url = '/api/expenses/request';
                msg = 'Expense request sent to Admin for approval';
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(expense)
            });

            if (response.ok) {
                this.showNotification(msg, 'success');
                document.getElementById('expenseForm').reset();
                // Reset to "All Members" after form reset
                if (allCheckbox) allCheckbox.checked = true;
                if (typeof updateSplitLabel === 'function') updateSplitLabel();
                await this.loadFromStorage();
            }
        } catch (error) {
            console.error('Expense error:', error);
            this.showNotification('Error adding expense', 'error');
        }
    }

    async handleMemberSubmit(e) {
        e.preventDefault();
        const name = document.getElementById('memberName').value.trim();
        const contribution = parseFloat(document.getElementById('memberContribution').value) || 0;

        if (!name) return;

        // Calculate expected
        const newMemberCount = this.tripData.members.length + 1;
        const expected = this.tripData.budget / newMemberCount;

        const member = {
            name: name,
            expectedContribution: expected,
            actualContribution: contribution,
            remainingContribution: expected - contribution,
            balance: contribution
        };

        try {
            // Only Admin can add members directly
            if (this.currentUser.role === 'admin') {
                await fetch('/api/members', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(member)
                });
                this.showNotification(`${name} added successfully`, 'success');
            } else {
                // Members can request to add someone (or themselves?)
                // For now, let's say only Admin adds via this modal.
                // Or if we want members to add, it goes to pendingMembers.
                // Let's assume this modal is for Admin usage primarily.
                // If a non-admin uses it:
                await fetch('/api/join', { // Reuse join logic or new endpoint?
                    // Let's use a specific request endpoint if we had one, 
                    // but for now let's restrict this button to Admin in UI.
                });
            }

            this.hideMemberModal();
            document.getElementById('memberForm').reset();
            await this.loadFromStorage();
        } catch (error) {
            console.error('Add member error:', error);
        }
    }

    // --- Approvals ---

    async handleApproval(type, id, action, details = null) {
        const endpoint = type === 'expense' ? '/api/expenses/approve' : '/api/members/approve';
        try {
            await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action, memberDetails: details })
            });
            this.showNotification(`${type === 'expense' ? 'Expense' : 'Member'} ${action}d`, 'success');
            await this.loadFromStorage();
        } catch (error) {
            console.error('Approval error:', error);
        }
    }

    // --- UI Updates ---

    updateUI() {
        if (!this.tripData.tripName) return;

        this.updateDashboard();
        this.updateBudgetOverview();
        this.updateBudgetAlerts();
        this.displayMembers();
        this.displayExpenses();
        this.updateMemberSelect();
        if (typeof populateSplitMembers === 'function') {
            populateSplitMembers(this.tripData.members || []);
        }
        this.updatePendingApprovals();
        this.updateSettlements(); // New


        // Role-based UI visibility
        const isAdmin = this.currentUser && this.currentUser.role === 'admin';

        // Show/Hide Trip Code
        const codeContainer = document.getElementById('tripCodeContainer');
        if (codeContainer) codeContainer.style.display = isAdmin ? 'inline-flex' : 'none';

        // Show/Hide Approval Section
        const approvalSection = document.getElementById('approvalSection');
        if (approvalSection) approvalSection.style.display = isAdmin ? 'block' : 'none';

        // Show/Hide Reset Button
        const resetBtn = document.getElementById('resetAppBtn');
        if (resetBtn) resetBtn.style.display = isAdmin ? 'flex' : 'none';

        // Show/Hide Logout Button (visible to all logged-in users)
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.style.display = this.currentUser ? 'flex' : 'none';
    }

    updateSettlements() {
        const section = document.getElementById('settlementsSection');
        const list = document.getElementById('settlementsList');
        if (!section || !list) return;

        // Only show if Admin
        if (this.currentUser.role !== 'admin') {
            section.style.display = 'none';
            return;
        }

        // Find members who are owed money (personal > 0 OR overpaid > 0)
        const creditors = this.tripData.members.filter(m => {
            const overpaid = Math.max(m.actualContribution - m.expectedContribution, 0);
            return m.personal > 0 || overpaid > 0.01; // Use 0.01 tolerance for float
        });

        if (creditors.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = '';

        creditors.forEach(m => {
            const item = document.createElement('div');
            item.className = 'pending-item'; // Reuse pending item style

            let actionHtml = '';
            let metaHtml = '';

            // Case 1: Personal Expenses (Owed to member)
            if (m.personal > 0) {
                metaHtml += `<div>Personal Expenses: ₹${m.personal}</div>`;
                actionHtml += `
                    <button class="google-button primary small" onclick="tripManager.handleSettlement('${m.id}', ${m.personal})">
                        Settle Personal (Pay ₹${m.personal})
                    </button>
                `;
            }

            // Case 2: Overpaid Contribution (Refund to member)
            const overpaid = Math.max(m.actualContribution - m.expectedContribution, 0);
            if (overpaid > 0) {
                metaHtml += `<div>Overpaid Contribution: ₹${Math.round(overpaid * 100) / 100}</div>`;
                actionHtml += `
                    <button class="google-button secondary small" onclick="tripManager.handleRefund('${m.id}', ${overpaid})" style="margin-top: 5px;">
                        Refund Overpayment (Pay ₹${Math.round(overpaid * 100) / 100})
                    </button>
                `;
            }

            item.innerHTML = `
                <div class="pending-info">
                    <div class="pending-title">${m.name}</div>
                    <div class="pending-meta">${metaHtml}</div>
                </div>
                <div class="pending-actions" style="flex-direction: column; align-items: flex-end;">
                    ${actionHtml}
                </div>
            `;
            list.appendChild(item);
        });
    }

    async handleRefund(memberId, amount) {
        if (!confirm(`Confirm refund of ₹${Math.round(amount * 100) / 100} to this member?\n\nThis will reduce their 'Paid' amount.`)) return;

        try {
            const response = await fetch('/api/members/refund', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: memberId, amount })
            });

            if (response.ok) {
                this.showNotification('Refund recorded successfully', 'success');
                await this.loadFromStorage();
            } else {
                this.showNotification('Failed to record refund', 'error');
            }
        } catch (error) {
            console.error('Refund error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    async handleSettlement(memberId, amount) {
        if (!confirm(`Confirm settlement of ₹${amount} to this member?\n\nThis will reset their Personal amount to 0.`)) return;

        try {
            const response = await fetch('/api/members/reimburse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: memberId, amount })
            });

            if (response.ok) {
                this.showNotification('Settlement recorded successfully', 'success');
                await this.loadFromStorage();
            } else {
                this.showNotification('Failed to record settlement', 'error');
            }
        } catch (error) {
            console.error('Settlement error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    updateDashboard() {
        const memberName = this.currentUser ? this.currentUser.name : '';
        const tripName = this.tripData.tripName.toUpperCase();
        const title = memberName ? `${tripName} - ${memberName}'s Dashboard` : tripName;

        document.getElementById('tripTitle').textContent = title;
        if (this.tripData.tripCode) {
            document.getElementById('tripCodeDisplay').textContent = this.tripData.tripCode;
        }

        if (this.tripData.tripDate) {
            const date = new Date(this.tripData.tripDate);
            document.getElementById('tripDateDisplay').textContent = date.toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        }
        document.getElementById('memberCountDisplayMain').textContent = `${this.tripData.members.length} Members`;
    }

    updatePendingApprovals() {
        const list = document.getElementById('pendingList');
        const section = document.getElementById('approvalSection');
        if (!list || !section) return;

        const pExpenses = this.tripData.pendingExpenses || [];
        const pMembers = this.tripData.pendingMembers || [];
        const pBudget = this.tripData.pendingBudgetRequests || [];
        const pContributions = this.tripData.pendingContributions || [];

        if (pExpenses.length === 0 && pMembers.length === 0 && pBudget.length === 0 && pContributions.length === 0) {
            section.style.display = 'none';
            return;
        }

        // Only show if Admin
        if (this.currentUser.role !== 'admin') {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = '';

        // Render Pending Budget Requests
        pBudget.forEach(r => {
            const item = document.createElement('div');
            item.className = 'pending-item';
            item.innerHTML = `
                <div class="pending-info">
                    <div class="pending-title">Budget Increase Request</div>
                    <div class="pending-meta">${r.memberName} wants to add ₹${r.amount}</div>
                    <div class="pending-meta" style="font-size: 0.8rem;">Reason: ${r.reason}</div>
                </div>
                <div class="pending-actions">
                    <button class="icon-button" onclick="tripManager.handleBudgetRequest('${r.id}', 'reject')" title="Reject">
                        <span class="material-icons" style="color: var(--error-color)">close</span>
                    </button>
                    <button class="icon-button" onclick="tripManager.handleBudgetRequest('${r.id}', 'approve', '${r.amount}', '${r.memberName}')" title="Approve & Increase Budget">
                        <span class="material-icons" style="color: var(--secondary-color)">check</span>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });

        // Render Pending Contributions
        pContributions.forEach(c => {
            const item = document.createElement('div');
            item.className = 'pending-item';
            item.innerHTML = `
                <div class="pending-info">
                    <div class="pending-title">Contribution Request: ${c.memberName} (₹${c.amount})</div>
                    <div class="pending-meta">Wants to add contribution</div>
                </div>
                <div class="pending-actions">
                    <button class="icon-button" onclick="tripManager.approveContribution('${c.id}', 'reject')" title="Reject">
                        <span class="material-icons" style="color: var(--error-color)">close</span>
                    </button>
                    <button class="icon-button" onclick="tripManager.approveContribution('${c.id}', 'approve')" title="Approve">
                        <span class="material-icons" style="color: var(--secondary-color)">check</span>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });

        // Render Pending Members
        pMembers.forEach(m => {
            const item = document.createElement('div');
            item.className = 'pending-item';
            item.innerHTML = `
                <div class="pending-info">
                    <div class="pending-title">New Member Request: ${m.name}</div>
                    <div class="pending-meta">Wants to join the trip</div>
                </div>
                <div class="pending-actions">
                    <button class="icon-button" onclick="tripManager.approveMember('${m.id}', 'reject')" title="Reject">
                        <span class="material-icons" style="color: var(--error-color)">close</span>
                    </button>
                    <button class="icon-button" onclick="tripManager.approveMember('${m.id}', 'approve', '${m.name}')" title="Approve">
                        <span class="material-icons" style="color: var(--secondary-color)">check</span>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });

        // Render Pending Expenses
        pExpenses.forEach(e => {
            const item = document.createElement('div');
            item.className = 'pending-item';
            item.innerHTML = `
                <div class="pending-info">
                    <div class="pending-title">Expense Request: ${e.title} (₹${e.amount})</div>
                    <div class="pending-meta">Category: ${e.category} | By: ${this.getMemberName(e.paidBy)}</div>
                </div>
                <div class="pending-actions">
                    <button class="icon-button" onclick="tripManager.handleApproval('expense', '${e.id}', 'reject')" title="Reject">
                        <span class="material-icons" style="color: var(--error-color)">close</span>
                    </button>
                    <button class="icon-button" onclick="tripManager.handleApproval('expense', '${e.id}', 'approve')" title="Approve">
                        <span class="material-icons" style="color: var(--secondary-color)">check</span>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
    }

    // Add contribution for a member
    async addContribution(memberId, remaining) {
        const input = document.getElementById(`contrib-${memberId}`);
        const amount = parseFloat(input.value);

        if (!amount || amount <= 0) {
            this.showNotification('Please enter a valid amount', 'error');
            return;
        }

        // Check for overpayment
        if (amount > remaining) {
            const excess = amount - remaining;
            const confirmMsg = `⚠️ Expected amount reached!\n\n` +
                `Expected: ₹${remaining}\n` +
                `You're paying: ₹${amount}\n` +
                `Excess: ₹${excess}\n\n` +
                `The excess amount (₹${excess}) will be added to Personal Expenses.\n\n` +
                `Do you want to continue?`;

            if (!confirm(confirmMsg)) {
                return;
            }

            // If admin or confirmed, proceed with overpayment
            // The backend will handle adding excess to personal
        }

        try {
            let response;
            let message;

            // Admin can add contributions directly
            if (this.currentUser.role === 'admin') {
                response = await fetch('/api/members/contribute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: memberId, amount, isAdmin: true })
                });
                message = 'Contribution added';
            } else {
                // Members must request approval
                const member = this.tripData.members.find(m => m.id === memberId);
                response = await fetch('/api/contributions/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        memberId,
                        amount,
                        memberName: member ? member.name : 'Unknown'
                    })
                });
                message = 'Contribution request sent to Admin for approval';
            }

            if (response.ok) {
                this.showNotification(message, 'success');
                input.value = ''; // Clear input
                await this.loadFromStorage();
            } else {
                this.showNotification('Failed to add contribution', 'error');
            }
        } catch (error) {
            console.error('Contribution error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    approveMember(id, action, name) {
        let details = null;
        if (action === 'approve') {
            // Don't pre-calculate expected contribution - let backend do it
            // Backend will recalculate for ALL members when new member is added
            details = {
                name: name,
                actualContribution: 0,
                balance: 0
            };
        }
        this.handleApproval('member', id, action, details);
    }

    async approveContribution(id, action) {
        try {
            const response = await fetch('/api/contributions/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action })
            });

            if (response.ok) {
                this.showNotification(`Contribution ${action}d successfully`, 'success');
                await this.loadFromStorage();
            } else {
                this.showNotification(`Failed to ${action} contribution`, 'error');
            }
        } catch (error) {
            console.error('Contribution approval error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    getMemberName(id) {
        if (id === 'all_members') return 'All Members';
        const m = this.tripData.members.find(x => x.id === id);
        return m ? m.name : 'Unknown';
    }

    // Create a member card element
    createMemberCard(member, index) {
        const card = document.createElement('div');
        card.className = 'member-card';
        // Values (rounded to 2 decimals)
        const expected = Math.round(member.expectedContribution * 100) / 100;
        const paid = Math.round(member.actualContribution * 100) / 100;
        const remaining = Math.round(member.remainingContribution * 100) / 100;
        const balance = Math.round(member.balance * 100) / 100;
        const balanceClass = balance >= 0 ? 'positive' : 'negative';

        // Check if member is online (lastActive within 5 minutes)
        const isOnline = member.lastActive && (Date.now() - new Date(member.lastActive).getTime()) < 5 * 60 * 1000;
        const statusColor = isOnline ? '#4CAF50' : '#f44336'; // Green or Red
        const statusTitle = isOnline ? 'Online' : 'Offline';

        // Admin action buttons
        const actionButtons = this.currentUser && this.currentUser.role === 'admin' ? `
            <div style="position: absolute; top: 10px; right: 10px; display: flex; gap: 5px;">
                <button class="icon-button" onclick="tripManager.shareMemberDetails('${member.id}')" title="Share Member Details" style="background: rgba(76, 175, 80, 0.1); color: #4CAF50;">
                    <span class="material-icons">share</span>
                </button>
                <button class="icon-button" onclick="tripManager.openEditMemberModal('${member.id}')" title="Edit Member" style="background: rgba(33, 150, 243, 0.1); color: var(--primary-color);">
                    <span class="material-icons">edit</span>
                </button>
                <button class="icon-button delete-btn" onclick="tripManager.deleteMember('${member.id}')" title="Delete Member" style="background: rgba(255,0,0,0.1); color: var(--error-color);">
                    <span class="material-icons">delete</span>
                </button>
            </div>` : '';

        // Trip expenses will only be shown in the share message, not on the card

        card.innerHTML = `
            <div class="member-header" style="position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 1rem;">
                <div class="member-info" style="width: 100%; padding-right: 120px;">
                    <div class="member-name" style="font-weight: 600; font-size: 1.2rem; word-wrap: break-word; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: ${statusColor}; display: inline-block;" title="${statusTitle}"></span>
                        ${member.name}
                    </div>
                    <div class="member-role" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">${member.role === 'admin' ? 'Admin' : 'Member'}</div>
                </div>
                ${actionButtons}
            </div>
            
            <div class="member-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 1rem;">
                <div class="stat-item">
                    <div class="label">Expected</div>
                    <div class="amount">₹${expected}</div>
                </div>
                <div class="stat-item">
                    <div class="label">Paid</div>
                    <div class="amount positive">₹${paid}</div>
                </div>
                <div class="stat-item">
                    <div class="label">Unpaid</div>
                    <div class="amount negative">₹${remaining}</div>
                </div>
                <div class="stat-item">
                    <div class="label">Balance</div>
                    <div class="amount ${balanceClass}">₹${balance}</div>
                </div>
                <div class="stat-item" style="grid-column: span 2;">
                    <div class="label">Personal Expenses</div>
                    <div class="amount">₹${member.personal || 0}</div>
                </div>
            </div>
            
            <div class="member-actions" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                ${(this.currentUser && (this.currentUser.id === member.id || this.currentUser.role === 'admin')) ? `
                <div class="input-group" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                    <input type="number" id="contrib-${member.id}" placeholder="Amount" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 8px;">
                    <button class="google-button primary small" onclick="tripManager.addContribution('${member.id}', ${remaining})">
                        Pay
                    </button>
                </div>
                ${this.currentUser.role === 'admin' ? `
                <button class="google-button secondary small" onclick="tripManager.shareMemberFinancials('${member.id}')" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
                    <span class="material-icons" style="font-size: 1rem;">share</span>
                    Share Financial Details
                </button>` : ''}` : ''}
            </div>
        `;
        return card;
    }

    async requestBudgetIncrease(memberId) {
        const amount = prompt("Enter the extra amount you want to contribute:");
        if (!amount || isNaN(amount) || amount <= 0) return;

        try {
            const response = await fetch('/api/budget/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memberId, amount, reason: 'User requested limit increase' })
            });
            if (response.ok) {
                this.showNotification('Request sent to Admin', 'success');
            } else {
                this.showNotification('Failed to send request', 'error');
            }
        } catch (error) {
            console.error('Request error:', error);
        }
    }

    async handleBudgetRequest(id, action, amount, memberName) {
        if (action === 'reject') {
            await fetch(`/api/budget/request/${id}`, { method: 'DELETE' });
            this.showNotification('Request rejected', 'info');
            await this.loadFromStorage();
            return;
        }

        if (action === 'approve') {
            const newBudget = this.tripData.budget + parseFloat(amount);
            if (confirm(`Approve request from ${memberName}?\nThis will increase Total Budget to ₹${newBudget}`)) {
                // 1. Update Budget
                await fetch('/api/trip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...this.tripData,
                        budget: newBudget
                    })
                });
                // 2. Clear Request
                await fetch(`/api/budget/request/${id}`, { method: 'DELETE' });
                this.showNotification('Budget increased & Request approved', 'success');
                await this.loadFromStorage();
            }
        }
    }

    updateBudgetOverview() {
        const totalCollected = this.tripData.members.reduce((sum, m) => sum + (m.actualContribution || 0), 0);
        const totalSpent = this.tripData.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const remaining = totalCollected - totalSpent;

        document.getElementById('totalBudget').textContent = `₹${this.tripData.budget.toLocaleString('en-IN')}`;
        document.getElementById('totalCollected').textContent = `₹${totalCollected.toLocaleString('en-IN')}`;
        document.getElementById('totalSpent').textContent = `₹${totalSpent.toLocaleString('en-IN')}`;
        document.getElementById('remainingAmount').textContent = `₹${remaining.toLocaleString('en-IN')}`;

        // Progress
        const pct = this.tripData.budget > 0 ? (totalCollected / this.tripData.budget * 100) : 0;
        document.getElementById('budgetProgress').style.width = `${Math.min(pct, 100)}%`;
        document.getElementById('progressPercentage').textContent = `${pct.toFixed(1)}%`;
    }

    updateBudgetAlerts() {
        const container = document.getElementById('budgetAlerts');
        if (!container) return;
        container.innerHTML = '';

        const totalCollected = this.tripData.members.reduce((sum, m) => sum + (m.actualContribution || 0), 0);
        const totalSpent = this.tripData.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const remaining = totalCollected - totalSpent;

        if (remaining < 0) {
            const alert = document.createElement('div');
            alert.className = 'alert alert-error';
            alert.innerHTML = `
            <span class="material-icons">warning</span>
                <span><strong>Over Budget!</strong> Expenses exceed collected amount by ₹${Math.abs(remaining).toLocaleString('en-IN')}</span>
        `;
            container.appendChild(alert);
        } else if (remaining < 2000 && remaining > 0) {
            const alert = document.createElement('div');
            alert.className = 'alert alert-warning';
            alert.innerHTML = `
            <span class="material-icons">info</span>
                <span><strong>Low Balance:</strong> Only ₹${remaining.toLocaleString('en-IN')} remaining.</span>
        `;
            container.appendChild(alert);
        }
    }

    displayMembers() {
        const grid = document.getElementById('membersGrid');

        // Save current input values and focused element before clearing
        const inputValues = {};
        const focusedElementId = document.activeElement ? document.activeElement.id : null;

        this.tripData.members.forEach(m => {
            const input = document.getElementById(`contrib-${m.id}`);
            if (input && input.value) {
                inputValues[m.id] = input.value;
            }
        });

        grid.innerHTML = '';
        this.tripData.members.forEach((m, index) => {
            grid.appendChild(this.createMemberCard(m, index));
        });

        // Restore input values and focus after re-rendering
        Object.keys(inputValues).forEach(memberId => {
            const input = document.getElementById(`contrib-${memberId}`);
            if (input) {
                input.value = inputValues[memberId];
            }
        });

        // Restore focus if it was on an input
        if (focusedElementId && focusedElementId.startsWith('contrib-')) {
            const focusedInput = document.getElementById(focusedElementId);
            if (focusedInput) {
                focusedInput.focus();
            }
        }
    }


    // Delete a member
    async deleteMember(id) {
        if (!confirm('Remove this member?')) return;
        try {
            const response = await fetch(`/api/members/${id}`, { method: 'DELETE' });
            if (response.ok) {
                this.showNotification('Member removed', 'success');
                await this.loadFromStorage();
            } else {
                this.showNotification('Failed to remove member', 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    // Share member details (login credentials)
    shareMemberDetails(memberId) {
        const member = this.tripData.members.find(m => m.id === memberId);
        if (!member) return;

        const tripName = this.tripData.tripName || 'Trip';
        const tripCode = this.tripData.tripCode;
        const appUrl = 'https://mybudgettrip.onrender.com/';

        const message = `Join the *${tripName}* to check dashboard:\n\n` +
            `Username: ${member.name}\n` +
            `Password: ${tripCode}\n\n` +
            `Link: ${appUrl}`;

        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    }

    // Share member financial details
    shareMemberFinancials(memberId) {
        const member = this.tripData.members.find(m => m.id === memberId);
        if (!member) return;

        const tripName = this.tripData.tripName || 'Trip';
        const expected = Math.round(member.expectedContribution * 100) / 100;
        const paid = Math.round(member.actualContribution * 100) / 100;
        const remaining = Math.round(member.remainingContribution * 100) / 100;
        const balance = Math.round(member.balance * 100) / 100;
        const personal = Math.round((member.personal || 0) * 100) / 100;

        let message = `*${tripName}* - Financial Summary\n\n` +
            `Member: ${member.name}\n\n` +
            `💰 Expected: ₹${expected}\n` +
            `✅ Paid: ₹${paid}\n` +
            `❌ Unpaid: ₹${remaining}\n` +
            `📊 Balance: ₹${balance}\n` +
            `🛍 Personal Expenses: ₹${personal}`;

        // Add trip expenses breakdown
        const memberExpenses = this.tripData.expenses.filter(e => {
            if (e.splitBetween && Array.isArray(e.splitBetween)) {
                return e.splitBetween.includes(member.id);
            } else if (e.paidBy) {
                if (e.paidBy === 'all_members' || e.paidBy === 'pool') {
                    return true;
                }
                return e.paidBy === member.id;
            }
            return false;
        });

        if (memberExpenses.length > 0) {
            message += `\n\n*Trip Expenses*\n`;

            memberExpenses.forEach(e => {
                const expenseDate = e.timestamp ? new Date(e.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';

                // Determine who paid
                let paidByText = 'All Members';
                if (e.paidBy && e.paidBy !== 'pool' && e.paidBy !== 'all_members') {
                    const payer = this.tripData.members.find(m => m.id === e.paidBy);
                    paidByText = payer ? payer.name : 'Unknown';
                }

                // Calculate member's contribution
                let splitMembers = [];
                if (e.splitBetween && Array.isArray(e.splitBetween)) {
                    splitMembers = e.splitBetween;
                } else if (e.paidBy) {
                    if (e.paidBy === 'all_members' || e.paidBy === 'pool') {
                        splitMembers = this.tripData.members.map(m => m.id);
                    } else {
                        splitMembers = [e.paidBy];
                    }
                }

                const totalMembers = splitMembers.length;
                const memberContribution = totalMembers > 0 ? (e.amount / totalMembers) : 0;
                const formattedContribution = Math.round(memberContribution * 100) / 100;

                message += `\n▪ *${e.title}*: ₹${e.amount}${expenseDate ? ` (${expenseDate})` : ''}\n`;
                message += `   Paid by: ${paidByText}\n`;
                message += `   Total member's: ${totalMembers}\n`;
                message += `   ${member.name}'s contribution: ₹${formattedContribution}\n`;
                if (e.description) {
                    message += `   Description: ${e.description}\n`;
                }
            });
        }

        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    }


    // Share all members' financial details
    shareAllMembersFinancials() {
        if (!this.tripData.members || this.tripData.members.length === 0) {
            this.showNotification('No members to share', 'error');
            return;
        }

        const tripName = this.tripData.tripName || 'Trip';
        let message = `*${tripName}* - All Members Financial Summary\n\n`;

        this.tripData.members.forEach((member, index) => {
            const expected = Math.round(member.expectedContribution * 100) / 100;
            const paid = Math.round(member.actualContribution * 100) / 100;
            const remaining = Math.round(member.remainingContribution * 100) / 100;
            const balance = Math.round(member.balance * 100) / 100;
            const personal = Math.round((member.personal || 0) * 100) / 100;

            message += `${index + 1}. *${member.name}*\n`;
            message += `   💰 Expected: ₹${expected}\n`;
            message += `   ✅ Paid: ₹${paid}\n`;
            message += `   ❌ Unpaid: ₹${remaining}\n`;
            message += `   📊 Balance: ₹${balance}\n`;
            message += `   🛍️ Personal: ₹${personal}\n\n`;
        });

        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    }

    // Delete an expense
    async deleteExpense(id) {
        if (!confirm('Delete this expense?')) return;
        try {
            const response = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
            if (response.ok) {
                this.showNotification('Expense deleted', 'success');
                await this.loadFromStorage();
            } else {
                this.showNotification('Failed to delete expense', 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            this.showNotification('Error connecting to server', 'error');
        }
    }

    displayExpenses() {
        const list = document.getElementById('expensesList');
        list.innerHTML = '';

        // Sort expenses by date (newest first)
        const sortedExpenses = [...this.tripData.expenses].sort((a, b) =>
            new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
        );

        if (sortedExpenses.length === 0) {
            list.innerHTML = '<div class="no-data" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No expenses added yet.</div>';
            return;
        }

        const getCategoryIcon = (cat) => {
            const icons = {
                food: 'fastfood',
                transport: 'directions_car',
                accommodation: 'hotel',
                entertainment: 'movie',
                shopping: 'shopping_bag',
                other: 'category'
            };
            return icons[cat] || 'category';
        };

        sortedExpenses.forEach(e => {
            const date = e.timestamp ? new Date(e.timestamp).toLocaleString('en-IN', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : '';

            const deleteBtn = this.currentUser && this.currentUser.role === 'admin' ? `
            <button class="icon-button delete-btn" onclick="tripManager.deleteExpense('${e.id}')" title="Delete Expense">
                <span class="material-icons">delete</span>
            </button>` : '';

            const item = document.createElement('div');
            item.className = 'expense-card';
            item.innerHTML = `
            <div class="expense-header">
                    <div class="expense-title">
                        <span class="material-icons" style="color: var(--primary-color)">${getCategoryIcon(e.category)}</span>
                        ${e.title || 'Untitled Expense'}
                    </div>
                    <div class="expense-amount">₹${e.amount.toLocaleString('en-IN')}</div>
                </div>
            <div class="expense-meta">
                <div class="expense-meta-item">
                    <span class="material-icons">person</span>
                    Paid by ${this.getMemberName(e.paidBy)}
                </div>
                <div class="expense-meta-item">
                    <span class="material-icons">category</span>
                    ${e.category.charAt(0).toUpperCase() + e.category.slice(1)}
                </div>
                ${date ? `
                    <div class="expense-meta-item">
                        <span class="material-icons">schedule</span>
                        ${date}
                    </div>` : ''}
                <div class="expense-actions">
                    ${deleteBtn}
                </div>
            </div>
                ${e.description ? `<div class="expense-description">${e.description}</div>` : ''}
        `;
            list.appendChild(item);
        });
    }

    updateMemberSelect() {
        const select = document.getElementById('paidBy');
        if (!select) return;

        // Save current selection
        const current = select.value;

        select.innerHTML = '<option value="pool">🏦 From Pool (Admin/Collected Money)</option>';
        this.tripData.members.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `👤 ${m.name} (Paid from Pocket)`;
            select.appendChild(opt);
        });

        if (current) select.value = current;
    }

    // --- Modals ---
    hideAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }
    hideMemberModal() { document.getElementById('memberModal').style.display = 'none'; }
    showMemberModal() { document.getElementById('memberModal').style.display = 'flex'; }
    hideEditMemberModal() { document.getElementById('editMemberModal').style.display = 'none'; }
    hideEditTripModal() { document.getElementById('editTripModal').style.display = 'none'; }
    editTripDetails() {
        if (this.currentUser.role !== 'admin') {
            this.showNotification('Only Admin can edit trip details', 'error');
            return;
        }
        document.getElementById('editTripModal').style.display = 'flex';
        document.getElementById('editTripName').value = this.tripData.tripName;
        document.getElementById('editBudgetAmount').value = this.tripData.budget;
        document.getElementById('editMemberCount').value = this.tripData.memberCount;
        document.getElementById('editTripDateTime').value = this.tripData.tripDate;

        // Reset budget type to Total
        document.getElementById('editBudgetType').value = 'total';
        this.toggleEditBudgetInput();
    }

    async handleEditTripSubmit(e) {
        e.preventDefault();
        const tripName = document.getElementById('editTripName').value.trim();
        let budget = parseFloat(document.getElementById('editBudgetAmount').value);
        const memberCount = parseInt(document.getElementById('editMemberCount').value);
        const tripDate = document.getElementById('editTripDateTime').value;
        const budgetType = document.getElementById('editBudgetType').value;

        // Calculate total budget if per-person is selected
        if (budgetType === 'person') {
            budget = budget * memberCount;
        }

        if (!tripName || !budget || !memberCount || !tripDate) {
            this.showNotification('Please fill all fields', 'error');
            return;
        }

        try {
            // Update trip data
            const updatedTrip = {
                ...this.tripData,
                tripName,
                budget,
                memberCount,
                tripDate
            };

            // Recalculate expected contribution
            const newExpected = budget / memberCount;

            // Update all members' expected and remaining amounts
            updatedTrip.members = updatedTrip.members.map(m => {
                const paid = m.actualContribution || 0;
                return {
                    ...m,
                    expectedContribution: newExpected,
                    remainingContribution: newExpected - paid
                };
            });

            // Send update to server
            // We use /api/trip to overwrite trip details. 
            // Note: In a real app, we might want a PATCH endpoint, but /api/trip POST usually resets or updates.
            // Let's check server.js... /api/trip POST overwrites EVERYTHING.
            // So we must be careful.
            // Actually, server.js /api/trip POST takes {tripName, budget, memberCount, tripDate} and RESETS members if we are not careful?
            // Let's check server.js implementation again.
            // Wait, I should check server.js before writing this.
            // But I can't check it inside this tool call.
            // I'll assume I need to send the FULL updated data or use a different endpoint.
            // The server.js I viewed earlier (Step 287) showed /api/trip POST:
            // app.post('/api/trip', (req, res) => { ... writes req.body to data ... })
            // So it overwrites. I need to send the COMPLETE data including members and expenses.

            await fetch('/api/trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedTrip)
            });

            this.showNotification('Trip details updated', 'success');
            this.hideEditTripModal();
            await this.loadFromStorage();

        } catch (error) {
            console.error('Edit trip error:', error);
            this.showNotification('Error updating trip', 'error');
        }
    }

    openEditMemberModal(memberId) {
        const member = this.tripData.members.find(m => m.id === memberId);
        if (!member) return;

        document.getElementById('editMemberId').value = member.id;
        document.getElementById('editMemberName').value = member.name;
        document.getElementById('editExpected').value = member.expectedContribution;
        document.getElementById('editPaid').value = member.actualContribution;
        document.getElementById('editPersonal').value = member.personal;
        document.getElementById('editBalance').value = member.balance || 0;

        document.getElementById('customExpected').checked = member.customExpected || false;
        document.getElementById('customPersonal').checked = member.customPersonal || false;
        document.getElementById('customBalance').checked = member.customBalance || false;

        document.getElementById('editMemberModal').style.display = 'flex';
    }

    async handleEditMemberSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('editMemberId').value;
        const name = document.getElementById('editMemberName').value.trim();
        const expectedContribution = parseFloat(document.getElementById('editExpected').value);
        const actualContribution = parseFloat(document.getElementById('editPaid').value);
        const personal = parseFloat(document.getElementById('editPersonal').value);
        const balance = parseFloat(document.getElementById('editBalance').value);
        const customExpected = document.getElementById('customExpected').checked;
        const customPersonal = document.getElementById('customPersonal').checked;
        const customBalance = document.getElementById('customBalance').checked;

        if (!name) {
            this.showNotification('Please enter a member name', 'error');
            return;
        }

        console.log('Updating member:', { id, name, expectedContribution, actualContribution, personal, balance, customExpected, customPersonal, customBalance });

        try {
            const response = await fetch('/api/members/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    name,
                    expectedContribution,
                    actualContribution,
                    personal,
                    balance,
                    customExpected,
                    customPersonal,
                    customBalance
                })
            });

            const result = await response.json();
            console.log('Update response:', result);

            if (response.ok) {
                // If the edited member is the current user, update localStorage
                if (this.currentUser && this.currentUser.id === id) {
                    this.currentUser.name = name;
                    localStorage.setItem('tripUser', JSON.stringify(this.currentUser));
                }

                this.showNotification('Member updated successfully', 'success');
                this.hideEditMemberModal();
                // Force reload from server
                await this.loadFromStorage();
                // Update display (this will refresh the dashboard title)
                this.updateDisplay();
            } else {
                this.showNotification(result.message || 'Failed to update member', 'error');
            }
        } catch (error) {
            console.error('Update member error:', error);
            this.showNotification('Error updating member', 'error');
        }
    }

    // --- Utils ---
    showNotification(msg, type) {
        const notif = document.getElementById('notification');
        notif.textContent = msg;
        notif.className = `notification show ${type}`;
        setTimeout(() => notif.className = 'notification', 3000);
    }

    copyTripCode() {
        const code = this.tripData.tripCode;
        navigator.clipboard.writeText(code).then(() => {
            this.showNotification('Trip Code copied!', 'success');
        });
    }

    toggleBudgetInput() {
        const type = document.getElementById('budgetType').value;
        const label = document.getElementById('budgetLabel');
        const input = document.getElementById('budgetAmount');

        if (type === 'total') {
            label.innerHTML = '<span class="material-icons">currency_rupee</span> Total Budget (₹)';
            input.placeholder = '30000';
        } else {
            label.innerHTML = '<span class="material-icons">person</span> Amount Per Person (₹)';
            input.placeholder = '5000';
        }
    }

    toggleEditBudgetInput() {
        const type = document.getElementById('editBudgetType').value;
        const label = document.getElementById('editBudgetLabel');
        const input = document.getElementById('editBudgetAmount');

        if (type === 'total') {
            label.textContent = 'Total Budget (₹)';
            // If switching back to total, we might want to show the total budget again
            // But for simplicity, we let the user enter what they want.
            // Or we could calculate it if we had the previous value.
            sortedExpenses.forEach(e => {
                const date = e.timestamp ? new Date(e.timestamp).toLocaleString('en-IN', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '';

                const deleteBtn = this.currentUser && this.currentUser.role === 'admin' ? `
            <button class="icon-button delete-btn" onclick="tripManager.deleteExpense('${e.id}')" title="Delete Expense">
                <span class="material-icons">delete</span>
            </button>` : '';

                const item = document.createElement('div');
                item.className = 'expense-card';
                item.innerHTML = `
            <div class="expense-header">
                    <div class="expense-title">
                        <span class="material-icons" style="color: var(--primary-color)">${getCategoryIcon(e.category)}</span>
                        ${e.title || 'Untitled Expense'}
                    </div>
                    <div class="expense-amount">₹${e.amount.toLocaleString('en-IN')}</div>
                </div>
            <div class="expense-meta">
                <div class="expense-meta-item">
                    <span class="material-icons">person</span>
                    Paid by ${this.getMemberName(e.paidBy)}
                </div>
                <div class="expense-meta-item">
                    <span class="material-icons">category</span>
                    ${e.category.charAt(0).toUpperCase() + e.category.slice(1)}
                </div>
                ${date ? `
                    <div class="expense-meta-item">
                        <span class="material-icons">schedule</span>
                        ${date}
                    </div>` : ''}
                <div class="expense-actions">
                    ${deleteBtn}
                </div>
            </div>
                ${e.description ? `<div class="expense-description">${e.description}</div>` : ''}
        `;
                list.appendChild(item);
            });
        }

    }

    updateMemberSelect() {
        const select = document.getElementById('paidBy');
        if (!select) return;

        // Save current selection
        const current = select.value;

        select.innerHTML = '<option value="">Select Member</option><option value="all_members">👥 All Members (Equal Distribution)</option>';
        this.tripData.members.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            select.appendChild(opt);
        });

        if (current) select.value = current;
    }

    // --- Modals ---
    hideAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }
    hideMemberModal() { document.getElementById('memberModal').style.display = 'none'; }
    showMemberModal() { document.getElementById('memberModal').style.display = 'flex'; }
    hideEditTripModal() { document.getElementById('editTripModal').style.display = 'none'; }
    editTripDetails() {
        if (this.currentUser.role !== 'admin') {
            this.showNotification('Only Admin can edit trip details', 'error');
            return;
        }
        document.getElementById('editTripModal').style.display = 'flex';
        document.getElementById('editTripName').value = this.tripData.tripName;
        document.getElementById('editBudgetAmount').value = this.tripData.budget;
        document.getElementById('editMemberCount').value = this.tripData.memberCount;
        document.getElementById('editTripDateTime').value = this.tripData.tripDate;

        // Reset budget type to Total
        document.getElementById('editBudgetType').value = 'total';
        this.toggleEditBudgetInput();
    }

    async handleEditTripSubmit(e) {
        e.preventDefault();
        const tripName = document.getElementById('editTripName').value.trim();
        let budget = parseFloat(document.getElementById('editBudgetAmount').value);
        const memberCount = parseInt(document.getElementById('editMemberCount').value);
        const tripDate = document.getElementById('editTripDateTime').value;
        const budgetType = document.getElementById('editBudgetType').value;

        // Calculate total budget if per-person is selected
        if (budgetType === 'person') {
            budget = budget * memberCount;
        }

        if (!tripName || !budget || !memberCount || !tripDate) {
            this.showNotification('Please fill all fields', 'error');
            return;
        }

        try {
            // Update trip data
            const updatedTrip = {
                ...this.tripData,
                tripName,
                budget,
                memberCount,
                tripDate
            };

            // Recalculate expected contribution
            const newExpected = budget / memberCount;

            // Update all members' expected and remaining amounts
            updatedTrip.members = updatedTrip.members.map(m => {
                const paid = m.actualContribution || 0;
                return {
                    ...m,
                    expectedContribution: newExpected,
                    remainingContribution: newExpected - paid
                };
            });

            // Send update to server
            // We use /api/trip to overwrite trip details. 
            // Note: In a real app, we might want a PATCH endpoint, but /api/trip POST usually resets or updates.
            // Let's check server.js... /api/trip POST overwrites EVERYTHING.
            // So we must be careful.
            // Actually, server.js /api/trip POST takes {tripName, budget, memberCount, tripDate} and RESETS members if we are not careful?
            // Let's check server.js implementation again.
            // Wait, I should check server.js before writing this.
            // But I can't check it inside this tool call.
            // I'll assume I need to send the FULL updated data or use a different endpoint.
            // The server.js I viewed earlier (Step 287) showed /api/trip POST:
            // app.post('/api/trip', (req, res) => { ... writes req.body to data ... })
            // So it overwrites. I need to send the COMPLETE data including members and expenses.

            await fetch('/api/trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedTrip)
            });

            this.showNotification('Trip details updated', 'success');
            this.hideEditTripModal();
            await this.loadFromStorage();

        } catch (error) {
            console.error('Edit trip error:', error);
            this.showNotification('Error updating trip', 'error');
        }
    }

    // --- Utils ---
    showNotification(msg, type) {
        const notif = document.getElementById('notification');
        notif.textContent = msg;
        notif.className = `notification show ${type}`;
        setTimeout(() => notif.className = 'notification', 3000);
    }

    copyTripCode() {
        const code = this.tripData.tripCode;
        navigator.clipboard.writeText(code).then(() => {
            this.showNotification('Trip Code copied!', 'success');
        });
    }

    toggleBudgetInput() {
        const type = document.getElementById('budgetType').value;
        const label = document.getElementById('budgetLabel');
        const input = document.getElementById('budgetAmount');

        if (type === 'total') {
            label.innerHTML = '<span class="material-icons">currency_rupee</span> Total Budget (₹)';
            input.placeholder = '30000';
        } else {
            label.innerHTML = '<span class="material-icons">person</span> Amount Per Person (₹)';
            input.placeholder = '5000';
        }
    }

    toggleEditBudgetInput() {
        const type = document.getElementById('editBudgetType').value;
        const label = document.getElementById('editBudgetLabel');
        const input = document.getElementById('editBudgetAmount');

        if (type === 'total') {
            label.textContent = 'Total Budget (₹)';
            // If switching back to total, we might want to show the total budget again
            // But for simplicity, we let the user enter what they want.
            // Or we could calculate it if we had the previous value.
            // Let's just update label.
        } else {
            label.textContent = 'Amount Per Person (₹)';
        }
    }

    async shareTripDetails() {
        const code = this.tripData.tripCode;
        const adminName = this.tripData.members.length > 0 ? this.tripData.members[0].name : 'Admin';
        const tripName = this.tripData.tripName || 'trip';
        const url = window.location.origin;
        const text = `🗺️ Ready to make trip planning fun, simple, and stress-free?
With Trip Budget Manager, you can manage shared expenses, stay organized, and enjoy more time exploring!
Join ${adminName}'s ${tripName} using the code ➝ ${code} 😎💳
🔗 Jump in: ${url}

Let's go make moments that matter! 🌅💫`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Join my Trip!',
                    text: text
                });
                this.showNotification('Shared successfully!', 'success');
            } catch (err) {
                console.error('Error sharing:', err);
                this.fallbackShare(text);
            }
        } else {
            this.fallbackShare(text);
        }
    }

    fallbackShare(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification('Invite copied to clipboard!', 'success');
            alert("Invite copied to clipboard:\n\n" + text);
        }).catch(err => {
            console.error('Clipboard error:', err);
            prompt("Copy this invite message:", text);
        });
    }

    shareExpensesToWhatsApp() {
        if (!this.tripData.expenses || this.tripData.expenses.length === 0) {
            this.showNotification('No expenses to share', 'error');
            return;
        }

        let message = `*Trip Expenses - ${this.tripData.tripName}*\n\n`;
        this.tripData.expenses.forEach(exp => {
            const date = new Date(exp.timestamp).toLocaleDateString();
            message += `▪️ *${exp.title}*: ₹${exp.amount} (${date})\n`;
            message += `   Paid by: ${this.getMemberName(exp.paidBy)}\n`;

            // Show split between members
            let splitMembers = [];
            if (exp.splitBetween && Array.isArray(exp.splitBetween)) {
                splitMembers = exp.splitBetween.map(id => this.getMemberName(id));
            } else if (exp.paidBy) {
                if (exp.paidBy === 'all_members' || exp.paidBy === 'pool') {
                    splitMembers = ['All Members'];
                } else {
                    splitMembers = [this.getMemberName(exp.paidBy)];
                }
            }

            if (splitMembers.length > 0) {
                message += `   Split between: ${splitMembers.join(', ')}\n`;
            }

            if (exp.description) {
                message += `   Description: ${exp.description}\n`;
            }
            message += `\n`;
        });

        const totalSpent = document.getElementById('totalSpent') ? document.getElementById('totalSpent').textContent : '0';
        message += `Total Spent: ${totalSpent} \n`;
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    }
}

// Initialize
const tripManager = new TripBudgetManager();

// Global functions for HTML onclick attributes
window.exportToPDF = () => alert('PDF Export feature coming soon!');
window.exportData = () => alert('Data Export feature coming soon!');
window.resetApp = async () => {
    const user = JSON.parse(localStorage.getItem('tripUser'));
    if (!user || user.role !== 'admin') {
        alert('Only Admin can reset the app.');
        return;
    }
    if (confirm('Are you sure? This will delete all data.')) {
        await fetch('/api/reset', { method: 'POST' });
        localStorage.removeItem('tripUser');
        location.reload();
    }
};
window.showSetupForm = () => tripManager.showSetupForm();
window.backToSetup = () => tripManager.backToSetup();
window.editTripDetails = () => tripManager.editTripDetails();
window.hideEditTripModal = () => tripManager.hideEditTripModal();
window.showMemberModal = () => tripManager.showMemberModal();
window.hideMemberModal = () => tripManager.hideMemberModal();
window.toggleExpensesVisibility = () => {
    const list = document.getElementById('expensesList');
    const icon = document.getElementById('expensesToggleIcon');
    list.classList.toggle('hidden');
    if (icon) {
        icon.textContent = list.classList.contains('hidden') ? 'expand_more' : 'expand_less';
    }
};
window.toggleMembersVisibility = () => {
    const grid = document.getElementById('membersGrid');
    grid.classList.toggle('hidden');
};
window.copyTripCode = () => tripManager.copyTripCode();
window.shareTripDetails = () => tripManager.shareTripDetails();
window.shareExpensesToWhatsApp = () => tripManager.shareExpensesToWhatsApp();

// Dark Mode Logic
// Dark Mode Logic
window.toggleDarkMode = function () {
    console.log('Toggling dark mode');
    const body = document.body;
    body.classList.toggle('dark-mode');
    const isDarkMode = body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDarkMode);
    updateDarkModeIcon(isDarkMode);
}

function checkDarkMode() {
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    }
    updateDarkModeIcon(isDarkMode);
}

function updateDarkModeIcon(isDarkMode) {
    const btn = document.getElementById('darkModeBtn');
    if (btn) {
        const icon = btn.querySelector('.material-icons');
        const text = document.getElementById('darkModeText');
        if (icon) {
            // Use brightness_2 (moon) for Dark Mode (when it's currently Light)
            // Use brightness_7 (sun) for Light Mode (when it's currently Dark)
            icon.textContent = isDarkMode ? 'brightness_7' : 'brightness_2';
        }
        if (text) {
            text.textContent = isDarkMode ? 'Day Mode' : 'Night Mode';
        }
        btn.title = isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('tripUser');
        location.reload();
    }
}

// Initialize Dark Mode
checkDarkMode();

// Auto-refresh page every 5 minutes to keep data synchronized
// This ensures all users see the latest updates from other members
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

setInterval(() => {
    console.log('Auto-refreshing page to sync latest data...');
    location.reload();
}, AUTO_REFRESH_INTERVAL);

console.log('✅ Auto-refresh enabled: Page will reload every 5 minutes');

// Multi-select dropdown functions
function toggleSplitDropdown() {
    const options = document.getElementById('splitBetweenOptions');
    const trigger = document.querySelector('.multiselect-trigger');

    if (options.style.display === 'none') {
        options.style.display = 'block';
        trigger.classList.add('active');
    } else {
        options.style.display = 'none';
        trigger.classList.remove('active');
    }
}

function handleSplitAllChange() {
    const allCheckbox = document.getElementById('splitAllMembers');
    const memberCheckboxes = document.querySelectorAll('#splitMembersList input[type="checkbox"]');

    if (allCheckbox.checked) {
        // Uncheck all individual members
        memberCheckboxes.forEach(cb => cb.checked = false);
    }

    updateSplitLabel();
}

function handleMemberSplitChange() {
    const allCheckbox = document.getElementById('splitAllMembers');
    const memberCheckboxes = document.querySelectorAll('#splitMembersList input[type="checkbox"]');
    const anyChecked = Array.from(memberCheckboxes).some(cb => cb.checked);

    if (anyChecked) {
        // Uncheck "All Members"
        allCheckbox.checked = false;
    } else {
        // If no members selected, check "All Members"
        allCheckbox.checked = true;
    }

    updateSplitLabel();
}

function updateSplitLabel() {
    const allCheckbox = document.getElementById('splitAllMembers');
    const memberCheckboxes = document.querySelectorAll('#splitMembersList input[type="checkbox"]');
    const label = document.getElementById('splitBetweenLabel');

    if (allCheckbox.checked) {
        label.textContent = 'All Members';
    } else {
        const checkedMembers = Array.from(memberCheckboxes).filter(cb => cb.checked);
        if (checkedMembers.length === 0) {
            label.textContent = 'Select Members';
        } else if (checkedMembers.length === 1) {
            label.textContent = checkedMembers[0].nextElementSibling.textContent;
        } else {
            label.textContent = `${checkedMembers.length} Members Selected`;
        }
    }
}

function populateSplitMembers(members) {
    const container = document.getElementById('splitMembersList');
    if (!container) return;

    // Save current checkbox states before clearing
    const checkedStates = {};
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            checkedStates[cb.value] = true;
        }
    });

    container.innerHTML = '';
    members.forEach(member => {
        const label = document.createElement('label');
        label.className = 'multiselect-option';
        const isChecked = checkedStates[member.id] ? 'checked' : '';
        label.innerHTML = `
            <input type="checkbox" value="${member.id}" ${isChecked} onchange="handleMemberSplitChange()">
            <span>${member.name}</span>
        `;
        container.appendChild(label);
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', function (event) {
    const container = document.getElementById('splitBetweenContainer');
    if (container && !container.contains(event.target)) {
        const options = document.getElementById('splitBetweenOptions');
        const trigger = document.querySelector('.multiselect-trigger');
        if (options) options.style.display = 'none';
        if (trigger) trigger.classList.remove('active');
    }
});
