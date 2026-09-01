# Frontend Review Status

## Pass 8 — Register / Cash — Mobile First

- Register opening flow: completed
- Opening balance visibility: completed
- Active-session summary: completed
- Cash/card/transfer summary: completed
- Close-session flow: completed
- Actual cash count: completed
- Difference/surplus/shortage visibility: completed
- Mobile session history cards: completed
- Desktop session table retained: completed
- Touch-friendly mobile actions: completed

### Backend follow-up
The UI is ready, but the accounting layer still needs the following before production:
- atomic register/session accounting
- link every cash movement to session + cashier
- partial payments correctness
- refund method ledgering
- expenses/deposits if enabled
- live expected cash before closing
