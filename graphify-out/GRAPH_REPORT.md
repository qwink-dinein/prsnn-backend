# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 65 files · ~27,226 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 351 nodes · 842 edges · 22 communities (15 shown, 7 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c56b0f71`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- phoneAuth.controller.js
- app.js
- admin.controller.js
- auth.route.js
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
- payment.controller.js
- fellows.controller.js
- compression
- cors
- lint@^0.8.19
- razorpay
- socket.io
- uuid@^13.0.0

## God Nodes (most connected - your core abstractions)
1. `vitest` - 19 edges
2. `notifyWhatsAppLater()` - 13 edges
3. `hashPassword()` - 12 edges
4. `onPrepaidPaid()` - 11 edges
5. `offerNext()` - 11 edges
6. `express` - 11 edges
7. `sessionStart()` - 10 edges
8. `issueRefund()` - 10 edges
9. `mongoose` - 10 edges
10. `invalidateCompanionsCache()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `personView()` --calls--> `applyLock()`  [EXTRACTED]
  src/controllers/booking.controller.js → src/utils/privacy.js
- `createBooking()` --calls--> `notifyWhatsAppLater()`  [EXTRACTED]
  src/controllers/booking.controller.js → src/utils/whatsappNotify.js
- `updateBookingStatus()` --calls--> `notifyWhatsAppLater()`  [EXTRACTED]
  src/controllers/booking.controller.js → src/utils/whatsappNotify.js
- `markPaid()` --calls--> `onPrepaidPaid()`  [EXTRACTED]
  src/controllers/payment.controller.js → src/services/allocation.js
- `markPaid()` --calls--> `notifyWhatsAppLater()`  [EXTRACTED]
  src/controllers/payment.controller.js → src/utils/whatsappNotify.js

## Import Cycles
- None detected.

## Communities (22 total, 7 thin omitted)

### Community 0 - "phoneAuth.controller.js"
Cohesion: 0.12
Nodes (23): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, RESEND_COOLDOWN_MS (+15 more)

### Community 1 - "app.js"
Cohesion: 0.08
Nodes (23): dotenv@^17.2.3, express@^5.2.1, mongoose@^9.1.5, @sentry/node@^10.44.0, dotenv, express, mongoose, @sentry/node (+15 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.10
Nodes (33): createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats(), getSuperAdminAnalytics() (+25 more)

### Community 3 - "auth.route.js"
Cohesion: 0.14
Nodes (20): jsonwebtoken, vitest, login(), pinLogin(), openDispute(), signup(), forgotPassword(), generateOTP() (+12 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.13
Nodes (17): bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings() (+9 more)

### Community 5 - "allocation.js"
Cohesion: 0.12
Nodes (37): acceptPrepaidOffer(), createPrepaidBooking(), declinePrepaidOffer(), DURATIONS, getPolicy(), POLICY, quoteOf(), acceptOffer() (+29 more)

### Community 6 - "dependencies"
Cohesion: 0.14
Nodes (14): dependencies, bcrypt@^6.0.0, eslint@^10.1.0, express-rate-limit@^8.2.1, helmet@^8.1.0, jsonwebtoken@^9.0.3, resend@^6.9.3, zod@^4.3.6 (+6 more)

### Community 7 - "package.json"
Cohesion: 0.17
Nodes (11): author, description, engines, node, keywords, license, main, name (+3 more)

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
Cohesion: 0.14
Nodes (13): booking, companion, ENV, requester, normaliseIndianMobile(), bodyFor, DAY, durationText() (+5 more)

### Community 13 - "upload.middleware.js"
Cohesion: 0.22
Nodes (8): cloudinary@^1.41.3, multer@^2.0.2, multer-storage-cloudinary@^4.0.0, cloudinary, multer, multer-storage-cloudinary, storage, upload

### Community 14 - "payment.controller.js"
Cohesion: 0.19
Nodes (14): createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), NotificationSchema, router (+6 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.17
Nodes (19): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+11 more)

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `auth.route.js` to `phoneAuth.controller.js`, `booking.controller.js`, `allocation.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `payment.controller.js`, `fellows.controller.js`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `notifyWhatsAppLater()` (e.g. with `simulatePayment.test.js` and `allocation.test.js`) actually correct?**
  _`notifyWhatsAppLater()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11742424242424243 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `admin.controller.js`, `auth.route.js`, `booking.controller.js`, `package.json`, `payment.controller.js`, `fellows.controller.js`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0766488413547237 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `app.js` to `admin.controller.js`, `auth.route.js`, `booking.controller.js`, `package.json`, `payment.controller.js`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._