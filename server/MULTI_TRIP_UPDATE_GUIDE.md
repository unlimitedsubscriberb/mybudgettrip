# Multi-Trip Backend Update Guide

## Pattern for Updating Endpoints

All endpoints need to follow this pattern:

### Before (Single Trip):
```javascript
app.post('/api/members', (req, res) => {
    const data = readData();
    // ... operations on data ...
    writeData(data);
    res.json({ data });
});
```

### After (Multi-Trip):
```javascript
app.post('/api/members', async (req, res) => {
    try {
        const { tripCode, ...otherData } = req.body;
        const trip = await getTripByCode(tripCode);
        
        if (!trip) {
            return res.status(404).json({ message: 'Trip not found' });
        }
        
        // ... operations on trip ...
        await saveTrip(trip);
        res.json({ data: trip, tripCode });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});
```

## Endpoints to Update

### Member Endpoints:
- POST /api/members - Add tripCode to body
- POST /api/members/update - Add tripCode to body
- POST /api/members/activity - Add tripCode to body
- POST /api/members/contribute - Add tripCode to body
- DELETE /api/members/:id - Add tripCode to body
- POST /api/members/reimburse - Add tripCode to body
- POST /api/members/refund - Add tripCode to body
- POST /api/members/approve - Add tripCode to body
- POST /api/members/delete-request - Add tripCode to body
- POST /api/members/delete-approve - Add tripCode to body

### Expense Endpoints:
- POST /api/expenses - Add tripCode to body
- POST /api/expenses/request - Add tripCode to body
- POST /api/expenses/approve - Add tripCode to body
- DELETE /api/expenses/:id - Add tripCode to body

### Contribution Endpoints:
- POST /api/contributions/request - Add tripCode to body
- POST /api/contributions/approve - Add tripCode to body
- DELETE /api/contributions/request/:id - Add tripCode to body

### Budget Endpoints:
- POST /api/budget/request - Add tripCode to body
- POST /api/budget/approve - Add tripCode to body
- DELETE /api/budget/request/:id - Add tripCode to body

### Reset Endpoint:
- POST /api/reset - Should delete specific trip by tripCode (not all data)
