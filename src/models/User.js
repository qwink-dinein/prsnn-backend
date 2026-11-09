
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    // Authentication
    username: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    
    // Role & Status
    role: {
        type: String,
        enum: ['user', 'companion', 'admin', 'superadmin'],
        default: 'user'
    },
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
    
    // Companion-Specific Fields
    description: String,
    pricePerHour: Number,
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
UserSchema.index({ tags: 1 }); // For tag-based filtering
UserSchema.index({ email: 1 }, { unique: true }); // Unique index for email
UserSchema.index({ username: 1 }, { unique: true }); // Unique index for username
UserSchema.index({ 'availability.monday': 1, 'availability.tuesday': 1, 'availability.wednesday': 1, 'availability.thursday': 1, 'availability.friday': 1, 'availability.saturday': 1, 'availability.sunday': 1 }); // For availability filtering
UserSchema.index({ createdAt: -1 }); // For sorting by creation date

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
