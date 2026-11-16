# Graph Report - prsnn-backend  (2026-11-16)

## Corpus Check
- 138 files · ~81,504 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 550 nodes · 1400 edges · 19 communities (18 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7201bfa2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- User.js
- app.js
- mongoose
- phoneAuth.controller.js
- booking.controller.js
- allocation.js
- dependencies
- package.json
- devDependencies
- allowBuilds
- scripts
- cache.middleware.js
- upload.middleware.js
- adminApp.controller.js
- fellows.controller.js
- server.js
- notify/index.ts
- pricing.js
- profile.controller.js

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

## Communities (19 total, 1 thin omitted)

### Community 0 - "User.js"
Cohesion: 0.08
Nodes (39): jsonwebtoken, createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats() (+31 more)

### Community 1 - "app.js"
Cohesion: 0.08
Nodes (25): express, limiter, clearNotifications(), getNotifications(), getPublicStats(), requireStaff(), STAFF_ROLES, SUPER_ROLES (+17 more)

### Community 2 - "mongoose"
Cohesion: 0.20
Nodes (6): mongoose@^9.1.5, mongoose, AuditLogSchema, BroadcastSchema, SettingsSchema, old

### Community 3 - "phoneAuth.controller.js"
Cohesion: 0.10
Nodes (32): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+24 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.12
Nodes (18): vitest, bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings() (+10 more)

### Community 5 - "allocation.js"
Cohesion: 0.06
Nodes (58): createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), NotificationSchema, acceptOffer() (+50 more)

### Community 6 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, bcrypt@^6.0.0, compression@^1.8.1, express@^5.2.1, express-rate-limit@^8.2.1, helmet@^8.1.0, jsonwebtoken@^9.0.3, lint@^0.8.19 (+13 more)

### Community 7 - "package.json"
Cohesion: 0.11
Nodes (17): author, cors@^2.8.5, eslint@^10.1.0, razorpay@^2.9.6, description, engines, node, keywords (+9 more)

### Community 8 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, morgan@^1.10.1, nodemon@^3.1.11, supertest@^7.2.2, vitest@^4.1.0, morgan, nodemon, supertest

### Community 9 - "allowBuilds"
Cohesion: 0.33
Nodes (5): allowBuilds, bcrypt, core-js, lint, mongodb-memory-server

### Community 10 - "scripts"
Cohesion: 0.50
Nodes (4): scripts, dev, start, test

### Community 13 - "upload.middleware.js"
Cohesion: 0.14
Nodes (10): cloudinary@^1.41.3, multer@^2.0.2, multer-storage-cloudinary@^4.0.0, cloudinary, multer, multer-storage-cloudinary, base, diskStorage (+2 more)

### Community 14 - "adminApp.controller.js"
Cohesion: 0.10
Nodes (57): addAdmin(), AUDIENCE_QUERY, bookingAdminView(), broadcast(), cancelBooking(), closeDispute(), createNotification(), DAYS (+49 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.17
Nodes (19): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+11 more)

### Community 16 - "server.js"
Cohesion: 0.18
Nodes (10): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV (+2 more)

### Community 17 - "notify/index.ts"
Cohesion: 0.07
Nodes (37): cors, clean(), fold(), STATE, STATES, title(), brand(), dateText() (+29 more)

### Community 18 - "pricing.js"
Cohesion: 0.08
Nodes (36): acceptPrepaidOffer(), createPrepaidBooking(), cutoff(), declinePrepaidOffer(), fee(), getPolicy(), openDispute(), POLICY (+28 more)

### Community 19 - "profile.controller.js"
Cohesion: 0.17
Nodes (15): checkProfile(), deleteOwnAccount(), getProfile(), onboardAdmin(), onboardBasic(), savePushToken(), router, diff() (+7 more)

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `booking.controller.js` to `User.js`, `app.js`, `phoneAuth.controller.js`, `allocation.js`, `package.json`, `devDependencies`, `fellows.controller.js`, `pricing.js`, `profile.controller.js`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Should `User.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08311688311688312 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `mongoose` to `User.js`, `booking.controller.js`, `allocation.js`, `package.json`, `adminApp.controller.js`, `server.js`, `pricing.js`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08412698412698413 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `User.js`, `booking.controller.js`, `allocation.js`, `dependencies`, `package.json`, `fellows.controller.js`, `pricing.js`, `profile.controller.js`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09565217391304348 - nodes in this community are weakly interconnected._
- **Should `booking.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._