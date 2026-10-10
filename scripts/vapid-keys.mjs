// Writes a new VAPID key pair (the keys that sign chat notifications) to the
// file given, as KEY=value lines for `supabase secrets set --env-file`.
// Used once by .github/workflows/functions.yml; the keys never appear in logs
// or in the code.
import { writeFileSync } from 'node:fs';
import { generateVapidKeys } from '../supabase/functions/_shared/webpush.js';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/vapid-keys.mjs <output file>');
const keys = await generateVapidKeys();
writeFileSync(
  file,
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:team@jiveturkeys.app\n`,
  { mode: 0o600 },
);
console.log('New notification keys written.');
