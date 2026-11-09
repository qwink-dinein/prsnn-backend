# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 67 files · ~28,761 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 371 nodes · 904 edges · 24 communities (17 shown, 7 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8e4faab7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- otpDelivery.js
- app.js
- admin.controller.js
- auth.route.js
- prepaid.controller.js
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
- server.js
- cors
- lint@^0.8.19
- razorpay
- dotenv
- bcrypt
- express-rate-limit
- helmet

## God Nodes (most connected - your core abstractions)
1. `vitest` - 20 edges
2. `offerNext()` - 13 edges
3. `notifyWhatsAppLater()` - 13 edges
4. `hashPassword()` - 12 edges
5. `sessionStart()` - 11 edges
6. `onPrepaidPaid()` - 11 edges
7. `express` - 11 edges
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
- `getBookingMessages()` --calls--> `maskPhoneNumber()`  [EXTRACTED]
  src/controllers/booking.controller.js → src/utils/maskPhoneNumber.js
- `toPublicCompanion()` --calls--> `offeredHours()`  [EXTRACTED]
  src/controllers/fellows.controller.js → src/utils/pricing.js

## Import Cycles
- None detected.

## Communities (24 total, 7 thin omitted)

### Community 0 - "otpDelivery.js"
Cohesion: 0.38
Nodes (7): ENV, deliverOtp(), sendSms(), sendWhatsApp(), smsConfigured(), tail(), whatsappConfigured()

### Community 1 - "app.js"
Cohesion: 0.16
Nodes (12): express, limiter, clearNotifications(), getNotifications(), getPublicStats(), authMiddleware(), optionalAuth(), router (+4 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.09
Nodes (35): createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats(), getSuperAdminAnalytics() (+27 more)

### Community 3 - "auth.route.js"
Cohesion: 0.09
Nodes (37): jsonwebtoken@^9.0.3, jsonwebtoken, vitest, login(), MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS (+29 more)

### Community 4 - "prepaid.controller.js"
Cohesion: 0.09
Nodes (32): bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings() (+24 more)

### Community 5 - "allocation.js"
Cohesion: 0.16
Nodes (30): acceptOffer(), DAYS, declineOffer(), failAllocation(), findCandidates(), hasConflict(), isAvailableFor(), IST_OFFSET_MS (+22 more)

### Community 6 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, compression@^1.8.1, eslint@^10.1.0, express@^5.2.1, mongoose@^9.1.5, resend@^6.9.3, socket.io@^4.8.3, uuid@^13.0.0 (+7 more)

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
Cohesion: 0.15
Nodes (12): booking, companion, ENV, requester, bodyFor, DAY, durationText(), firstName() (+4 more)

### Community 13 - "upload.middleware.js"
Cohesion: 0.22
Nodes (8): cloudinary@^1.41.3, multer@^2.0.2, multer-storage-cloudinary@^4.0.0, cloudinary, multer, multer-storage-cloudinary, storage, upload

### Community 14 - "payment.controller.js"
Cohesion: 0.14
Nodes (18): mongoose, createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), BookingSchema (+10 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.17
Nodes (19): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+11 more)

### Community 16 - "server.js"
Cohesion: 0.15
Nodes (9): FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV, app, Message, MessageSchema, initializeSocket() (+1 more)

### Community 20 - "dotenv"
Cohesion: 0.40
Nodes (4): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `auth.route.js` to `otpDelivery.js`, `prepaid.controller.js`, `allocation.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `payment.controller.js`, `fellows.controller.js`, `server.js`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `notifyWhatsAppLater()` (e.g. with `simulatePayment.test.js` and `allocation.test.js`) actually correct?**
  _`notifyWhatsAppLater()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09268292682926829 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `admin.controller.js`, `auth.route.js`, `prepaid.controller.js`, `dependencies`, `package.json`, `fellows.controller.js`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `auth.route.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09074410163339383 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `payment.controller.js` to `admin.controller.js`, `auth.route.js`, `dependencies`, `package.json`, `server.js`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `prepaid.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0919661733615222 - nodes in this community are weakly interconnected._