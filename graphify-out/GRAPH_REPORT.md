# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 56 files · ~18,778 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .example 1)

## Summary
- 273 nodes · 600 edges · 20 communities (13 shown, 7 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1135bb3f`
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
- compression
- socket.io
- eslint@^10.1.0
- helmet
- lint@^0.8.19
- resend

## God Nodes (most connected - your core abstractions)
1. `vitest` - 15 edges
2. `hashPassword()` - 12 edges
3. `express` - 11 edges
4. `Booking` - 10 edges
5. `mongoose` - 10 edges
6. `verifyPhoneOtp()` - 9 edges
7. `notifyWhatsAppLater()` - 8 edges
8. `deliverOtp()` - 8 edges
9. `normaliseIndianMobile()` - 8 edges
10. `invalidateCompanionsCache()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `whatsappNumberOf()` --calls--> `normaliseIndianMobile()`  [EXTRACTED]
  src/utils/whatsappNotify.js → src/utils/phone.js
- `pinLogin()` --calls--> `comparePassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `setPin()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `login()` --calls--> `generateToken()`  [EXTRACTED]
  src/controllers/login.controller.js → src/utils/token.js
- `createBooking()` --calls--> `Booking`  [EXTRACTED]
  src/controllers/booking.controller.js → src/models/Booking.js

## Import Cycles
- None detected.

## Communities (20 total, 7 thin omitted)

### Community 0 - "phoneAuth.controller.js"
Cohesion: 0.12
Nodes (26): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+18 more)

### Community 1 - "app.js"
Cohesion: 0.11
Nodes (18): express@^5.2.1, express, limiter, companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), clearNotifications() (+10 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.10
Nodes (31): mongoose@^9.1.5, mongoose, deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats() (+23 more)

### Community 3 - "auth.route.js"
Cohesion: 0.15
Nodes (18): jsonwebtoken@^9.0.3, jsonwebtoken, vitest, createAdmin(), updateAdmin(), login(), signup(), forgotPassword() (+10 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.11
Nodes (22): cancelBooking(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings(), updateBookingStatus(), amountDueInPaise() (+14 more)

### Community 5 - "server.js"
Cohesion: 0.18
Nodes (10): dotenv@^17.2.3, @sentry/node@^10.44.0, dotenv, @sentry/node, FEATURE_ENV, missingFeature, missingRequired, REQUIRED_ENV (+2 more)

### Community 6 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, bcrypt@^6.0.0, cors@^2.8.5, express-rate-limit@^8.2.1, razorpay@^2.9.6, uuid@^13.0.0, zod@^4.3.6, bcrypt (+5 more)

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
Cohesion: 0.16
Nodes (12): booking, companion, ENV, requester, bodyFor, DAY, durationText(), firstName() (+4 more)

### Community 13 - "upload.middleware.js"
Cohesion: 0.22
Nodes (8): cloudinary@^1.41.3, multer@^2.0.2, multer-storage-cloudinary@^4.0.0, cloudinary, multer, multer-storage-cloudinary, storage, upload

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `auth.route.js` to `phoneAuth.controller.js`, `booking.controller.js`, `package.json`, `devDependencies`, `whatsappNotify.js`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11746031746031746 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `admin.controller.js`, `auth.route.js`, `booking.controller.js`, `package.json`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11384615384615385 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `dependencies` to `app.js`, `admin.controller.js`, `auth.route.js`, `server.js`, `package.json`, `upload.middleware.js`, `compression`, `socket.io`, `eslint@^10.1.0`, `helmet`, `lint@^0.8.19`, `resend`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `booking.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11341463414634147 - nodes in this community are weakly interconnected._