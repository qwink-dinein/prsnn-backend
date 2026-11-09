import express from "express";
import * as Sentry from "@sentry/node";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit"; // Added here
import authRoutes from "./routes/auth.route.js";
import profileRoutes from "./routes/profile.routes.js";


import fellowsRoutes from "./routes/fellows.routes.js";
import adminRoutes from "./routes/admin.route.js";
import bookingRoutes from "./routes/booking.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import publicRoutes from "./routes/public.routes.js";
import adminAppRoutes, { adminTopLevel } from "./routes/adminApp.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import { razorpayWebhook } from "./controllers/payment.controller.js";

const app = express();

// The app runs behind one reverse-proxy hop (Render's load balancer). Without
// this, req.ip is always the proxy's address, so the rate limiter puts EVERY
// user into a single bucket and the whole site locks out after ~100 requests.
// The value 1 trusts exactly one hop, so a client cannot spoof its identity by
// sending its own X-Forwarded-For header.
app.set('trust proxy', 1);

// Production: specific origin with environment variable fallback
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : [];
allowedOrigins.filter(origin => typeof origin === 'string' || origin instanceof RegExp);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin matches any allowed origin (string or regex)
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin || origin === allowedOrigin.replace(/\/$/, '');
      }
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (!isAllowed) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(helmet());

// Razorpay webhook needs the exact raw body for its signature, so it is
// mounted before express.json().
app.post("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), razorpayWebhook);
// Add compression middleware to reduce response sizes
app.use(compression());
app.use(express.json());

// Rate Limiter: 100 requests per 15 minutes
// Mobile carriers in India put many people behind one IP (CGNAT), and the app
// polls a few endpoints, so 100 per IP locked real users out. Default 1000;
// RATE_LIMIT_MAX overrides. Login and OTP routes have their own tight limits.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { message: "Too many requests. Please try again in a few minutes." }
});

// Apply rate limiting to all requests (or could be specific to /api)
app.use("/api/", limiter);

// Serve uploads (Note: In production, consider cloud storage like AWS S3 or Cloudinary for persistence)
// Local-disk uploads (development only) are loaded by the app from another origin.
app.use('/uploads', (req, res, next) => { res.set('Cross-Origin-Resource-Policy', 'cross-origin'); next(); }, express.static('uploads'));

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/companions", fellowsRoutes);
app.use("/api/admin/app", adminAppRoutes);
app.use("/api/admin", adminTopLevel);
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/settings", settingsRoutes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({ message: "Route not found" });
});

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

// Optional fallthrough error handler for Sentry (useful if you want to expose res.sentry later)
app.use(function onError(err, req, res, next) {
  // We don't overwrite the existing global error handler completely, 
  // just add Sentry error handler setup.
  next(err);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});


export default app;
