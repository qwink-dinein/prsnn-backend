import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const connectMongo = async () => {
    try {
        if (!process.env.MONGO_DB_URI) {
            console.warn("MONGO_DB_URI is not defined in .env. Skipping MongoDB connection.");
            return;
        }
        await mongoose.connect(process.env.MONGO_DB_URI);
        console.log("MongoDB Connected Successfully");
    } catch (err) {
        console.error("MongoDB Connection Failed:", err.message);
        // We don't exit process here strictly because the app also uses Postgres
    }
};

export default connectMongo;
