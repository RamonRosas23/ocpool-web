'use client';

import { useCallback, useEffect, useState } from 'react';

function readStoredValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStoredValue<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, storage disabled, or quota exceeded: the preference simply
    // won't persist this session, same as before this hook existed.
  }
}

// Hydrates from localStorage in an effect rather than a lazy useState initializer: reading
// storage during render would make the client's first render disagree with the server-rendered
// HTML (which has no localStorage to read), producing a hydration mismatch. Callers that use this
// value to drive a data fetch must gate that fetch on the returned `isHydrated` flag -- firing
// once with the fallback and again once hydration resolves would race two requests against each
// other, and whichever response lands last (not the persisted one) would win.
//
// Writes happen synchronously inside the returned setter, not from a passive "watch value, write
// it" effect, so a write only ever happens in direct response to the setter actually being called.
//
// A `PrivateSelect` bound to this value must remount once `isHydrated` flips (e.g. via a `key`
// prop) rather than receive the hydrated value as a normal prop update: Radix Select mirrors its
// controlled value onto a visually-hidden native <select> for autofill/form support, and that
// mirror can echo a stale change event back through onValueChange when the controlled value
// transitions asynchronously post-mount (confirmed live: the echo reports the pre-hydration
// value, silently reverting the just-restored preference). Mounting the select already-hydrated
// sidesteps the transition entirely.
export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setValue(readStoredValue(key, initialValue));
    setIsHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setPersistentValue = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      writeStoredValue(key, resolved);
      return resolved;
    });
  }, [key]);

  return [value, setPersistentValue, isHydrated] as const;
}
