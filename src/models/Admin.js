import mongoose from 'mongoose';

const AdminSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    frontAadharPhoto: { type: String },
    backAadharPhoto: { type: String },
    verifiedBy: { type: String }, // Email of verifying admin
    phoneNumber: { type: String },
    category: { type: String },
    description: { type: String },
    fullName: { type: String },
    pricePerHour: { type: Number },
    verificationStatus: { 
        type: String, 
        enum: ['not_submitted', 'pending', 'verified', 'rejected'],
        default: 'not_submitted'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

export default Admin;
