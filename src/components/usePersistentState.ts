'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * localStorage-backed useState. SSR-safe (lazy init guarded by
 * `typeof window`), never throws (quota/corrupt JSON fall back to
 * `initial`), and stays in sync across tabs via the `storage` event.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded or serialization failed — keep ephemeral state.
    }
  }, [key, value]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== key || event.newValue == null) return;
      try {
        setValue(JSON.parse(event.newValue) as T);
      } catch {
        // Corrupt cross-tab payload — ignore.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [value, setValue];
}
