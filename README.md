
# prsnn. Backend

This directory contains the Node.js/Express backend API for prsnn. It manages the database, handles business logic, and secures API endpoints.

## Tech Stack

-   **Runtime**: Node.js
-   **Framework**: Express.js
-   **Database**: MongoDB (with Mongoose ODM)
-   **Authentication**: JSON Web Tokens (JWT) & Bcrypt
-   **File Storage**: Cloudinary (via Multer)
-   **Email Service**: Nodemailer
-   **Real-time**: Socket.io
-   **Payments**: Razorpay API

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root of the `backend` directory and add the following variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/rentafellow # Or your Atlas URI

# Authentication
JWT_SECRET=your_super_secret_jwt_key

# Cloudinary (Image Uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Razorpay (Payments)
RAZORPAY_KEY_ID=rzp_test_your_razorpay_key_id
RAZORPAY_KEY_SECRET=rzp_test_your_razorpay_key_secret

# Email (Nodemailer)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_app_password

# Frontend URL (For CORS & Redirects)
FRONTEND_URL=http://localhost:3000
```

### 3. Run the Server

```bash
# Development mode (with nodemon)
npm run dev

# Production mode
npm start
```

The server will start on [http://localhost:5000](http://localhost:5000).

## API Endpoints

The API is structured around the following resources:

-   **Auth**: `/api/auth` - Login, Signup, Email Verification.
-   **User**: `/api/user` - User profile management.
-   **Companions**: `/api/companions` - Companion-specific operations (search, filter).
-   **Bookings**: `/api/bookings` - Create, update, and manage bookings.
-   **Admin**: `/api/admin` - Administrative actions and dashboard stats.
-   **Payments**: `/api/payments` - Payment processing logic.

## Real-time Events

The server uses Socket.io to emit events for:
-   Booking status updates (`booking_updated`)
-   New booking requests (`new_booking_request`)
-   Notifications (`notification`)
