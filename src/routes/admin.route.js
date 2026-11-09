
import express from "express";
import { getUnverifiedUsers, verifyUser, createAdmin, getAllAdmins, updateAdmin, deleteAdmin, getDashboardStats, getSuperAdminAnalytics, getUserDetails, getAllUsers, deleteUser, verifyAdmin, getAllPayments } from "../controllers/admin.controller.js";
import { authMiddleware, requireRole } from "../middleware/auth.middleware.js";

const router = express.Router();

// Every route below is staff-only. Authorization is declared here rather than
// inside each controller so a new route cannot silently ship unguarded.
const staff = [authMiddleware, requireRole('admin', 'superadmin')];
const superOnly = [authMiddleware, requireRole('superadmin')];

// User Verification (Admins)
router.get("/unverified", staff, getUnverifiedUsers);
router.put("/verify/:id", staff, verifyUser);
router.get("/user/:id", staff, getUserDetails);
router.get("/stats", staff, getDashboardStats);

// Super Admin Routes
router.post("/create-admin", superOnly, createAdmin);
router.get("/admins", superOnly, getAllAdmins);
router.put("/admin/:id", superOnly, updateAdmin);
router.delete("/admin/:id", superOnly, deleteAdmin);
router.put("/verify-admin/:id", superOnly, verifyAdmin);
router.get("/super-stats", superOnly, getSuperAdminAnalytics);
router.get("/all-users", staff, getAllUsers);
router.delete("/user/:id", superOnly, deleteUser);
router.get("/payments", superOnly, getAllPayments);

export default router;
