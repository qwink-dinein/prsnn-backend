import { describe, it, expect, vi } from 'vitest';
import { chunk, isExpoToken, sendPush, EXPO_PUSH_URL } from '../../utils/expoPush.js';
import { diff } from '../../utils/audit.js';

const tok = (i) => `ExponentPushToken[t${i}]`;

describe('Expo push', () => {
  it('recognises Expo tokens', () => {
    expect(isExpoToken(tok(1))).toBe(true);
    expect(isExpoToken('ExpoPushToken[abc]')).toBe(true);
    expect(isExpoToken('fcm-token')).toBe(false);
  });
  it('sends in batches of 100 and counts tickets', async () => {
    const tokens = Array.from({ length: 230 }, (_, i) => tok(i));
    const fetchImpl = vi.fn(async (url, init) => {
      const msgs = JSON.parse(init.body);
      return { ok: true, json: async () => ({ data: msgs.map((m) => (m.to === tok(5) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }) };
    });
    const r = await sendPush([...tokens, 'bad'], { title: 'Hi', body: 'There' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toHaveLength(100);
    expect(r).toEqual({ sent: 229, failed: 2, batches: 3, invalidTokens: [tok(5)] });
  });
  it('counts a failed batch as failed', async () => {
    const r = await sendPush([tok(1), tok(2)], { title: 'a', body: 'b' }, { fetchImpl: async () => ({ ok: false }) });
    expect(r).toMatchObject({ sent: 0, failed: 2 });
  });
  it('chunks', () => expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]));
});

describe('audit diff', () => {
  it('keeps only changed fields and drops secrets', () => {
    expect(diff({ a: 1, b: 2, pinHash: 'x' }, { a: 1, b: 3, pinHash: 'y' })).toEqual({ before: { b: 2 }, after: { b: 3 } });
  });
});
