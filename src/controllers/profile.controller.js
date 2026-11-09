
import User, { PRIVATE_USER_FIELDS } from '../models/User.js';
import Booking from '../models/Booking.js';
import DeletedAccount from '../models/DeletedAccount.js';
import Admin from '../models/Admin.js';
import { invalidateCompanionsCache } from './fellows.controller.js';
import { applyIdentity } from '../utils/privacy.js';
import { BASE_RATE, cleanPackages, DAY_END_MIN, DAY_START_MIN } from '../utils/pricing.js';

export const getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const user = await User.findById(userId).select(PRIVATE_USER_FIELDS);
        
        if (!user) {
            return res.status(404).json({ message: "Account not found" });
        }

        const is_verified = user.role === 'superadmin' || user.verificationStatus === 'verified';

        // Fetch Admin detail profile if admin/superadmin (for any admin-specific data)
        let detailProfile = null;
        if (user.role === 'admin' || user.role === 'superadmin') {
            detailProfile = await Admin.findOne({ userId: userId });
        }

        // Merge info
        res.status(200).json({
            ...user.toObject(), // includes all data from User schema
            id: user._id, // Ensure frontend gets id
            is_verified,
            verification_status: user.verificationStatus,
            detailProfile: detailProfile ? detailProfile.toObject() : null
        });
    } catch (error) {
        console.error("Get Profile error:", error);
        res.status(500).json({ message: "Server error fetching profile data" });
    }
};

export const checkProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const user = await User.findById(userId);
        
        if (!user) {
            // Should not happen if auth middleware passed
            return res.status(200).json({ hasProfile: false, status: 'not_found' });
        }

        // For regular users (companions)
        if (user.role === 'companion') {
             // Check if they have filled out description/price (basic profile check)
             // or check Companion collection
             // Also check verificationStatus. If pending/verified/rejected, they have a profile explicitly.
             const hasFellowProfile = (!!user.description && user.pricePerHour !== undefined) || (user.verificationStatus && user.verificationStatus !== 'not_submitted'); 
             
             res.status(200).json({ 
                hasProfile: hasFellowProfile,
                status: user.verificationStatus,
                is_verified: user.verificationStatus === 'verified',
                isVerified: user.verificationStatus === 'verified',
                role: user.role
            });
            return;
        }

        // For admins
        if (user.role === 'admin' || user.role === 'superadmin') {
             const hasAdminProfile = !!(user.profilePhotoUrl) || (user.verificationStatus && user.verificationStatus !== 'not_submitted'); // minimal check
             
             res.status(200).json({
                hasProfile: hasAdminProfile,
                status: user.verificationStatus || 'not_submitted',
                is_verified: user.verificationStatus === 'verified' || user.role === 'superadmin',
                isVerified: user.verificationStatus === 'verified' || user.role === 'superadmin'
            });
            return;
        }
        
        // Default (role=user - basic users)
        // Check if they have completed basic onboarding
        const hasBasicProfile = !!(user.fullName && user.phoneNumber) || (user.verificationStatus && user.verificationStatus !== 'not_submitted');
        
        // Logic to handle legacy users or users who onboarded as basic
        // If they have profile (name+phone) but status is 'not_submitted', treat as 'pending'
        const effectiveStatus = (user.verificationStatus && user.verificationStatus !== 'not_submitted')
            ? user.verificationStatus
            : (hasBasicProfile ? 'pending' : 'not_submitted');

        res.status(200).json({ 
            hasProfile: hasBasicProfile,
            status: effectiveStatus,
            is_verified: effectiveStatus === 'verified',
            isVerified: effectiveStatus === 'verified',
            role: user.role
        });

    } catch (error) {
        console.error("Check Profile error:", error);
        res.status(500).json({ message: "Server error checking profile state" });
    }
};

// Onboard Basic User (non-companion)
export const onboardBasic = async (req, res) => {
    try {
        const userId = req.user.id;
        const { fullName, phoneNumber, city, area } = req.body;
        
        const profilePhoto = req.files?.profilePhoto?.[0]?.path;
        const idProofFront = req.files?.idProofFront?.[0]?.path;
        const idProofBack = req.files?.idProofBack?.[0]?.path;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const identityError = applyIdentity(user, req.body);
        if (identityError) return res.status(400).json({ message: identityError });

        // Update user with all profile info directly in User schema
        user.fullName = fullName;
        user.phoneNumber = phoneNumber;
        user.city = city;
        user.area = area;
        
        // Basic users are automatically verified. Companions are NOT: their status only
        // changes through onboard-companion + admin review, so this endpoint must not
        // be a way to skip ID verification.
        if (user.role === 'user') user.verificationStatus = 'verified';
        
        if (profilePhoto) user.profilePhotoUrl = profilePhoto;
        if (idProofFront) user.idProofFrontUrl = idProofFront;
        if (idProofBack) user.idProofBackUrl = idProofBack;

        await user.save();

        res.status(200).json({ 
            message: "Profile created successfully",
            user: {
                id: user._id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                city: user.city,
                area: user.area,
                role: user.role,
                profilePhotoUrl: user.profilePhotoUrl,
                verificationStatus: user.verificationStatus
            }
        });
    } catch (error) {
        console.error("Basic Onboard Error:", error);
        res.status(500).json({ message: error.message });
    }
};

export const onboardCompanion = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            fullName,
            phoneNumber,
            city,
            area,
            description,
            monday_availability,
            tuesday_availability,
            wednesday_availability,
            thursday_availability,
            friday_availability,
            saturday_availability,
            sunday_availability,
            startTime,
            endTime,
            pricePerHour,
            tags
        } = req.body;

        console.log(`Starting companion onboarding for user ${userId}`);

        // Update User Doc (Core Searchable Data)
        let tagsArray = [];
        if (tags) {
           if (typeof tags === 'string') {
               try {
                   // Try to parse if it's a JSON string array (e.g. from FormData)
                   const parsed = JSON.parse(tags);
                   if (Array.isArray(parsed)) tagsArray = parsed;
                   else tagsArray = [tags];
               } catch (e) {
                   tagsArray = [tags];
               }
           } else if (Array.isArray(tags)) {
               tagsArray = tags;
           }
        }
        
        const updateData = {
            role: 'companion',
            fullName,
            phoneNumber,
            city,
            area,
            description,
            startTime,
            endTime,
            tags: tagsArray,
            verificationStatus: 'pending',
            availability: {
                monday: monday_availability === 'true' || monday_availability === true,
                tuesday: tuesday_availability === 'true' || tuesday_availability === true,
                wednesday: wednesday_availability === 'true' || wednesday_availability === true,
                thursday: thursday_availability === 'true' || thursday_availability === true,
                friday: friday_availability === 'true' || friday_availability === true,
                saturday: saturday_availability === 'true' || saturday_availability === true,
                sunday: sunday_availability === 'true' || sunday_availability === true,
            }
        };

        // Fixed pricing: every companion uses the same price list. They choose
        // which durations they offer (packages); the rate is not theirs to set.
        updateData.pricePerHour = BASE_RATE;
        if (req.body.packages !== undefined) {
            const packages = cleanPackages(req.body.packages);
            if (typeof packages === 'string') return res.status(400).json({ message: packages });
            updateData.packages = packages;
        }

        // Sessions run 07:00–22:00.
        const validateTimeBackend = (t) => {
            if (!t) return true; // Let frontend handle required check if empty, or schema default
            const [h, m] = t.split(':').map(Number);
            const tm = h * 60 + m;
            return tm >= DAY_START_MIN && tm <= DAY_END_MIN;
        };

        if (!validateTimeBackend(startTime) || !validateTimeBackend(endTime)) {
            return res.status(400).json({ message: "Availability must be between 7:00 AM and 10:00 PM." });
        }

        // Add photo URLs to User schema
        const profilePhoto = req.files?.profilePhoto?.[0]?.path;
        const idProofFront = req.files?.idProofFront?.[0]?.path;
        const idProofBack = req.files?.idProofBack?.[0]?.path;
        const backupPhoto = req.files?.backupPhoto?.[0]?.path;
        
        if (profilePhoto) updateData.profilePhotoUrl = profilePhoto;
        if (idProofFront) updateData.idProofFrontUrl = idProofFront;
        if (idProofBack) updateData.idProofBackUrl = idProofBack;
        if (backupPhoto) updateData.backupPhotoUrl = backupPhoto;

        // Gender, who they want to see, profile lock (+ consent) and state.
        const identity = {};
        const identityError = applyIdentity(identity, req.body);
        if (identityError) return res.status(400).json({ message: identityError });
        Object.assign(updateData, identity);

        const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

        console.log(`Successfully onboarded companion ${userId}`);

        // Covers re-onboarding by an already-verified companion, whose listed
        // details would otherwise stay stale.
        invalidateCompanionsCache();

        res.status(201).json({
            message: "Companion profile submitted successfully! Your account is under review.",
            user: {
                id: user._id,
                fullName: user.fullName,
                role: user.role,
                verificationStatus: user.verificationStatus
            }
        });
    } catch (error) {
        console.error("COMPANION ONBOARDING ERROR:", error);
        res.status(500).json({ 
            message: "Server error during onboarding", 
            details: error.message
        });
    }
};

export const onboardAdmin = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Verify role is admin (or initially just a user trying to become admin?)
        // Usually onboardAdmin is called by someone who IS an admin but unverified.
        // Or via request. Logic here assumes they have role='admin' from creation (by superadmin).
        
        if(req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({ message: "Only Admin accounts can perform onboarding." });
        }
        
        const { fullName, phoneNumber } = req.body;
        
        const user = await User.findById(userId);
        if (user.verificationStatus === 'pending' || user.verificationStatus === 'verified') {
             return res.status(400).json({ message: `Admin profile is already ${user.verificationStatus}.` });
        }

        const photo = req.files?.photo?.[0]?.path;
        const backupPhoto = req.files?.backupPhoto?.[0]?.path;
        const adminDoc = req.files?.adminVerificationDocument?.[0]?.path;

        if (!photo || !adminDoc) {
            return res.status(400).json({ message: "Photo and Admin Verification Document are required." });
        }

        // Update User Doc
        user.fullName = fullName;
        user.phoneNumber = phoneNumber;
        user.profilePhotoUrl = photo;
        user.verificationStatus = 'pending';
        await user.save();

        // Update Admin Detail Doc
        const mongoAdminData = {
            userId: userId,
            frontAadharPhoto: adminDoc,
            backAadharPhoto: backupPhoto,
            phoneNumber: phoneNumber,
            fullName: fullName,
            description: fullName,
            verificationStatus: 'pending'
        };

        const profile = await Admin.findOneAndUpdate(
            { userId: userId },
            mongoAdminData,
            { upsert: true, new: true }
        );

        res.status(201).json({ message: "Admin onboarding submitted.", profile });

    } catch (error) {
        console.error("Admin Onboard Error:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const updates = req.body;
        
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "Account not found" });

        const identityError = applyIdentity(user, updates);
        if (identityError) return res.status(400).json({ message: identityError });

        if (updates.username) user.username = updates.username;
        if (updates.email) user.email = updates.email.toLowerCase();
        if (updates.fullName) user.fullName = updates.fullName;
        if (updates.phoneNumber) user.phoneNumber = updates.phoneNumber;
        if (updates.city) user.city = updates.city;
        if (updates.area) user.area = updates.area;
        if (updates.description) user.description = updates.description;
        
        // Prices are fixed for everyone: a requested pricePerHour is ignored.
        if (user.role === 'companion') {
            user.pricePerHour = BASE_RATE;
            if (updates.packages !== undefined) {
                const packages = cleanPackages(updates.packages);
                if (typeof packages === 'string') return res.status(400).json({ message: packages });
                user.packages = packages;
            }
        }

        const validateTimeBackend = (t) => {
            if (!t) return true;
            const [h, m] = t.split(':').map(Number);
            const tm = h * 60 + m;
            return tm >= 540 && tm <= 1260;
        };

        const inDay = (t) => {
            const [h, m] = String(t).split(':').map(Number);
            const tm = h * 60 + m;
            return tm >= DAY_START_MIN && tm <= DAY_END_MIN;
        };
        if ((updates.startTime && !inDay(updates.startTime)) || (updates.endTime && !inDay(updates.endTime))) {
            return res.status(400).json({ message: "Availability must be between 7:00 AM and 10:00 PM." });
        }
        if (updates.startTime) user.startTime = updates.startTime;
        if (updates.endTime) user.endTime = updates.endTime;
        
        // Handle photos
        const profilePhoto = req.files?.profilePhoto?.[0]?.path; // Companion
        const adminPhoto = req.files?.photo?.[0]?.path; // Admin
        if (profilePhoto || adminPhoto) {
            user.profilePhotoUrl = profilePhoto || adminPhoto;
        }

        // Availability Updates
        if (user.role === 'companion') {
            if (updates.startTime) user.startTime = updates.startTime;
            if (updates.endTime) user.endTime = updates.endTime;
            
            // Handle availability object
             if (!user.availability) {
                user.availability = {
                    monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false
                };
            }

            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
                const key = `${day}_availability`;
                // Check for both boolean true and string "true"
                if (updates[key] !== undefined) {
                    user.availability[day] = updates[key] === 'true' || updates[key] === true;
                }
            });
            
             // Create tags array if provided
            if (updates.tags) {
                let tagsArray = [];
                if (typeof updates.tags === 'string') {
                   // A JSON array (what FormData sends) also contains commas, so try JSON first.
                   const trimmed = updates.tags.trim();
                   if (trimmed.startsWith('[')) {
                       try {
                           const parsed = JSON.parse(trimmed);
                           tagsArray = Array.isArray(parsed) ? parsed.map(String) : [];
                       } catch (e) {
                           tagsArray = [];
                       }
                   } else if (updates.tags.includes(',')) {
                       tagsArray = updates.tags.split(',').map(tag => tag.trim()).filter(t => t);
                   } else {
                       // Or try parsing JSON
                       try {
                           const parsed = JSON.parse(updates.tags);
                           if (Array.isArray(parsed)) tagsArray = parsed;
                           else tagsArray = [updates.tags];
                       } catch (e) {
                           tagsArray = [updates.tags];
                       }
                   }
                } else if (Array.isArray(updates.tags)) {
                    tagsArray = updates.tags;
                }
                user.tags = tagsArray;
            }
        }

        await user.save();
        
        // Update Detail Docs as well for sync (Only Admin exists as separate model now)
        if (user.role === 'admin' || user.role === 'superadmin') {
            await Admin.findOneAndUpdate({ userId: userId }, {
                description: updates.fullName, // Admin doesn't have description usually, using Name
                phoneNumber: updates.phoneNumber
            });
        }
        
        // Companion and NormalUser models are deprecated, so no need to update them.

        // Name, photo, price, tags and availability all appear in the public
        // listing, so a companion's edit must be reflected immediately.
        if (user.role === 'companion') {
            invalidateCompanionsCache();
        }

        res.status(200).json({ message: "Profile updated successfully" });
    } catch (error) {
        console.error("Update Profile error:", error);
        res.status(500).json({ message: "Server error updating profile", details: error.message });
    }
};

/**
 * DELETE /api/profile — the signed-in member deletes their own account.
 * Open bookings are cancelled, a DeletedAccount audit row is kept, and the
 * user document (profile, photos URLs, PIN, OTP state) is removed. Bookings
 * and payment fields stay for accounting and disputes.
 * Staff accounts are removed by a super admin, not here.
 */
export const deleteOwnAccount = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Account not found" });
        if (user.role === 'admin' || user.role === 'superadmin') {
            return res.status(403).json({ message: "Staff accounts are removed by a super admin." });
        }

        await Booking.updateMany(
            { $or: [{ requesterId: user._id }, { companionId: user._id }], status: { $in: ['pending', 'accepted'] } },
            { $set: { status: 'cancelled' } }
        );

        await DeletedAccount.create({
            originalUserId: user._id.toString(),
            username: user.username,
            email: user.email || (user.phone ? `phone:${user.phone}` : 'none'),
            role: user.role,
            deletedBy: user._id,
            deletionReason: 'Self-service deletion (app)'
        });

        await User.deleteOne({ _id: user._id });
        if (user.role === 'companion') invalidateCompanionsCache();

        res.status(200).json({ message: "Your account has been deleted." });
    } catch (error) {
        console.error("Delete own account error:", error.message);
        res.status(500).json({ message: "Could not delete your account. Please contact support." });
    }
};
