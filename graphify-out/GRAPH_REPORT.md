# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 84 files · ~40,474 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 500 nodes · 1302 edges · 21 communities (18 shown, 3 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7a80f441`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- User.js
- payment.controller.js
- admin.controller.js
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
- upload.middleware.js
- adminApp.controller.js
- fellows.controller.js
- server.js
- express-rate-limit
- pricing.js
- adminRoutes.test.js
- lint@^0.8.19

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
- `updateUser()` --calls--> `cleanPackages()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/utils/pricing.js
- `updateUser()` --calls--> `dayEndMin()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/utils/pricing.js
- `updateUser()` --calls--> `dayStartMin()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/utils/pricing.js
- `updateUser()` --calls--> `pricing()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/utils/pricing.js
- `addAdmin()` --calls--> `normaliseIndianMobile()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/utils/phone.js

## Import Cycles
- None detected.

## Communities (21 total, 3 thin omitted)

### Community 0 - "User.js"
Cohesion: 0.15
Nodes (18): jsonwebtoken, vitest, login(), signup(), forgotPassword(), generateOTP(), resetPassword(), sendVerificationOtp() (+10 more)

### Community 1 - "payment.controller.js"
Cohesion: 0.10
Nodes (25): express, limiter, clearNotifications(), getNotifications(), createPaymentIntent(), markPaid(), payableError(), razorpayWebhook() (+17 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.10
Nodes (25): mongoose@^9.1.5, mongoose, createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers() (+17 more)

### Community 3 - "phoneAuth.controller.js"
Cohesion: 0.10
Nodes (32): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+24 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.08
Nodes (31): bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings() (+23 more)

### Community 5 - "allocation.js"
Cohesion: 0.14
Nodes (33): acceptOffer(), DAYS, declineOffer(), failAllocation(), findCandidates(), hasConflict(), isAvailableFor(), IST_OFFSET_MS (+25 more)

### Community 6 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, bcrypt@^6.0.0, compression@^1.8.1, cors@^2.8.5, eslint@^10.1.0, express@^5.2.1, helmet@^8.1.0, jsonwebtoken@^9.0.3 (+11 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): author, resend@^6.9.3, socket.io@^4.8.3, description, engines, node, keywords, license (+7 more)

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

### Community 13 - "upload.middleware.js"
Cohesion: 0.14
Nodes (10): cloudinary@^1.41.3, multer@^2.0.2, multer-storage-cloudinary@^4.0.0, cloudinary, multer, multer-storage-cloudinary, base, diskStorage (+2 more)

### Community 14 - "adminApp.controller.js"
Cohesion: 0.10
Nodes (53): addAdmin(), AUDIENCE_QUERY, bookingAdminView(), broadcast(), cancelBooking(), closeDispute(), createNotification(), DAYS (+45 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.15
Nodes (21): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+13 more)

### Community 16 - "server.js"
Cohesion: 0.18
Nodes (10): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV (+2 more)

### Community 18 - "pricing.js"
Cohesion: 0.10
Nodes (36): cutoff(), fee(), checkProfile(), deleteOwnAccount(), getProfile(), onboardAdmin(), onboardBasic(), onboardCompanion() (+28 more)

### Community 19 - "adminRoutes.test.js"
Cohesion: 0.11
Nodes (19): requireStaff(), STAFF_ROLES, SUPER_ROLES, adminTopLevel, money, ops, router, app (+11 more)

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `User.js` to `payment.controller.js`, `phoneAuth.controller.js`, `booking.controller.js`, `allocation.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `fellows.controller.js`, `pricing.js`, `adminRoutes.test.js`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Should `payment.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0951219512195122 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `admin.controller.js` to `User.js`, `payment.controller.js`, `booking.controller.js`, `package.json`, `adminApp.controller.js`, `server.js`, `pricing.js`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10080645161290322 - nodes in this community are weakly interconnected._
- **Why does `express` connect `payment.controller.js` to `User.js`, `admin.controller.js`, `booking.controller.js`, `dependencies`, `package.json`, `fellows.controller.js`, `pricing.js`, `adminRoutes.test.js`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09565217391304348 - nodes in this community are weakly interconnected._
- **Should `booking.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08163265306122448 - nodes in this community are weakly interconnected._