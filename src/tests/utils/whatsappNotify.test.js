import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyWhatsApp, bodyFor, timeText, durationText, whatsappNumberOf } from '../../utils/whatsappNotify.js';

const ENV = { ...process.env };
const ok = () => ({ status: 200, json: async () => ({ status: 'success' }) });
const booking = { _id: '665f1c2a9b1e8a0012abc9f1', scheduledDate: new Date('2026-11-15T00:00:00Z'), startTime: '16:00', duration: '120', pricePerHour: 600 };
const companion = { fullName: 'Ayesha Khan', phone: '919876543210' };
const requester = { fullName: 'Karan Malhotra', phoneNumber: '98480 22338' };

beforeEach(() => {
  process.env.WAPLIFY_API_KEY = 'wapl_test';
  process.env.WAPLIFY_TPL_BOOKING_REQUEST = 'prsnn_booking_request';
  process.env.WAPLIFY_TPL_BOOKING_ACCEPTED = 'prsnn_booking_accepted';
  process.env.WAPLIFY_TPL_PAYMENT_RECEIVED = 'prsnn_payment_received';
});
afterEach(() => {
  process.env = { ...ENV };
});

describe('template variables', () => {
  it('booking_request → companion: name, member, date, time, length, ref', () => {
    expect(bodyFor.booking_request({ booking, requester, companion })).toEqual(['Ayesha', 'prsnn', 'Karan', 'Sun, 15 Nov', '4:00 PM', '2 hours', 'ABC9F1']);
  });
  it('booking_accepted → member: name, companion, date, time, amount, ref', () => {
    expect(bodyFor.booking_accepted({ booking, requester, companion, amount: 1200 })).toEqual(['Karan', 'prsnn', 'Ayesha', 'Sun, 15 Nov', '4:00 PM', '1,200', 'ABC9F1']);
  });
  it('payment_received → companion: name, member, amount, date, time, ref', () => {
    expect(bodyFor.payment_received({ booking, requester, companion, amount: 1200 })).toEqual(['Ayesha', '1,200', 'Karan', 'prsnn', 'Sun, 15 Nov', '4:00 PM', 'ABC9F1']);
  });
  it('takes the brand from WAPLIFY_BRAND_NAME', () => {
    process.env.WAPLIFY_BRAND_NAME = 'Prsnn App';
    expect(bodyFor.booking_request({ booking, requester, companion })[1]).toBe('Prsnn App');
  });
  it('formats times and lengths', () => {
    expect(timeText('09:30')).toBe('9:30 AM');
    expect(timeText('12:00')).toBe('12:00 PM');
    expect(durationText('30')).toBe('30 min');
    expect(durationText('90')).toBe('1.5 hours');
  });
  it('uses the verified login number, else the profile number', () => {
    expect(whatsappNumberOf(companion)).toBe('919876543210');
    expect(whatsappNumberOf(requester)).toBe('919848022338');
    expect(whatsappNumberOf({ phoneNumber: '123' })).toBeNull();
  });
});

describe('notifyWhatsApp', () => {
  it('sends the utility template with numbered body_data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const r = await notifyWhatsApp('booking_accepted', requester, { booking, requester, companion, amount: 1200 }, { fetchImpl });
    expect(r).toEqual({ sent: true });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ template_name: 'prsnn_booking_accepted', contact_phone: '919848022338', body_data: { 1: 'Karan', 2: 'prsnn', 3: 'Ayesha', 6: '1,200', 7: 'ABC9F1' } });
  });
  it('skips quietly when the template is not configured', async () => {
    delete process.env.WAPLIFY_TPL_PAYMENT_RECEIVED;
    const fetchImpl = vi.fn();
    expect(await notifyWhatsApp('payment_received', companion, { booking, requester, companion, amount: 1 }, { fetchImpl })).toEqual({ sent: false, reason: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('skips when the person has no usable number', async () => {
    const fetchImpl = vi.fn();
    expect((await notifyWhatsApp('booking_request', { fullName: 'X' }, { booking, requester, companion }, { fetchImpl })).reason).toBe('no_number');
  });
  it('never throws on network errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    expect(await notifyWhatsApp('booking_request', companion, { booking, requester, companion }, { fetchImpl })).toEqual({ sent: false, reason: 'unreachable' });
    warn.mockRestore();
  });
});
