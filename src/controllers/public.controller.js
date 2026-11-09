import User from '../models/User.js';

export const getPublicStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({ role: 'user' });
        const totalCompanions = await User.countDocuments({ role: 'companion', verificationStatus: 'verified' });

        res.status(200).json({
            users: totalUsers,
            companions: totalCompanions
        });
    } catch (error) {
        console.error("Public Stats Error:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
    }
};
