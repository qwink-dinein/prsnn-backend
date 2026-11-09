import Notification from '../models/Notification.js';

// Get all notifications for the logged in user
export const getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const notifications = await Notification.find({ userId })
            .sort({ createdAt: -1 });
            
        res.status(200).json(notifications);
    } catch (error) {
        console.error("Get Notifications Error:", error);
        res.status(500).json({ message: "Failed to fetch notifications." });
    }
};

// Clear all notifications for the logged in user
export const clearNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        
        await Notification.deleteMany({ userId });
        
        res.status(200).json({ message: "All notifications cleared successfully." });
    } catch (error) {
        console.error("Clear Notifications Error:", error);
        res.status(500).json({ message: "Failed to clear notifications." });
    }
};
