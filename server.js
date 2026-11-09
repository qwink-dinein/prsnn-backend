import "./instrument.js";
import 'dotenv/config';
import app from "./src/app.js";
import connectMongo from "./src/config/mongo.js";

import http from 'http';
import initializeSocket from "./src/socket/index.js";

const PORT = process.env.PORT || 5000;

/**
 * Fail fast on misconfiguration.
 *
 * REQUIRED vars stop the boot with one clear line, rather than letting the
 * process start and then fail every request. OPTIONAL-but-important vars only
 * warn, so a missing payment or email key degrades one feature instead of
 * taking the whole API down.
 */
const REQUIRED_ENV = ['JWT_SECRET', 'MONGO_DB_URI', 'FRONTEND_URL'];
const FEATURE_ENV = [
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'RESEND_API_KEY', 'EMAIL_FROM',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
];

const missingRequired = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingRequired.length) {
  console.error(`FATAL: missing required environment variable(s): ${missingRequired.join(', ')}`);
  process.exit(1);
}

const missingFeature = FEATURE_ENV.filter((k) => !process.env[k]);
if (missingFeature.length) {
  console.warn(`WARNING: missing environment variable(s): ${missingFeature.join(', ')}. ` +
               `Payments, email or uploads will fail until these are set.`);
}

// Connect to MongoDB and then start server
connectMongo().then(() => {
  const server = http.createServer(app);
  
  // Initialize Socket.io
  initializeSocket(server);

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch((err) => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
