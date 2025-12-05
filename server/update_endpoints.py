"""
Script to help update remaining endpoints for multi-trip architecture.
This generates the pattern for updating each endpoint.
"""

# List of remaining endpoints to update
endpoints = [
    # Contribution endpoints
    ("POST", "/api/contributions/request", ["tripCode", "memberId", "amount", "memberName"]),
    ("POST", "/api/contributions/approve", ["tripCode", "id", "action"]),
    ("DELETE", "/api/contributions/request/:id", ["tripCode", "id"]),
    
    # Expense endpoints
    ("POST", "/api/expenses", ["tripCode", "expense"]),
    ("POST", "/api/expenses/request", ["tripCode", "expense"]),
    ("POST", "/api/expenses/approve", ["tripCode", "id", "action"]),
    ("DELETE", "/api/expenses/:id", ["tripCode", "id"]),
    
    # Member approval/delete endpoints
    ("POST", "/api/members/approve", ["tripCode", "id", "action", "details"]),
    ("DELETE", "/api/members/:id", ["tripCode", "id"]),
    ("POST", "/api/members/delete-request", ["tripCode", "memberId", "memberName"]),
    ("POST", "/api/members/delete-approve", ["tripCode", "id", "action"]),
    ("POST", "/api/members/reimburse", ["tripCode", "id", "amount"]),
    ("POST", "/api/members/refund", ["tripCode", "id", "amount"]),
    
    # Budget endpoints
    ("POST", "/api/budget/request", ["tripCode", "memberId", "memberName", "amount", "reason"]),
    ("POST", "/api/budget/approve", ["tripCode", "id", "action"]),
    ("DELETE", "/api/budget/request/:id", ["tripCode", "id"]),
]

print("Remaining endpoints to update:")
for method, path, params in endpoints:
    print(f"{method} {path}")
    print(f"  Params: {', '.join(params)}")
    print()
