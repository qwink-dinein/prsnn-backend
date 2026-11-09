// Superadmin push broadcast: POST { audience: 'members' | 'companions', title, body }.
// The caller's JWT is checked against profiles (must be an active superadmin).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendPush } from '../_shared/push.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: isSuper } = await asCaller.rpc('is_superadmin');
  if (isSuper !== true) return reply(403, { message: 'Access denied' });
  const { data: { user } } = await asCaller.auth.getUser();

  const body = await req.json().catch(() => ({}));
  const audience = body.audience;
  const title = String(body.title ?? '').trim();
  const text = String(body.body ?? '').trim();
  if (!['members', 'companions'].includes(audience)) return reply(400, { message: 'Choose Members or Companions.' });
  if (title.length < 2 || title.length > 65) return reply(400, { message: 'Title must be 2–65 characters.' });
  if (text.length < 2 || text.length > 240) return reply(400, { message: 'Message must be 2–240 characters.' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: tokens } = await admin.rpc('broadcast_tokens', { aud: audience });
  const list = (tokens ?? []) as string[];
  const r = await sendPush(list.map((to) => ({ to, title, body: text, data: { kind: 'broadcast' } })));
  if (r.invalid.length) await admin.rpc('forget_push_tokens', { tokens: r.invalid });
  const { data: record } = await admin.from('broadcasts').insert({ audience, title, body: text, sent_by: user?.id, recipients: list.length, sent: r.sent, failed: r.failed, batches: r.batches }).select().single();
  await admin.from('audit_log').insert({ actor_id: user?.id, role: 'superadmin', action: 'broadcast.send', target_kind: 'broadcast', target_id: record?.id, after: { audience, title, recipients: list.length, sent: r.sent, failed: r.failed } });
  return reply(201, {
    message: list.length ? `Sent to ${r.sent} of ${list.length} devices.` : 'Nobody in this audience has notifications turned on yet.',
    broadcast: record && { _id: record.id, audience, title, body: text, recipients: list.length, sent: r.sent, failed: r.failed, createdAt: record.created_at },
  });
});
