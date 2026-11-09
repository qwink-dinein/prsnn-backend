/**
 * Simple in-memory cache middleware
 * For production, consider using Redis for distributed caching
 */

const cache = new Map();

/**
 * Cache middleware for GET requests
 * @param {number} duration - Cache duration in seconds
 */
export const cacheMiddleware = (duration) => {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        const key = req.originalUrl || req.url;
        const cachedResponse = cache.get(key);

        if (cachedResponse && cachedResponse.expires > Date.now()) {
            // Return cached response
            return res.status(200).json(cachedResponse.data);
        }

        // Override res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            // Cache the response
            cache.set(key, {
                data,
                expires: Date.now() + (duration * 1000)
            });

            return originalJson(data);
        };

        next();
    };
};

/**
 * Clear cache for a specific key or all keys
 */
export const clearCache = (key = null) => {
    if (key) {
        cache.delete(key);
    } else {
        cache.clear();
    }
};

export default cacheMiddleware;
