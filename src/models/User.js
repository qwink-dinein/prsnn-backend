
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    // Authentication
    username: {
        type: String,
        required: true
    },
    // Email + password accounts (web). Phone-OTP accounts (mobile app) may have neither.
    email: {
        type: String,
        lowercase: true
    },
    password: {
        type: String
    },

    // Phone login (mobile app): verified number as digits with country code, e.g. "919876543210".
    // Separate from profile `phoneNumber`, which is unverified free text from onboarding forms.
    phone: { type: String },
    phoneVerified: { type: Boolean, default: false },
    phoneOtpHash: { type: String },
    phoneOtpExpires: { type: Date },
    phoneOtpAttempts: { type: Number, default: 0 },
    phoneOtpSentAt: { type: Date },

    // 4-digit app PIN (bcrypt), with lockout after repeated failures.
    pinHash: { type: String },
    pinFailedAttempts: { type: Number, default: 0 },
    pinLockedUntil: { type: Date },
    
    // Role & Status
    role: {
        type: String,
        enum: ['user', 'companion', 'admin', 'subadmin', 'superadmin'],
        default: 'user'
    },
    // Set when the phone is in SUPERADMIN_PHONES (promoted on login). Removing the
    // number from the env demotes the account at its next login.
    superadminViaEnv: { type: Boolean },
    // Suspended accounts cannot log in and are hidden from listings and offers.
    suspended: { type: Boolean, default: false },
    suspendedAt: { type: Date },
    suspendedReason: { type: String },
    // Expo push token for this account's latest device (PUT /api/profile/push-token).
    pushToken: { type: String },
    pushTokenUpdatedAt: { type: Date },
    verificationStatus: {
        type: String, // 'not_submitted', 'pending', 'verified', 'rejected'
        default: 'not_submitted'
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    verifiedBy: { 
        type: String // Stores the email of the verifier
    },
    
    // Basic Profile Information (All Users)
    fullName: {
        type: String
    },
    phoneNumber: {
        type: String
    },
    city: {
        type: String
    },
    area: {
        type: String
    },
    profilePhotoUrl: {
        type: String
    },
    
    // ID Verification Documents (All Users)
    idProofFrontUrl: {
        type: String
    },
    idProofBackUrl: {
        type: String
    },
    backupPhotoUrl: {
        type: String
    },
    
    // OTP fields
    otp: {
        type: String
    },
    otpExpires: {
        type: Date
    },
    
    // Identity, matching and privacy (mobile app)
    state: { type: String },
    gender: { type: String, enum: ['woman', 'man', 'nonbinary'] },
    // Which companions this person wants to see. Server-enforced in listings.
    seeGender: { type: String, enum: ['woman', 'man', 'nonbinary', 'everyone'] },
    // 'locked' = photo replaced by a blurred placeholder for everyone except people
    // with a confirmed, paid booking together. Unset on older accounts = 'open'.
    profileVisibility: { type: String, enum: ['open', 'locked'] },
    // When the person explicitly agreed to the visibility above (consent record).
    visibilityConsentAt: { type: Date },

    // Companion-Specific Fields
    description: String,
    pricePerHour: Number, // fixed base rate (₹399) for app companions; kept for the website
    // Durations (whole hours 1–12) this companion offers at the fixed package prices.
    packages: { type: [Number], default: undefined },
    startTime: String,
    endTime: String,
    tags: [String],
    availability: {
        monday: { type: Boolean, default: false },
        tuesday: { type: Boolean, default: false },
        wednesday: { type: Boolean, default: false },
        thursday: { type: Boolean, default: false },
        friday: { type: Boolean, default: false },
        saturday: { type: Boolean, default: false },
        sunday: { type: Boolean, default: false }
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Add indexes for better query performance
UserSchema.index({ role: 1, verificationStatus: 1, createdAt: -1 }); // For fetching verified companions efficiently with sort
UserSchema.index({ city: 1 }); // For city-based filtering
UserSchema.index({ role: 1, verificationStatus: 1, gender: 1, city: 1 }); // Matching for prepaid offers
UserSchema.index({ tags: 1 });
UserSchema.index({ role: 1, pushToken: 1 }); // Broadcast audiences // For tag-based filtering
// Unique only where present: phone-OTP accounts have no email. Requires migratePhoneAuth.js once
// on existing databases (drops the old non-partial email_1 index, which treats missing as null).
UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
UserSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
UserSchema.index({ username: 1 }, { unique: true }); // Unique index for username
UserSchema.index({ 'availability.monday': 1, 'availability.tuesday': 1, 'availability.wednesday': 1, 'availability.thursday': 1, 'availability.friday': 1, 'availability.saturday': 1, 'availability.sunday': 1 }); // For availability filtering
UserSchema.index({ createdAt: -1 }); // For sorting by creation date

/** Fields that must never leave the server, even to the account owner. */
export const PRIVATE_USER_FIELDS = '-password -otp -otpExpires -phoneOtpHash -phoneOtpExpires -phoneOtpAttempts -phoneOtpSentAt -pinHash -pinFailedAttempts -pinLockedUntil -pushToken';

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
