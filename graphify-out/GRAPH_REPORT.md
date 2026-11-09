# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 56 files · ~18,897 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .example 1)

## Summary
- 274 nodes · 601 edges · 22 communities (15 shown, 7 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4ec02a04`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- phoneAuth.controller.js
- app.js
- admin.controller.js
- auth.route.js
- booking.controller.js
- server.js
- dependencies
- package.json
- devDependencies
- allowBuilds
- scripts
- cache.middleware.js
- whatsappNotify.js
- upload.middleware.js
- payment.controller.js
- dotenv
- eslint@^10.1.0
- express-rate-limit
- lint@^0.8.19
- razorpay
- resend
- uuid@^13.0.0

## God Nodes (most connected - your core abstractions)
1. `vitest` - 15 edges
2. `hashPassword()` - 12 edges
3. `express` - 11 edges
4. `mongoose` - 10 edges
5. `Booking` - 10 edges
6. `verifyPhoneOtp()` - 9 edges
7. `notifyWhatsAppLater()` - 8 edges
8. `deliverOtp()` - 8 edges
9. `normaliseIndianMobile()` - 8 edges
10. `invalidateCompanionsCache()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `whatsappNumberOf()` --calls--> `normaliseIndianMobile()`  [EXTRACTED]
  src/utils/whatsappNotify.js → src/utils/phone.js
- `createBooking()` --calls--> `notifyWhatsAppLater()`  [EXTRACTED]
  src/controllers/booking.controller.js → src/utils/whatsappNotify.js
- `updateBookingStatus()` --calls--> `notifyWhatsAppLater()`  [EXTRACTED]
  src/controllers/booking.controller.js → src/utils/whatsappNotify.js
- `pinLogin()` --calls--> `comparePassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `pinLogin()` --calls--> `generateToken()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/token.js

## Import Cycles
- None detected.

## Communities (22 total, 7 thin omitted)

### Community 0 - "phoneAuth.controller.js"
Cohesion: 0.12
Nodes (25): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+17 more)

### Community 1 - "app.js"
Cohesion: 0.11
Nodes (18): express@^5.2.1, express, limiter, companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), clearNotifications() (+10 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.11
Nodes (29): createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats(), getSuperAdminAnalytics() (+21 more)

### Community 3 - "auth.route.js"
Cohesion: 0.18
Nodes (15): jsonwebtoken, vitest, login(), signup(), forgotPassword(), generateOTP(), resetPassword(), sendVerificationOtp() (+7 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.17
Nodes (13): cancelBooking(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings(), updateBookingStatus(), Booking (+5 more)

### Community 5 - "server.js"
Cohesion: 0.14
Nodes (11): mongoose@^9.1.5, mongoose, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV, app, connectMongo() (+3 more)

### Community 6 - "dependencies"
Cohesion: 0.14
Nodes (14): dependencies, bcrypt@^6.0.0, compression@^1.8.1, cors@^2.8.5, helmet@^8.1.0, jsonwebtoken@^9.0.3, socket.io@^4.8.3, zod@^4.3.6 (+6 more)

### Community 7 - "package.json"
Cohesion: 0.17
Nodes (11): author, description, engines, node, keywords, license, main, name (+3 more)

### Community 8 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, morgan@^1.10.1, nodemon@^3.1.11, supertest@^7.2.2, vitest@^4.1.0, morgan, nodemon, supertest

### Community 9 - "allowBuilds"
Cohesion: 0.40
Nodes (4): allowBuilds, bcrypt, core-js, lint

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
Cohesion: 0.30
Nodes (9): amountDueInPaise(), createPaymentIntent(), getRazorpay(), markPaid(), paymentMode(), simulatePayment(), verifyPayment(), NotificationSchema (+1 more)

### Community 15 - "dotenv"
Cohesion: 0.40
Nodes (4): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `auth.route.js` to `phoneAuth.controller.js`, `booking.controller.js`, `package.json`, `devDependencies`, `whatsappNotify.js`, `payment.controller.js`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11932773109243698 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `admin.controller.js`, `auth.route.js`, `booking.controller.js`, `package.json`, `payment.controller.js`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11384615384615385 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `dependencies` to `app.js`, `server.js`, `package.json`, `upload.middleware.js`, `dotenv`, `eslint@^10.1.0`, `express-rate-limit`, `lint@^0.8.19`, `razorpay`, `resend`, `uuid@^13.0.0`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14166666666666666 - nodes in this community are weakly interconnected._