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
// Add compression middleware to reduce response sizes
app.use(compression());
app.use(express.json());

// Rate Limiter: 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `windowMs`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: "Too many requests from this IP, please try again after 15 minutes"
});

// Apply rate limiting to all requests (or could be specific to /api)
app.use("/api/", limiter);

// Serve uploads (Note: In production, consider cloud storage like AWS S3 or Cloudinary for persistence)
app.use('/uploads', express.static('uploads'));

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/companions", fellowsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/public", publicRoutes);

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
