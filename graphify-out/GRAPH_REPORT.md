# Graph Report - prsnn-backend  (2026-11-17)

## Corpus Check
- 144 files · ~86,449 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .whl 3, (none) 2, .example 1)

## Summary
- 551 nodes · 1401 edges · 26 communities (20 shown, 6 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b8de72de`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- User.js
- app.js
- payment.controller.js
- phoneAuth.controller.js
- server.js
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
- dotenv
- notify/index.ts
- pricing.js
- profile.controller.js
- notify/index.ts
- compression
- cors
- express-rate-limit
- lint@^0.8.19
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

## Communities (26 total, 6 thin omitted)

### Community 0 - "User.js"
Cohesion: 0.08
Nodes (37): jsonwebtoken, vitest, createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers() (+29 more)

### Community 1 - "app.js"
Cohesion: 0.07
Nodes (30): express, limiter, clearNotifications(), getNotifications(), getPublicStats(), authMiddleware(), optionalAuth(), requireRole() (+22 more)

### Community 2 - "payment.controller.js"
Cohesion: 0.13
Nodes (18): mongoose, createPaymentIntent(), markPaid(), payableError(), razorpayWebhook(), simulatePayment(), verifyPayment(), BookingSchema (+10 more)

### Community 3 - "phoneAuth.controller.js"
Cohesion: 0.10
Nodes (32): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+24 more)

### Community 4 - "server.js"
Cohesion: 0.12
Nodes (11): FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV, app, connectMongo(), getBookingMessages(), Message (+3 more)

### Community 5 - "allocation.js"
Cohesion: 0.14
Nodes (32): acceptOffer(), DAYS, declineOffer(), failAllocation(), findCandidates(), hasConflict(), isAvailableFor(), IST_OFFSET_MS (+24 more)

### Community 6 - "dependencies"
Cohesion: 0.12
Nodes (16): dependencies, bcrypt@^6.0.0, express@^5.2.1, helmet@^8.1.0, jsonwebtoken@^9.0.3, mongoose@^9.1.5, resend@^6.9.3, socket.io@^4.8.3 (+8 more)

### Community 7 - "package.json"
Cohesion: 0.14
Nodes (13): author, eslint@^10.1.0, description, engines, node, keywords, license, main (+5 more)

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
Nodes (52): addAdmin(), AUDIENCE_QUERY, bookingAdminView(), broadcast(), cancelBooking(), closeDispute(), createNotification(), DAYS (+44 more)

### Community 15 - "fellows.controller.js"
Cohesion: 0.17
Nodes (19): companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), toPublicCompanion(), unlockedFor(), viewerOf(), viewFor() (+11 more)

### Community 16 - "dotenv"
Cohesion: 0.29
Nodes (5): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, old

### Community 17 - "notify/index.ts"
Cohesion: 0.11
Nodes (26): clean(), fold(), STATE, STATES, title(), db, Order, Payment (+18 more)

### Community 18 - "pricing.js"
Cohesion: 0.08
Nodes (48): bookingView(), cancelBooking(), confirmedPaid(), createBooking(), getBookingById(), getCompanionBookings(), getUserBookings(), personView() (+40 more)

### Community 19 - "profile.controller.js"
Cohesion: 0.19
Nodes (18): checkProfile(), deleteOwnAccount(), getProfile(), onboardAdmin(), onboardBasic(), onboardCompanion(), savePushToken(), updateProfile() (+10 more)

### Community 20 - "notify/index.ts"
Cohesion: 0.18
Nodes (12): cors, brand(), dateText(), db, durText(), Item, rupees(), timeText() (+4 more)

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `User.js` to `app.js`, `payment.controller.js`, `phoneAuth.controller.js`, `server.js`, `allocation.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `fellows.controller.js`, `pricing.js`, `profile.controller.js`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Should `User.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08417508417508418 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `payment.controller.js` to `User.js`, `server.js`, `dependencies`, `package.json`, `adminApp.controller.js`, `dotenv`, `pricing.js`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07198228128460686 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `User.js`, `payment.controller.js`, `dependencies`, `package.json`, `fellows.controller.js`, `pricing.js`, `profile.controller.js`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Should `payment.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12701612903225806 - nodes in this community are weakly interconnected._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09797979797979799 - nodes in this community are weakly interconnected._