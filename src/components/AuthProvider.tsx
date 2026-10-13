'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type * as React from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthState {
  session: Session | null;
  status: AuthStatus;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  user: User | null;
  ready: boolean;
  isAuthenticated: boolean;
  refreshSession: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

type AuthAction =
  | { type: 'SESSION'; session: Session | null }
  | { type: 'ERROR'; message: string }
  | { type: 'LOADING' };

const initialState: AuthState = { session: null, status: 'loading', error: null };
const AuthContext = createContext<AuthContextValue | null>(null);

function authReducer(state: AuthState, action: AuthAction): AuthState {
  if (action.type === 'LOADING') return { ...state, status: 'loading', error: null };
  if (action.type === 'ERROR') return { session: state.session, status: 'error', error: action.message };
  return {
    session: action.session,
    status: action.session ? 'authenticated' : 'anonymous',
    error: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Authentication is temporarily unavailable.';
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const revision = useRef<number>(0);

  const refreshSession = useCallback(async (): Promise<void> => {
    const supabase = getSupabase();
    if (!supabase) {
      dispatch({ type: 'ERROR', message: 'Supabase public environment variables are not configured.' });
      return;
    }
    const requestRevision = revision.current;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (revision.current !== requestRevision) return;
      revision.current += 1;
      dispatch({ type: 'SESSION', session: data.session });
    } catch (error: unknown) {
      if (revision.current !== requestRevision) return;
      dispatch({ type: 'ERROR', message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      dispatch({ type: 'ERROR', message: 'Supabase public environment variables are not configured.' });
      return;
    }

    let active = true;
    const applyAuthEvent = (_event: AuthChangeEvent, nextSession: Session | null): void => {
      if (!active) return;
      revision.current += 1;
      dispatch({ type: 'SESSION', session: nextSession });
    };
    const { data: authListener } = supabase.auth.onAuthStateChange(applyAuthEvent);

    const startRevision = revision.current;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || revision.current !== startRevision) return;
      if (error) dispatch({ type: 'ERROR', message: error.message });
      else dispatch({ type: 'SESSION', session: data.session });
    }).catch((error: unknown) => {
      if (active && revision.current === startRevision) {
        dispatch({ type: 'ERROR', message: errorMessage(error) });
      }
    });

    const resync = (): void => { void refreshSession(); };
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') resync();
    };
    const handleStorage = (event: StorageEvent): void => {
      if (event.key?.includes('auth-token')) resync();
    };
    window.addEventListener('focus', resync);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener('focus', resync);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshSession]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    user: state.session?.user ?? null,
    ready: state.status !== 'loading',
    isAuthenticated: state.status === 'authenticated',
    refreshSession,
    async signIn(): Promise<void> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase public environment variables are not configured.');
      revision.current += 1;
      dispatch({ type: 'LOADING' });
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/farms` },
      });
      if (error) {
        dispatch({ type: 'ERROR', message: error.message });
        throw error;
      }
    },
    async signOut(): Promise<void> {
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        dispatch({ type: 'ERROR', message: error.message });
        throw error;
      }
      dispatch({ type: 'SESSION', session: null });
    },
  }), [refreshSession, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
