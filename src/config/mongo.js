import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Connect or fail. A server without its database would accept requests and
 * then hang every one of them (mongoose buffers queries), so server.js exits
 * when this rejects and Render restarts it.
 */
const connectMongo = async () => {
    if (!process.env.MONGO_DB_URI) throw new Error('MONGO_DB_URI is not set.');
    await mongoose.connect(process.env.MONGO_DB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log("MongoDB Connected Successfully");
};

export default connectMongo;
