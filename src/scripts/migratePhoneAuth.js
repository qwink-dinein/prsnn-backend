/**
 * One-time migration for phone (OTP) login. Run once per database BEFORE
 * deploying the phone-login backend:
 *
 *   node src/scripts/migratePhoneAuth.js
 *
 * Why: the old `email_1` index is unique on every document, and MongoDB treats
 * a missing email as null — so the second account without an email (every
 * phone-only account) would fail with a duplicate-key error. This drops that
 * index and builds the partial ones defined in models/User.js.
 * Safe to run more than once.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';

const uri = process.env.MONGO_DB_URI;
if (!uri) {
  console.error('MONGO_DB_URI is not set');
  process.exit(1);
}

await mongoose.connect(uri);
const indexes = await User.collection.indexes();
const old = indexes.find((i) => i.name === 'email_1' && !i.partialFilterExpression);
if (old) {
  await User.collection.dropIndex('email_1');
  console.log('Dropped non-partial email_1 index');
} else {
  console.log('email_1 is already partial (or missing)');
}
await User.syncIndexes();
console.log('Indexes now:', (await User.collection.indexes()).map((i) => i.name).join(', '));
await mongoose.disconnect();
