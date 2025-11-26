# Trip Budget Manager Web App

A comprehensive web application for managing group trip budgets with Google Material Design-inspired UI.

## Features

### 🎯 Trip Dashboard
- **Trip title** with customizable name
- **Total planned budget** display
- **Total collected amount** from all members
- **Total spent amount** on expenses
- **Remaining balance** calculation
- **Date and time** of the trip
- **Number of members** tracking

### 👥 Member Management
- **Add members** with name and initial contribution
- **Auto-calculated expected contribution**: Total budget ÷ Number of members
- **Track actual contributions** paid by each member
- **Visual alerts** for members with pending payments
- **Individual member balances** based on contributions and expenses
- **Add more contributions** for existing members
- **Delete members** with expense handling

### 💰 Budget Calculations
**Example Scenario:**
- Total budget: ₹30,000
- Members: 6
- Expected per person: ₹5,000
- If 5 members pay ₹5,000 and 1 member pays ₹3,000:
  - Total collected: ₹27,000
  - Remaining to reach full budget: ₹3,000

### 🧾 Expense Manager
- **Add expenses** with title, amount, category, and paid-by member
- **Automatic deduction** from collected amount
- **Category filtering** (Food, Transport, Accommodation, Entertainment, Shopping, Other)
- **Individual member balances** after expenses
- **Delete expenses** with confirmation

**Balance Calculation Example:**
- Expense: ₹1,200
- Remaining balances:
  - For the 5 members: ₹4,800 each (₹5,000 - ₹200 share)
  - For the member who paid ₹3,000: ₹2,800 (₹3,000 - ₹200 share)

### ✏️ Editing Features
- **Edit trip details**: name, budget, date/time
- **Modify member contributions**
- **Delete expenses** and members
- **Dynamic recalculation** of all values

### 🚨 Visual Alerts
- **Unpaid member balances** warnings
- **Low budget remaining** notifications
- **Over budget** alerts
- **Budget collection progress** bar
- **Color-coded status** indicators

### 💾 Data Management
- **Local storage** persistence
- **Export data** to JSON file
- **Reset application** option
- **Auto-save** on all changes

## Installation & Usage

1. **Download** the complete folder containing:
   - `index.html` - Main application
   - `styles.css` - Material Design styling
   - `script.js` - Complete functionality
   - `README.md` - This documentation

2. **Open `index.html`** in any modern web browser

3. **Set up your trip**:
   - Enter trip name
   - Set total budget
   - Specify number of members
   - Choose date and time

4. **Add members** with their initial contributions

5. **Start managing expenses** and tracking budgets

## Technical Details

### Technologies Used
- **HTML5** semantic structure
- **CSS3** with Google Material Design principles
- **Vanilla JavaScript** (ES6+) with localStorage
- **Google Fonts** (Roboto)
- **Material Icons** (Google CDN)

### Key Features
- **Responsive design** for all screen sizes
- **Real-time calculations** and updates
- **Data persistence** using localStorage
- **Modal-based UI** for forms and details
- **Progress tracking** with visual indicators
- **Category-based expense** management

### Browser Compatibility
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## File Structure

```
complete/
├── index.html          # Main application file
├── styles.css          # Complete styling
├── script.js           # All functionality
└── README.md           # Documentation
```

## Example Workflow

1. **Setup Phase**:
   - Trip: "Goa Beach Trip"
   - Budget: ₹30,000
   - Members: 6
   - Expected per person: ₹5,000

2. **Member Contributions**:
   - 5 members pay ₹5,000 each
   - 1 member pays ₹3,000
   - Total collected: ₹27,000
   - Remaining needed: ₹3,000

3. **Expense Tracking**:
   - Add expense: "Dinner" - ₹1,200 (paid by Member 1)
   - Individual balances update automatically
   - Remaining amount adjusts accordingly

4. **Real-time Updates**:
   - All calculations update instantly
   - Visual alerts for budget status
   - Progress bars show collection status

## Support

This application is ready-to-run and requires no additional setup or dependencies. Simply open the `index.html` file in your browser to start using the Trip Budget Manager.

For questions or issues, please refer to the in-app notifications and visual guides.
# mybudgettrip
