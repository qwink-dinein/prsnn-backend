/**
 * Expo push API (https://docs.expo.dev/push-notifications/sending-notifications/).
 * Sends in batches of 100 (Expo's per-request limit). Optional EXPO_ACCESS_TOKEN
 * is sent when the Expo project has "enhanced push security" on.
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const BATCH_SIZE = 100;

export const isExpoToken = (t) => typeof t === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t);

export const chunk = (list, size = BATCH_SIZE) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

/**
 * @param {string[]} tokens
 * @param {{ title: string, body: string, data?: object }} message
 * @returns {Promise<{ sent: number, failed: number, batches: number, invalidTokens: string[] }>}
 */
export async function sendPush(tokens, { title, body, data }, { fetchImpl = globalThis.fetch } = {}) {
    const valid = [...new Set(tokens.filter(isExpoToken))];
    let sent = 0;
    let failed = tokens.length - valid.length;
    const invalidTokens = [];
    const batches = chunk(valid);
    for (const batch of batches) {
        try {
            const res = await fetchImpl(EXPO_PUSH_URL, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
                },
                body: JSON.stringify(batch.map((to) => ({ to, title, body, sound: 'default', ...(data ? { data } : {}) }))),
            });
            if (!res.ok) {
                failed += batch.length;
                continue;
            }
            const json = await res.json().catch(() => ({}));
            const tickets = Array.isArray(json?.data) ? json.data : [];
            batch.forEach((token, i) => {
                const t = tickets[i];
                if (t?.status === 'ok') sent += 1;
                else {
                    failed += 1;
                    if (t?.details?.error === 'DeviceNotRegistered') invalidTokens.push(token);
                }
            });
        } catch (err) {
            console.error('Expo push batch failed:', err.message);
            failed += batch.length;
        }
    }
    return { sent, failed, batches: batches.length, invalidTokens };
}
