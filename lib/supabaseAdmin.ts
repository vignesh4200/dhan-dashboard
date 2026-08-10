import { createClient } from "@supabase/supabase-js";

// Server-only client using the service-role key — never expose this key to the browser.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
