import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// A thenable query: works with `await X.findById()` and `.select().lean()` / `.populate()` chains.
const q = (v) => {
  const o = { then: (r, j) => Promise.resolve(typeof v === 'function' ? v() : v).then(r, j) };
  for (const m of ['select', 'lean', 'populate', 'sort', 'limit']) o[m] = () => o;
  return o;
};

const people = {};
const bookings = {};
vi.mock('../../models/User.js', () => {
  const User = {
    findById: vi.fn((id) => q(() => people[id] ?? null)),
    find: vi.fn(() => q([])),
    findOne: vi.fn(() => q(null)),
    countDocuments: vi.fn(async () => 0),
    exists: vi.fn(async () => true),
    updateMany: vi.fn(async () => ({})),
    deleteOne: vi.fn(async () => ({})),
  };
  return { default: User, PRIVATE_USER_FIELDS: '' };
});
vi.mock('../../models/Booking.js', () => ({
  default: {
    findById: vi.fn((id) => q(() => bookings[id] ?? null)),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
    find: vi.fn(() => q([])),
    countDocuments: vi.fn(async () => 0),
    aggregate: vi.fn(async () => [{ collected: 1000, refunded: 100, payouts: 720 }]),
    deleteOne: vi.fn(async () => ({})),
  },
}));
vi.mock('../../models/AuditLog.js', () => ({ default: { create: vi.fn(async () => ({})), find: vi.fn(() => q([])) } }));
vi.mock('../../models/Notification.js', () => ({ default: { create: vi.fn(async () => ({ _id: 'n1' })), findByIdAndDelete: vi.fn(() => q(null)) } }));
vi.mock('../../models/Broadcast.js', () => ({ default: { create: vi.fn(async (d) => ({ _id: 'bc1', ...d })), find: vi.fn(() => q([])) } }));
vi.mock('../../models/Message.js', () => ({ default: { find: vi.fn(() => q([])), deleteMany: vi.fn() } }));
vi.mock('../../models/DeletedAccount.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../models/Settings.js', () => ({ default: { findOneAndUpdate: vi.fn(async () => ({})), findOne: vi.fn(() => q(null)) } }));
vi.mock('../../utils/refunds.js', () => ({ issueRefund: vi.fn(async () => 'processed'), MAX_REFUND_ATTEMPTS: 5 }));
vi.mock('../../utils/expoPush.js', async (orig) => ({ ...(await orig()), sendPush: vi.fn(async (t) => ({ sent: t.length, failed: 0, batches: 1, invalidTokens: [] })) }));
vi.mock('../../controllers/payment.controller.js', () => ({ markPaid: vi.fn() }));
vi.mock('../../controllers/fellows.controller.js', () => ({ invalidateCompanionsCache: vi.fn() }));

import User from '../../models/User.js';
import Booking from '../../models/Booking.js';
import AuditLog from '../../models/AuditLog.js';
import { issueRefund } from '../../utils/refunds.js';
import { sendPush } from '../../utils/expoPush.js';
import { pricing, resetPricing } from '../../utils/pricing.js';
import adminAppRoutes, { adminTopLevel } from '../../routes/adminApp.routes.js';

const app = express();
app.use(express.json());
app.use('/api/admin/app', adminAppRoutes);
app.use('/api/admin', adminTopLevel);

const ID = { sup: '64a000000000000000000001', sub: '64a000000000000000000002', mem: '64a000000000000000000003', comp: '64a000000000000000000004', gone: '64a000000000000000000005' };
const BK = '64b000000000000000000001';
const bearer = (id, role) => `Bearer ${jwt.sign({ userId: id, role }, process.env.JWT_SECRET)}`;
// The token says superadmin, but the database is what counts.
const asSub = () => bearer(ID.sub, 'superadmin');
const asSuper = () => bearer(ID.sup, 'superadmin');

const doc = (o) => ({ ...o, save: vi.fn(async function () { return this; }) });

beforeEach(() => {
  vi.clearAllMocks();
  resetPricing();
  Object.assign(people, {
    [ID.sup]: doc({ _id: ID.sup, role: 'superadmin', phone: '919876543210' }),
    [ID.sub]: doc({ _id: ID.sub, role: 'subadmin', phone: '919000000002' }),
    [ID.mem]: doc({ _id: ID.mem, role: 'user', fullName: 'Member' }),
    [ID.comp]: doc({ _id: ID.comp, role: 'companion', verificationStatus: 'pending' }),
    [ID.gone]: doc({ _id: ID.gone, role: 'subadmin', suspended: true }),
  });
  bookings[BK] = doc({ _id: BK, flow: 'prepaid', status: 'accepted', paymentStatus: 'paid', amountPaid: 699, requesterId: ID.mem, companionId: ID.comp, refund: { status: 'none' }, toObject() { return { ...this }; } });
});

describe('who can reach the admin API', () => {
  it('members get 403, no token 401', async () => {
    expect((await request(app).get('/api/admin/app/overview')).status).toBe(401);
    expect((await request(app).get('/api/admin/app/overview').set('Authorization', bearer(ID.mem, 'superadmin'))).status).toBe(403);
  });
  it('a suspended sub-admin loses access at once', async () => {
    expect((await request(app).get('/api/admin/app/overview').set('Authorization', bearer(ID.gone, 'subadmin'))).status).toBe(403);
  });
  it('sub-admins see the overview without money totals; superadmins with', async () => {
    const sub = await request(app).get('/api/admin/app/overview').set('Authorization', asSub());
    expect(sub.status).toBe(200);
    expect(sub.body.money).toBeUndefined();
    const sup = await request(app).get('/api/admin/app/overview').set('Authorization', asSuper());
    expect(sup.body.money).toEqual({ collected: 1000, refunded: 100, companionPayouts: 720, platformNet: 180 });
  });
});

describe('sub-admins cannot move money, change prices, push or add admins', () => {
  const routes = [
    ['post', `/api/admin/app/bookings/${BK}/refund`],
    ['post', `/api/admin/app/bookings/${BK}/refund/retry`],
    ['post', `/api/admin/app/bookings/${BK}/mark-paid`],
    ['post', `/api/admin/app/bookings/${BK}/cancellation-fee`],
    ['delete', `/api/admin/app/bookings/${BK}`],
    ['put', '/api/admin/settings/pricing'],
    ['post', '/api/admin/broadcast'],
    ['get', '/api/admin/app/broadcast/audience'],
    ['post', '/api/admin/app/admins'],
    ['delete', `/api/admin/app/admins/${ID.sub}`],
    ['get', '/api/admin/app/activity'],
    ['post', '/api/admin/app/notifications'],
  ];
  it.each(routes)('%s %s → 403', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', asSub()).send({});
    expect(res.status).toBe(403);
  });
  it('cancel with a refund amount is refused for a sub-admin', async () => {
    const res = await request(app).post(`/api/admin/app/bookings/${BK}/cancel`).set('Authorization', asSub()).send({ reason: 'Customer asked', refundAmount: 699 });
    expect(res.status).toBe(403);
    expect(Booking.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('bookings', () => {
  it('a sub-admin cancel moves no money and flags the refund for a superadmin', async () => {
    Booking.findOneAndUpdate.mockResolvedValue({ ...bookings[BK], status: 'cancelled' });
    const res = await request(app).post(`/api/admin/app/bookings/${BK}/cancel`).set('Authorization', asSub()).send({ reason: 'Safety concern' });
    expect(res.status).toBe(200);
    expect(issueRefund).not.toHaveBeenCalled();
    expect(Booking.updateOne).toHaveBeenCalledWith({ _id: BK }, { $set: { refundReview: expect.objectContaining({ needed: true, note: 'Safety concern' }) } });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'booking.cancel', role: 'subadmin', actorId: ID.sub }));
    expect(res.body.booking.companionShare).toBeUndefined();
  });
  it('a superadmin cancel can refund a chosen amount', async () => {
    Booking.findOneAndUpdate.mockResolvedValue({ ...bookings[BK], status: 'cancelled' });
    const res = await request(app).post(`/api/admin/app/bookings/${BK}/cancel`).set('Authorization', asSuper()).send({ reason: 'Companion no-show', refundAmount: 699 });
    expect(res.status).toBe(200);
    expect(issueRefund).toHaveBeenCalledWith(BK, 699, expect.stringContaining('Companion no-show'));
  });
  it('refund amount is validated before anything changes', async () => {
    const res = await request(app).post(`/api/admin/app/bookings/${BK}/cancel`).set('Authorization', asSuper()).send({ reason: 'x y z', refundAmount: 5000 });
    expect(res.status).toBe(400);
    expect(Booking.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('partial refund by a superadmin', async () => {
    const res = await request(app).post(`/api/admin/app/bookings/${BK}/refund`).set('Authorization', asSuper()).send({ amount: 300, reason: 'Late start' });
    expect(res.status).toBe(200);
    expect(issueRefund).toHaveBeenCalledWith(BK, 300, 'Late start');
    expect(Booking.updateOne).toHaveBeenCalledWith({ _id: BK }, { $set: { 'refund.retained': 399, 'refundReview.needed': false } });
  });
  it('no second refund', async () => {
    bookings[BK].refund = { status: 'processed', amount: 699 };
    const res = await request(app).post(`/api/admin/app/bookings/${BK}/refund`).set('Authorization', asSuper()).send({ amount: 100 });
    expect(res.status).toBe(409);
  });
  it('edits never touch money fields', async () => {
    const res = await request(app).patch(`/api/admin/app/bookings/${BK}`).set('Authorization', asSub()).send({ amountPaid: 1, packagePrice: 1, message: 'Meet at the gate' });
    expect(res.status).toBe(200);
    expect(bookings[BK].amountPaid).toBe(699);
    expect(bookings[BK].message).toBe('Meet at the gate');
  });
});

describe('users', () => {
  it('sub-admins verify companions (logged)', async () => {
    const res = await request(app).post(`/api/admin/app/verifications/${ID.comp}`).set('Authorization', asSub()).send({ decision: 'verified' });
    expect(res.status).toBe(200);
    expect(people[ID.comp].verificationStatus).toBe('verified');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.approve', before: { verificationStatus: 'pending' }, after: { verificationStatus: 'verified' } }));
  });
  it('sub-admins suspend members but not staff', async () => {
    expect((await request(app).post(`/api/admin/app/users/${ID.mem}/suspend`).set('Authorization', asSub()).send({ suspended: true })).status).toBe(200);
    expect(people[ID.mem].suspended).toBe(true);
    expect((await request(app).post(`/api/admin/app/users/${ID.sup}/suspend`).set('Authorization', asSub()).send({ suspended: true })).status).toBe(403);
  });
  it('profile edits are whitelisted; role cannot be changed here', async () => {
    const res = await request(app).patch(`/api/admin/app/users/${ID.mem}`).set('Authorization', asSub()).send({ fullName: 'New Name', role: 'superadmin', packages: [1, 4] });
    expect(res.status).toBe(200);
    expect(people[ID.mem]).toMatchObject({ fullName: 'New Name', role: 'user', packages: [1, 4] });
  });
  it('deleting someone with an open paid booking is refused', async () => {
    Booking.countDocuments.mockResolvedValueOnce(1);
    const res = await request(app).delete(`/api/admin/app/users/${ID.mem}`).set('Authorization', asSub());
    expect(res.status).toBe(409);
    expect(User.deleteOne).not.toHaveBeenCalled();
  });
  it('a superadmin adds a sub-admin by phone', async () => {
    User.findOne.mockReturnValueOnce(q(people[ID.mem]));
    const res = await request(app).post('/api/admin/app/admins').set('Authorization', asSuper()).send({ phone: '98765 00000' });
    expect(res.status).toBe(200);
    expect(people[ID.mem].role).toBe('subadmin');
  });
});

describe('prices and push (superadmin)', () => {
  it('saves valid prices and applies them at once', async () => {
    const res = await request(app).put('/api/admin/settings/pricing').set('Authorization', asSuper()).send({ packagePrices: { 1: 449 } });
    expect(res.status).toBe(200);
    expect(res.body.pricing.packagePrices['1']).toBe(449);
    expect(pricing().packagePrices[1]).toBe(449);
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'settings.pricing' }));
  });
  it('re-prices only unpaid prepaid bookings when asked', async () => {
    await request(app).put('/api/admin/settings/pricing').set('Authorization', asSuper()).send({ packagePrices: { 1: 449 }, repriceUnpaid: true });
    expect(Booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({ 'allocation.state': 'awaiting_payment', paymentStatus: 'pending', duration: '60' }), { $set: { packagePrice: 449 } });
  });
  it('refuses prices that break the curve', async () => {
    const res = await request(app).put('/api/admin/settings/pricing').set('Authorization', asSuper()).send({ packagePrices: { 2: 900 } });
    expect(res.status).toBe(400);
    expect(pricing().packagePrices[2]).toBe(699);
  });
  it('broadcasts to companions with push tokens and stores counts', async () => {
    User.find.mockReturnValueOnce(q([{ pushToken: 'ExponentPushToken[a]' }, { pushToken: 'ExponentPushToken[b]' }]));
    const res = await request(app).post('/api/admin/broadcast').set('Authorization', asSuper()).send({ audience: 'companions', title: 'Busy weekend', body: 'Turn on Saturday availability.' });
    expect(res.status).toBe(201);
    expect(sendPush).toHaveBeenCalledWith(['ExponentPushToken[a]', 'ExponentPushToken[b]'], expect.objectContaining({ title: 'Busy weekend' }));
    expect(res.body.broadcast).toMatchObject({ audience: 'companions', recipients: 2, sent: 2 });
  });
  it('validates the audience', async () => {
    expect((await request(app).post('/api/admin/broadcast').set('Authorization', asSuper()).send({ audience: 'everyone', title: 'Hi', body: 'There' })).status).toBe(400);
  });
});
