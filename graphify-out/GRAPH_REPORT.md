# Graph Report - prsnn-backend  (2026-11-10)

## Corpus Check
- 103 files · ~59,539 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 524 nodes · 1337 edges · 24 communities (18 shown, 6 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6ae9aacf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- User.js
- auth.route.js
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
- whatsappNotify.js
- cloudinary
- adminApp.controller.js
- fellows.controller.js
- server.js
- notify/index.ts
- pricing.js
- adminRoutes.test.js
- lint@^0.8.19
- multer
- razorpay
- uuid@^13.0.0

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
- `pinLogin()` --calls--> `comparePassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `openDispute()` --calls--> `sendEmail()`  [EXTRACTED]
  src/controllers/prepaid.controller.js → src/utils/sendEmail.js
- `pinLogin()` --calls--> `generateToken()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/token.js
- `verifyPhoneOtp()` --calls--> `generateToken()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/token.js
- `markBookingPaid()` --calls--> `markPaid()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/controllers/payment.controller.js

## Import Cycles
- None detected.

## Communities (24 total, 6 thin omitted)

### Community 0 - "User.js"
Cohesion: 0.08
Nodes (35): jsonwebtoken, vitest, createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers() (+27 more)

### Community 1 - "auth.route.js"
Cohesion: 0.09
Nodes (24): express, express-rate-limit, limiter, clearNotifications(), getNotifications(), getPublicStats(), authMiddleware(), requireStaff() (+16 more)

### Community 2 - "mongoose"
Cohesion: 0.25
Nodes (5): mongoose@^9.1.5, mongoose, BroadcastSchema, SettingsSchema, old

### Community 3 - "phoneAuth.controller.js"
Cohesion: 0.10
Nodes (32): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+24 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.13
Nodes (18): bookingView(), cancelBooking(), confirmedPaid(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings(), personView() (+10 more)

### Community 5 - "allocation.js"
Cohesion: 0.07
Nodes (55): createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), acceptPrepaidOffer(), createPrepaidBooking() (+47 more)

### Community 6 - "dependencies"
Cohesion: 0.11
Nodes (18): dependencies, bcrypt@^6.0.0, cors@^2.8.5, eslint@^10.1.0, express@^5.2.1, express-rate-limit@^8.2.1, jsonwebtoken@^9.0.3, multer-storage-cloudinary@^4.0.0 (+10 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): author, compression@^1.8.1, helmet@^8.1.0, description, engines, node, keywords, license (+7 more)

### Community 8 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, morgan@^1.10.1, nodemon@^3.1.11, supertest@^7.2.2, vitest@^4.1.0, morgan, nodemon, supertest

### Community 9 - "allowBuilds"
Cohesion: 0.33
Nodes (5): allowBuilds, bcrypt, core-js, lint, mongodb-memory-server

### Community 10 - "scripts"
Cohesion: 0.50
Nodes (4): scripts, dev, start, test

### Community 12 - "whatsappNotify.js"
Cohesion: 0.15
Nodes (12): booking, companion, ENV, requester, bodyFor, DAY, durationText(), firstName() (+4 more)

### Community 14 - "adminApp.controller.js"
Cohesion: 0.10
Nodes (52): addAdmin(), AUDIENCE_QUERY, bookingAdminView(), broadcast(), cancelBooking(), closeDispute(), createNotification(), DAYS (+44 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.14
Nodes (23): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+15 more)

### Community 16 - "server.js"
Cohesion: 0.16
Nodes (11): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV (+3 more)

### Community 17 - "notify/index.ts"
Cohesion: 0.13
Nodes (17): cors, brand(), dateText(), db, durText(), Item, rupees(), timeText() (+9 more)

### Community 18 - "pricing.js"
Cohesion: 0.09
Nodes (40): updatePricing(), createBooking(), checkProfile(), deleteOwnAccount(), getProfile(), onboardAdmin(), onboardBasic(), onboardCompanion() (+32 more)

### Community 19 - "adminRoutes.test.js"
Cohesion: 0.15
Nodes (13): savePushToken(), app, asSub(), asSuper(), bearer(), bookings, ID, people (+5 more)

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `User.js` to `phoneAuth.controller.js`, `booking.controller.js`, `allocation.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `fellows.controller.js`, `pricing.js`, `adminRoutes.test.js`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Should `User.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08345428156748912 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `mongoose` to `User.js`, `booking.controller.js`, `allocation.js`, `package.json`, `adminApp.controller.js`, `server.js`, `pricing.js`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Should `auth.route.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08534850640113797 - nodes in this community are weakly interconnected._
- **Why does `express` connect `auth.route.js` to `User.js`, `booking.controller.js`, `allocation.js`, `dependencies`, `package.json`, `fellows.controller.js`, `pricing.js`, `adminRoutes.test.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09797979797979799 - nodes in this community are weakly interconnected._
- **Should `booking.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13054187192118227 - nodes in this community are weakly interconnected._