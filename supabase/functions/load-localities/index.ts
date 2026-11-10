// One-off loader: India Post "All India Pincode Directory" (data.gov.in, Government
// Open Data Licence – India; copy at github.com/dropdevrahul/pincodes-india, MIT)
// → public.localities. Runs only while the table is empty, so calling it again
// does nothing. State names are mapped to the app's state list.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SRC = 'https://raw.githubusercontent.com/dropdevrahul/pincodes-india/main/pincode.csv';
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const fold = (s: string) => s.toLowerCase().replace(/^the /, '').replace(/&/g, 'and').replace(/[^a-z]/g, '');
const STATE = new Map(STATES.map((s) => [fold(s), s]));
const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\s+/g, ' ').trim();
const clean = (office: string) => title(office.replace(/\s+(b\.?\s?o\.?|s\.?\s?o\.?|h\.?\s?o\.?|g\.?p\.?o\.?)$/i, ''));

function parse(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { count } = await db.from('localities').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) return Response.json({ skipped: true, rows: count });
  const res = await fetch(SRC);
  if (!res.ok) return Response.json({ error: `download ${res.status}` }, { status: 502 });
  const lines = (await res.text()).split(/\r?\n/);
  const head = parse(lines[0]);
  const ix = (k: string) => head.indexOf(k);
  const [iO, iP, iD, iS] = [ix('OfficeName'), ix('Pincode'), ix('District'), ix('StateName')];
  const seen = new Set<string>(); const rows: { state: string; district: string; name: string; pincode: string }[] = []; let unknown = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = parse(line);
    const state = STATE.get(fold(f[iS] ?? ''));
    const pin = (f[iP] ?? '').trim();
    const name = clean(f[iO] ?? '');
    if (!state || !/^\d{6}$/.test(pin) || name.length < 2) { unknown++; continue; }
    const key = `${state}|${name.toLowerCase()}|${pin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ state, district: title(f[iD] ?? ''), name, pincode: pin });
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const { error } = await db.from('localities').upsert(rows.slice(i, i + 2000), { onConflict: 'state,name,pincode', ignoreDuplicates: true });
    if (error) return Response.json({ error: error.message, inserted }, { status: 500 });
    inserted += Math.min(2000, rows.length - i);
  }
  return Response.json({ inserted, skipped: unknown });
});
