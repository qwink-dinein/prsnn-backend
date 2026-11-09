import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deliverOtp } from '../../utils/otpDelivery.js';

const reply = (status, body) => ({ status, headers: { get: () => null }, json: async () => body });
const ENV = { ...process.env };

beforeEach(() => {
  process.env.WAPLIFY_API_KEY = 'wapl_test';
  process.env.WAPLIFY_TEMPLATE_NAME = 'prsnn_login';
  delete process.env.WAPLIFY_CODE_KEYS;
  delete process.env.MSG91_AUTH_KEY;
  delete process.env.MSG91_TEMPLATE_ID;
});
afterEach(() => {
  process.env = { ...ENV };
});

describe('deliverOtp', () => {
  it('sends the Waplify authentication template with the code in body_data and the button', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { status: 'success' }));
    const r = await deliverOtp('919876543210', '123456', { fetchImpl });
    expect(r).toEqual({ ok: true, channel: 'whatsapp', status: 200 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://server.waplify.io/api/v1/messages/send');
    expect(init.headers.Authorization).toBe('Bearer wapl_test');
    expect(JSON.parse(init.body)).toMatchObject({ template_name: 'prsnn_login', contact_phone: '919876543210', body_data: { 1: '123456' }, url_button_data: '123456' });
  });

  it('falls back to SMS when WhatsApp fails and MSG91 is configured', async () => {
    process.env.MSG91_AUTH_KEY = 'k';
    process.env.MSG91_TEMPLATE_ID = 't';
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(400, { status: 'error', error: 'not_on_whatsapp' })).mockResolvedValueOnce(reply(200, { type: 'success' }));
    const r = await deliverOtp('919876543210', '123456', { fetchImpl });
    expect(r).toEqual({ ok: true, channel: 'sms', status: 200 });
    expect(fetchImpl.mock.calls[1][0]).toContain('control.msg91.com');
  });

  it('does not fall back on rate limiting', async () => {
    process.env.MSG91_AUTH_KEY = 'k';
    process.env.MSG91_TEMPLATE_ID = 't';
    const fetchImpl = vi.fn().mockResolvedValue(reply(429, {}));
    const r = await deliverOtp('919876543210', '123456', { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports 503 when nothing is configured', async () => {
    delete process.env.WAPLIFY_API_KEY;
    const fetchImpl = vi.fn();
    const r = await deliverOtp('919876543210', '123456', { fetchImpl });
    expect(r).toEqual({ ok: false, status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never logs the code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(reply(500, {}));
    await deliverOtp('919876543210', '987654', { fetchImpl });
    expect(warn.mock.calls.flat().join(' ')).not.toContain('987654');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('9876543210');
    warn.mockRestore();
  });
});
