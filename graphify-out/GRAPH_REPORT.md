# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 82 files · ~39,819 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 490 nodes · 1298 edges · 21 communities (18 shown, 3 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9c67ef66`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- otpDelivery.js
- app.js
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
- cors
- pricing.js
- adminRoutes.test.js
- bcrypt

## God Nodes (most connected - your core abstractions)
1. `vitest` - 24 edges
2. `audit()` - 24 edges
3. `validId()` - 21 edges
4. `bookingAdminView()` - 16 edges
5. `issueRefund()` - 16 edges
6. `mongoose` - 15 edges
7. `invalidateCompanionsCache()` - 15 edges
8. `pricing()` - 15 edges
9. `express` - 14 edges
10. `offerNext()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `createAdmin()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/admin.controller.js → src/utils/hash.js
- `updateAdmin()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/admin.controller.js → src/utils/hash.js
- `verifyUser()` --calls--> `invalidateCompanionsCache()`  [EXTRACTED]
  src/controllers/admin.controller.js → src/controllers/fellows.controller.js
- `deleteUser()` --calls--> `invalidateCompanionsCache()`  [EXTRACTED]
  src/controllers/admin.controller.js → src/controllers/fellows.controller.js
- `updateUser()` --calls--> `cleanPackages()`  [EXTRACTED]
  src/controllers/adminApp.controller.js → src/utils/pricing.js

## Import Cycles
- None detected.

## Communities (21 total, 3 thin omitted)

### Community 0 - "otpDelivery.js"
Cohesion: 0.38
Nodes (7): ENV, deliverOtp(), sendSms(), sendWhatsApp(), smsConfigured(), tail(), whatsappConfigured()

### Community 1 - "app.js"
Cohesion: 0.10
Nodes (23): express, limiter, clearNotifications(), getNotifications(), getPublicStats(), authMiddleware(), optionalAuth(), requireRole() (+15 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.12
Nodes (22): mongoose@^9.1.5, mongoose, createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers() (+14 more)

### Community 3 - "phoneAuth.controller.js"
Cohesion: 0.09
Nodes (39): jsonwebtoken, vitest, login(), MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending (+31 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.16
Nodes (14): bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings() (+6 more)

### Community 5 - "allocation.js"
Cohesion: 0.07
Nodes (61): createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), acceptPrepaidOffer(), cancelPrepaid() (+53 more)

### Community 6 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, compression@^1.8.1, eslint@^10.1.0, express@^5.2.1, jsonwebtoken@^9.0.3, lint@^0.8.19, razorpay@^2.9.6, resend@^6.9.3 (+11 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): author, express-rate-limit@^8.2.1, helmet@^8.1.0, description, engines, node, keywords, license (+7 more)

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
Cohesion: 0.22
Nodes (8): cloudinary@^1.41.3, multer@^2.0.2, multer-storage-cloudinary@^4.0.0, cloudinary, multer, multer-storage-cloudinary, storage, upload

### Community 14 - "adminApp.controller.js"
Cohesion: 0.10
Nodes (52): addAdmin(), AUDIENCE_QUERY, bookingAdminView(), broadcast(), cancelBooking(), closeDispute(), createNotification(), DAYS (+44 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.16
Nodes (20): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+12 more)

### Community 16 - "server.js"
Cohesion: 0.15
Nodes (11): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV (+3 more)

### Community 18 - "pricing.js"
Cohesion: 0.10
Nodes (39): checkProfile(), deleteOwnAccount(), getProfile(), onboardAdmin(), onboardBasic(), onboardCompanion(), savePushToken(), updateProfile() (+31 more)

### Community 19 - "adminRoutes.test.js"
Cohesion: 0.16
Nodes (12): app, asSub(), asSuper(), bearer(), bookings, ID, people, BATCH_SIZE (+4 more)

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `phoneAuth.controller.js` to `otpDelivery.js`, `booking.controller.js`, `allocation.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `fellows.controller.js`, `pricing.js`, `adminRoutes.test.js`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09879032258064516 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `admin.controller.js` to `phoneAuth.controller.js`, `booking.controller.js`, `allocation.js`, `package.json`, `adminApp.controller.js`, `server.js`, `pricing.js`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1164021164021164 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `admin.controller.js`, `phoneAuth.controller.js`, `booking.controller.js`, `allocation.js`, `dependencies`, `package.json`, `fellows.controller.js`, `pricing.js`, `adminRoutes.test.js`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08725542041248018 - nodes in this community are weakly interconnected._
- **Should `allocation.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0658876987990912 - nodes in this community are weakly interconnected._