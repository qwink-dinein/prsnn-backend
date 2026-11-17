// Deletes the files of deleted accounts (profile photos; ID documents and selfie unless
// there is an open safety case). Called right after each account deletion and by pg_cron
// every 15 minutes. Safe to call by anyone: it only removes what the database lists as
// belonging to an account that no longer exists.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async () => {
  let removed = 0;
  const errors: string[] = [];
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('purge_files_claim', { lim: 200 });
    if (error) return json({ error: error.message, removed }, 500);
    const files = (data ?? []) as { bucket: string; name: string }[];
    if (!files.length) break;
    const byBucket = new Map<string, string[]>();
    for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.name]);
    let progress = 0;
    for (const [bucket, names] of byBucket) {
      const { data: gone, error: e } = await db.storage.from(bucket).remove(names);
      if (e) errors.push(`${bucket}: ${e.message}`);
      progress += gone?.length ?? 0;
    }
    removed += progress;
    if (!progress) break; // nothing could be removed this round: stop instead of looping
  }
  return json({ removed, errors });
});
