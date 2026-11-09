# Graph Report - prsnn-backend  (2026-11-09)

## Corpus Check
- 53 files · ~17,003 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .example 1)

## Summary
- 248 nodes · 544 edges · 22 communities (11 shown, 11 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `82e7999b`
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
- bcrypt
- cloudinary
- compression
- cors
- eslint@^10.1.0
- helmet
- lint@^0.8.19
- multer
- resend
- uuid@^13.0.0

## God Nodes (most connected - your core abstractions)
1. `vitest` - 13 edges
2. `hashPassword()` - 12 edges
3. `express` - 11 edges
4. `mongoose` - 10 edges
5. `verifyPhoneOtp()` - 9 edges
6. `Booking` - 9 edges
7. `invalidateCompanionsCache()` - 8 edges
8. `deliverOtp()` - 8 edges
9. `dotenv` - 7 edges
10. `sendPhoneOtp()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `login()` --calls--> `generateToken()`  [EXTRACTED]
  src/controllers/login.controller.js → src/utils/token.js
- `setPin()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `pinLogin()` --calls--> `comparePassword()`  [EXTRACTED]
  src/controllers/phoneAuth.controller.js → src/utils/hash.js
- `signup()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/signup.controller.js → src/utils/hash.js
- `resetPassword()` --calls--> `hashPassword()`  [EXTRACTED]
  src/controllers/verification.controller.js → src/utils/hash.js

## Import Cycles
- None detected.

## Communities (22 total, 11 thin omitted)

### Community 0 - "phoneAuth.controller.js"
Cohesion: 0.12
Nodes (26): MAX_OTP_ATTEMPTS, MAX_PIN_ATTEMPTS, newUsername(), OTP_TTL_MS, pending, PendingOtp, PIN_LOCK_MS, pinLogin() (+18 more)

### Community 1 - "app.js"
Cohesion: 0.10
Nodes (23): express, limiter, companionsCache, getAllCompanions(), getCompanionById(), searchCompanions(), clearNotifications(), getNotifications() (+15 more)

### Community 2 - "admin.controller.js"
Cohesion: 0.11
Nodes (29): createAdmin(), deleteAdmin(), deleteUser(), getAllAdmins(), getAllPayments(), getAllUsers(), getDashboardStats(), getSuperAdminAnalytics() (+21 more)

### Community 3 - "auth.route.js"
Cohesion: 0.15
Nodes (17): jsonwebtoken, vitest, login(), signup(), forgotPassword(), generateOTP(), resetPassword(), sendVerificationOtp() (+9 more)

### Community 4 - "booking.controller.js"
Cohesion: 0.17
Nodes (13): cancelBooking(), createBooking(), getBookingById(), getBookingMessages(), getCompanionBookings(), getUserBookings(), updateBookingStatus(), Booking (+5 more)

### Community 5 - "server.js"
Cohesion: 0.14
Nodes (13): dotenv@^17.2.3, mongoose@^9.1.5, @sentry/node@^10.44.0, dotenv, mongoose, @sentry/node, FEATURE_ENV, missingFeature (+5 more)

### Community 6 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, express@^5.2.1, express-rate-limit@^8.2.1, jsonwebtoken@^9.0.3, multer-storage-cloudinary@^4.0.0, razorpay@^2.9.6, socket.io@^4.8.3, zod@^4.3.6 (+5 more)

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

## Knowledge Gaps
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `auth.route.js` to `devDependencies`, `phoneAuth.controller.js`, `booking.controller.js`, `package.json`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Should `phoneAuth.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11746031746031746 - nodes in this community are weakly interconnected._
- **Why does `express` connect `app.js` to `admin.controller.js`, `auth.route.js`, `booking.controller.js`, `dependencies`, `package.json`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09747899159663866 - nodes in this community are weakly interconnected._
- **Why does `mongoose` connect `server.js` to `app.js`, `admin.controller.js`, `auth.route.js`, `booking.controller.js`, `package.json`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Should `admin.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._
- **Should `auth.route.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14717741935483872 - nodes in this community are weakly interconnected._