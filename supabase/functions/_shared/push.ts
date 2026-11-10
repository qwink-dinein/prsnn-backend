// Expo push API, batches of 100. EXPO_ACCESS_TOKEN only if "enhanced push security" is on.
export const isExpoToken = (t: unknown): t is string => typeof t === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t);

export async function sendPush(messages: { to: string; title?: string; body: string; data?: Record<string, unknown>; priority?: 'default' | 'high'; channelId?: string }[]) {
  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];
  const valid = messages.filter((m) => isExpoToken(m.to));
  failed += messages.length - valid.length;
  let batches = 0;
  for (let i = 0; i < valid.length; i += 100) {
    const batch = valid.slice(i, i + 100);
    batches++;
    try {
      const token = Deno.env.get('EXPO_ACCESS_TOKEN');
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(batch.map((m) => ({ sound: 'default', ...m }))),
      });
      if (!res.ok) {
        failed += batch.length;
        continue;
      }
      const tickets = ((await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] }).data ?? [];
      batch.forEach((m, j) => {
        if (tickets[j]?.status === 'ok') sent++;
        else {
          failed++;
          if (tickets[j]?.details?.error === 'DeviceNotRegistered') invalid.push(m.to);
        }
      });
    } catch {
      failed += batch.length;
    }
  }
  return { sent, failed, batches, invalid };
}
