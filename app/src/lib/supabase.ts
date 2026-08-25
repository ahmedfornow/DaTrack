import { createClient } from '@supabase/supabase-js';

/**
 * The single Supabase client instance.
 *
 * The publishable key is public and that is fine — it is already in the legacy
 * app, which is a static file anyone can read. RLS is the only real security
 * boundary. The `service_role` key must never appear here: it bypasses RLS
 * entirely, and anything needing it (creating auth users, resetting passwords)
 * stays in the Supabase dashboard or moves to an Edge Function.
 */
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://lgewtvrqfofnkrfzqqlz.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_lrw3zxHRNhgOYqwivMhrjQ_QV5z-NmN';

if (/service_role|^sbp_|secret/i.test(SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error(
    'Refusing to start: a secret key reached client code. Only the publishable key belongs here.',
  );
}

// TODO(types): once `src/types/database.ts` is generated, this becomes
// `createClient<Database>(...)` and every query in `src/data/*` is checked at
// build time. Until then `features/auth/profile.ts` validates at runtime.
export const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
