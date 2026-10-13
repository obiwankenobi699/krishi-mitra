import { getSupabase } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (authenticated) {
    const supabase = getSupabase();
    const { data } = supabase
      ? await supabase.auth.getSession()
      : { data: { session: null } };
    const token = data?.session?.access_token;
    if (!token) throw new Error('Please sign in to continue.');
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail || 'Something went wrong. Please try again.');
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const supabase = getSupabase();
  const { data } = supabase
    ? await supabase.auth.getSession()
    : { data: { session: null } };
  if (!data?.session?.access_token) throw new Error('Please sign in to continue.');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail || 'Voice assistant is unavailable.');
  }
  return response.blob();
}
