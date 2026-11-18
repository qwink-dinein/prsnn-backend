# Graph Report - prsnn-backend  (2026-11-18)

## Corpus Check
- 156 files · ~90,498 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 554 nodes · 1404 edges · 24 communities (18 shown, 6 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3e4d23e7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- User.js
- app.js
- mongoose
- phoneAuth.controller.js
- server.js
- allocation.js
- dependencies
- package.json
- devDependencies
- allowBuilds
- scripts
- cache.middleware.js
- helmet
- cloudinary
- adminApp.controller.js
- fellows.controller.js
- server.js
- notify/index.ts
- pricing.js
- profile.controller.js
- notify/index.ts
- multer
- multer-storage-cloudinary
- razorpay

## God Nodes (most connected - your core abstractions)
1. `vitest` - 25 edges
2. `audit()` - 24 edges
3. `validId()` - 21 edges
4. `bookingAdminView()` - 16 edges
5. `issueRefund()` - 16 edges
6. `invalidateCompanionsCache()` - 15 edges
7. `pricing()` - 15 edges
8. `mongoose` - 15 edges
9. `express` - 14 edges
10. `offerNext()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `deleteUser()` --calls--> `invalidateCompanionsCache()`  [EXTRACTED]
  src/controllers/admin.controller.js → src/controllers/fellows.controller.js
- `verifyUser()` --calls--> `invalidateCompanionsCache()`  [EXTRACTED]
  src/controllers/admin.controller.js → src/controllers/fellows.controller.js
- `pinLogin()` --calls--> `comparePassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `setPin()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `openDispute()` --calls--> `sendEmail()`  [EXTRACTED]
  src/controllers/prepaid.controller.js → src/utils/sendEmail.js

## Import Cycles
- None detected.

## Communities (24 total, 6 thin omitted)

### Community 0 - "User.js"
Cohesion: 0.08
Nodes (39): jsonwebtoken, createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats() (+31 more)

### Community 1 - "app.js"
Cohesion: 0.08
Nodes (25): express, limiter, clearNotifications(), getNotifications(), getPublicStats(), requireStaff(), STAFF_ROLES, SUPER_ROLES (+17 more)

### Community 2 - "mongoose"
Cohesion: 0.25
Nodes (5): mongoose@^9.1.5, mongoose, BroadcastSchema, SettingsSchema, old

### Community 3 - "phoneAuth.controller.js"
Cohesion: 0.06
Nodes (45): vitest, MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS (+37 more)

### Community 4 - "server.js"
Cohesion: 0.16
Nodes (15): bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings() (+7 more)

### Community 5 - "allocation.js"
Cohesion: 0.07
Nodes (59): createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), acceptPrepaidOffer(), createPrepaidBooking() (+51 more)

### Community 6 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, bcrypt@^6.0.0, compression@^1.8.1, cors@^2.8.5, eslint@^10.1.0, express@^5.2.1, express-rate-limit@^8.2.1, jsonwebtoken@^9.0.3 (+11 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): author, lint@^0.8.19, socket.io@^4.8.3, description, engines, node, keywords, license (+7 more)

### Community 8 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, morgan@^1.10.1, nodemon@^3.1.11, supertest@^7.2.2, vitest@^4.1.0, morgan, nodemon, supertest

### Community 9 - "allowBuilds"
Cohesion: 0.33
Nodes (5): allowBuilds, bcrypt, core-js, lint, mongodb-memory-server

### Community 10 - "scripts"
Cohesion: 0.50
Nodes (4): scripts, dev, start, test

### Community 14 - "adminApp.controller.js"
Cohesion: 0.10
Nodes (52): addAdmin(), AUDIENCE_QUERY, bookingAdminView(), broadcast(), cancelBooking(), closeDispute(), createNotification(), DAYS (+44 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.17
Nodes (19): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+11 more)

### Community 16 - "server.js"
Cohesion: 0.18
Nodes (10): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV (+2 more)

### Community 17 - "notify/index.ts"
Cohesion: 0.09
Nodes (27): clean(), fold(), STATE, STATES, title(), db, Order, Payment (+19 more)

### Community 18 - "pricing.js"
Cohesion: 0.12
Nodes (26): cutoff(), fee(), router, PRICING_TTL_MS, refreshPricing(), savePricing(), startPricingRefresh(), ALL_HOURS (+18 more)

### Community 19 - "profile.controller.js"
Cohesion: 0.12
Nodes (24): checkProfile(), deleteOwnAccount(), getProfile(), onboardAdmin(), onboardBasic(), onboardCompanion(), savePushToken(), updateProfile() (+16 more)

### Community 20 - "notify/index.ts"
Cohesion: 0.18
Nodes (12): cors, brand(), dateText(), db, durText(), Item, rupees(), timeText() (+4 more)

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `phoneAuth.controller.js` to `User.js`, `app.js`, `server.js`, `allocation.js`, `package.json`, `devDependencies`, `fellows.controller.js`, `pricing.js`, `profile.controller.js`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Should `User.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08311688311688312 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `mongoose` to `User.js`, `server.js`, `allocation.js`, `package.json`, `adminApp.controller.js`, `server.js`, `pricing.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08412698412698413 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `User.js`, `server.js`, `allocation.js`, `dependencies`, `package.json`, `fellows.controller.js`, `pricing.js`, `profile.controller.js`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `allocation.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06698564593301436 - nodes in this community are weakly interconnected._