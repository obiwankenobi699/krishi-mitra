import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient | null {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  browserClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return browserClient;
}

export function marketplaceImage(path: string | null | undefined): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return path && url ? `${url}/storage/v1/object/public/marketplace-images/${path}` : null;
}
