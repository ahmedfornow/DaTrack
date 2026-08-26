import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

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

/**
 * Typed against the generated schema, so a query that selects a column which
 * does not exist fails the build instead of returning `undefined` at runtime.
 *
 * Note what this does *not* buy us: the database has no Postgres enums, so
 * `sale_type`, `customer_type`, `shift`, `role` and `status` all arrive as
 * plain `string`. The compiler cannot tell `'LAS'` from `'las'` or a typo.
 * Value-level safety for those lives in `src/domain/*` and is checked at the
 * boundary — see `features/auth/profile.ts` for the pattern.
 */
export const db = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
