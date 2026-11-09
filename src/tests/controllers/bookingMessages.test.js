import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getBookingById, getBookingMessages } from '../../controllers/booking.controller.js';
import Booking from '../../models/Booking.js';
import Message from '../../models/Message.js';

vi.mock('../../models/Booking.js', () => {
  const BookingMock = function (data) {
    Object.assign(this, data || {});
    this.save = vi.fn().mockResolvedValue(true);
  };
  BookingMock.findById = vi.fn();
  BookingMock.find = vi.fn();
  return { default: BookingMock };
});

vi.mock('../../models/Message.js', () => ({
  default: {
    find: vi.fn()
  }
}));

vi.mock('../../models/User.js', () => ({
  default: { findById: vi.fn() }
}));

vi.mock('../../models/Notification.js', () => ({
  default: { create: vi.fn() }
}));

const REQUESTER_ID = 'requester123';
const COMPANION_ID = 'companion456';
const OUTSIDER_ID = 'outsider789';
const BOOKING_ID = 'booking000';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

describe('getBookingById auth', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockFindById(booking) {
    Booking.findById.mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(booking)
      })
    });
  }

  it('returns 404 when booking not found', async () => {
    mockFindById(null);
    const req = { params: { id: BOOKING_ID }, user: { id: REQUESTER_ID } };
    const res = makeRes();

    await getBookingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 403 when caller is not requester or companion', async () => {
    mockFindById({
      _id: BOOKING_ID,
      requesterId: { _id: REQUESTER_ID },
      companionId: { _id: COMPANION_ID }
    });
    const req = { params: { id: BOOKING_ID }, user: { id: OUTSIDER_ID } };
    const res = makeRes();

    await getBookingById(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Not authorized to view this booking." });
  });

  it('returns booking when caller is the requester', async () => {
    const booking = {
      _id: BOOKING_ID,
      requesterId: { _id: REQUESTER_ID },
      companionId: { _id: COMPANION_ID }
    };
    mockFindById(booking);
    const req = { params: { id: BOOKING_ID }, user: { id: REQUESTER_ID } };
    const res = makeRes();

    await getBookingById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(booking);
  });

  it('returns booking when caller is the companion', async () => {
    const booking = {
      _id: BOOKING_ID,
      requesterId: { _id: REQUESTER_ID },
      companionId: { _id: COMPANION_ID }
    };
    mockFindById(booking);
    const req = { params: { id: BOOKING_ID }, user: { id: COMPANION_ID } };
    const res = makeRes();

    await getBookingById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(booking);
  });
});

describe('getBookingMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockBookingFindById(booking) {
    Booking.findById.mockReturnValue({
      select: vi.fn().mockResolvedValue(booking)
    });
  }

  function mockMessagesFind(messages) {
    Message.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(messages)
        })
      })
    });
  }

  it('returns 404 when booking not found', async () => {
    mockBookingFindById(null);
    const req = { params: { id: BOOKING_ID }, user: { id: REQUESTER_ID }, query: {} };
    const res = makeRes();

    await getBookingMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 403 when caller is not a participant', async () => {
    mockBookingFindById({
      requesterId: REQUESTER_ID,
      companionId: COMPANION_ID,
      status: 'accepted',
      paymentStatus: 'paid'
    });
    const req = { params: { id: BOOKING_ID }, user: { id: OUTSIDER_ID }, query: {} };
    const res = makeRes();

    await getBookingMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when the requester has not paid yet', async () => {
    mockBookingFindById({
      requesterId: REQUESTER_ID,
      companionId: COMPANION_ID,
      status: 'accepted',
      paymentStatus: 'pending'
    });
    const req = { params: { id: BOOKING_ID }, user: { id: REQUESTER_ID }, query: {} };
    const res = makeRes();

    await getBookingMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Payment is required')
    }));
  });

  it('allows the companion in before payment (they are owed the money)', async () => {
    mockBookingFindById({
      requesterId: REQUESTER_ID,
      companionId: COMPANION_ID,
      status: 'accepted',
      paymentStatus: 'pending'
    });
    mockMessagesFind([]);
    const req = { params: { id: BOOKING_ID }, user: { id: COMPANION_ID }, query: {} };
    const res = makeRes();

    await getBookingMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('masks phone numbers in messages from the other party but not own messages', async () => {
    mockBookingFindById({
      requesterId: REQUESTER_ID,
      companionId: COMPANION_ID,
      status: 'accepted',
      paymentStatus: 'paid'
    });

    const messages = [
      { _id: 'm2', senderId: COMPANION_ID, content: 'reach me on 9876543210', createdAt: new Date('2026-04-26T10:01:00Z') },
      { _id: 'm1', senderId: REQUESTER_ID, content: 'my number is 9876543210', createdAt: new Date('2026-04-26T10:00:00Z') }
    ];
    mockMessagesFind(messages);

    const req = { params: { id: BOOKING_ID }, user: { id: REQUESTER_ID }, query: {} };
    const res = makeRes();

    await getBookingMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];

    const sentByMe = payload.messages.find(m => m._id === 'm1');
    const sentByOther = payload.messages.find(m => m._id === 'm2');

    expect(sentByMe.content).toBe('my number is 9876543210');
    expect(sentByOther.content).toBe('reach me on ••••••••••');
  });

  it('returns messages in chronological order (oldest first) and reports hasMore', async () => {
    mockBookingFindById({
      requesterId: REQUESTER_ID,
      companionId: COMPANION_ID,
      status: 'accepted',
      paymentStatus: 'paid'
    });

    const newest = { _id: 'newest', senderId: REQUESTER_ID, content: 'c', createdAt: new Date('2026-04-26T10:02:00Z') };
    const middle = { _id: 'middle', senderId: REQUESTER_ID, content: 'b', createdAt: new Date('2026-04-26T10:01:00Z') };
    const oldest = { _id: 'oldest', senderId: REQUESTER_ID, content: 'a', createdAt: new Date('2026-04-26T10:00:00Z') };

    mockMessagesFind([newest, middle, oldest]);

    const req = { params: { id: BOOKING_ID }, user: { id: REQUESTER_ID }, query: { limit: '3' } };
    const res = makeRes();

    await getBookingMessages(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.messages.map(m => m._id)).toEqual(['oldest', 'middle', 'newest']);
    expect(payload.hasMore).toBe(true);
  });

  it('clamps limit to 200 and parses before query param', async () => {
    mockBookingFindById({
      requesterId: REQUESTER_ID,
      companionId: COMPANION_ID,
      status: 'accepted',
      paymentStatus: 'paid'
    });

    const sortMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([])
      })
    });
    Message.find.mockReturnValue({ sort: sortMock });

    const req = {
      params: { id: BOOKING_ID },
      user: { id: REQUESTER_ID },
      query: { limit: '99999', before: '2026-04-26T10:00:00Z' }
    };
    const res = makeRes();

    await getBookingMessages(req, res);

    const findCall = Message.find.mock.calls[0][0];
    expect(findCall.bookingId).toBe(BOOKING_ID);
    expect(findCall.createdAt.$lt).toBeInstanceOf(Date);

    const limitArg = sortMock.mock.results[0].value.limit.mock.calls[0][0];
    expect(limitArg).toBe(200);
  });
});
