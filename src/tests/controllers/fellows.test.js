import { describe, it, expect, vi, beforeEach } from 'vitest';

const companions = [
  { _id: 'w1', fullName: 'Ayesha Khan', gender: 'woman', profileVisibility: 'locked', profilePhotoUrl: 'a.jpg', city: 'Hyderabad' },
  { _id: 'w2', fullName: 'Neha Sharma', gender: 'woman', profileVisibility: 'open', profilePhotoUrl: 'n.jpg', city: 'Pune' },
  { _id: 'm1', fullName: 'Rohan Mehta', gender: 'man', profilePhotoUrl: 'r.jpg', city: 'Hyderabad' },
];
const chain = (data) => ({ select: () => chain(data), sort: () => chain(data), skip: () => chain(data), limit: () => chain(data), lean: async () => data });

vi.mock('../../models/User.js', () => ({ default: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../../models/Booking.js', () => ({ default: { find: vi.fn() } }));

import User from '../../models/User.js';
import Booking from '../../models/Booking.js';
import { getAllCompanions, getCompanionById, invalidateCompanionsCache } from '../../controllers/fellows.controller.js';

const mkRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCompanionsCache();
  User.find.mockReturnValue(chain(companions));
  Booking.find.mockReturnValue(chain([]));
});

describe('GET /companions', () => {
  it('a member who wants to see women sees only women, locked ones without photo', async () => {
    User.findById.mockReturnValue(chain({ seeGender: 'woman' }));
    const res = mkRes();
    await getAllCompanions({ query: {}, user: { id: 'u1' } }, res);
    const list = res.json.mock.calls[0][0];
    expect(list.map((c) => c.id)).toEqual(['w1', 'w2']);
    expect(list[0]).toMatchObject({ locked: true, profilePhoto: null, fullName: 'Ayesha' });
    expect(list[1]).toMatchObject({ locked: false, profilePhoto: 'n.jpg' });
  });

  it('unlocks a locked companion for a member with a confirmed, paid booking', async () => {
    User.findById.mockReturnValue(chain({ seeGender: 'everyone' }));
    Booking.find.mockReturnValue(chain([{ companionId: 'w1' }]));
    const res = mkRes();
    await getAllCompanions({ query: {}, user: { id: 'u1' } }, res);
    expect(res.json.mock.calls[0][0].find((c) => c.id === 'w1')).toMatchObject({ locked: false, profilePhoto: 'a.jpg' });
  });

  it('logged-out browsing shows everyone (locked photos still hidden) and can filter by city', async () => {
    const res = mkRes();
    await getAllCompanions({ query: { city: 'hyderabad' } }, res);
    const list = res.json.mock.calls[0][0];
    expect(list.map((c) => c.id)).toEqual(['w1', 'm1']);
    expect(list[0].profilePhoto).toBeNull();
  });
});

describe('GET /companions/:id', () => {
  it('404s a companion outside the viewer’s gender preference', async () => {
    User.findById
      .mockReturnValueOnce(chain({ ...companions[2], role: 'companion', verificationStatus: 'verified' }))
      .mockReturnValueOnce(chain({ seeGender: 'woman' }));
    const res = mkRes();
    await getCompanionById({ params: { id: 'm1' }, query: {}, user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
