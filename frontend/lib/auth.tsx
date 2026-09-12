"use client";

// Client-side auth state for the Pact backend-sync layer.
//
// Auth seam: Privy lands HERE later. Today this holds a dev wallet address
// (+ an optional Privy access token string) in localStorage; when the Privy
// SDK is installed, wrap the tree in <PrivyProvider> above/around this
// provider, replace signInDev() with the Privy login flow, and feed the
// Privy access token through setToken(). The api client already speaks the
// backend's auth semantics (Bearer token preferred, dev wallet headers as
// fallback — see lib/api.ts), so only this file needs to change.
// No auth SDK is installed yet on purpose.
//
// State sync uses useSyncExternalStore over localStorage (no effects): the
// server snapshot is empty, the client re-reads after hydration, and every
// writer bumps a nonce so same-tab writes re-render deterministically.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createApiClient } from "./api";
import type { PactApi } from "./api";

const STORAGE_KEY = "pact.auth.v1";

export interface AuthContextValue {
  walletAddress: string | null;
  token: string | null;
  ready: boolean;
  signInDev(wallet: string): void;
  setToken(token: string | null): void;
  signOut(): void;
  api: PactApi;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface PersistedAuth {
  walletAddress: string | null;
  token: string | null;
}

function readSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeSnapshot(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function parseSnapshot(raw: string): PersistedAuth {
  try {
    if (raw === "") return { walletAddress: null, token: null };
    const parsed = JSON.parse(raw) as Partial<PersistedAuth>;
    return {
      walletAddress:
        typeof parsed.walletAddress === "string" ? parsed.walletAddress : null,
      token: typeof parsed.token === "string" ? parsed.token : null,
    };
  } catch {
    return { walletAddress: null, token: null };
  }
}

function writeSnapshot(auth: PersistedAuth): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // Storage unavailable (private mode, quota) — callers still update
    // React state, so the session works until reload.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Bumped on every same-tab write (storage events only fire cross-tab).
  const [nonce, setNonce] = useState(0);
  const serverSnapshot = useMemo(() => "", []);
  const snapshot = useSyncExternalStore(
    subscribeSnapshot,
    () => `${nonce}:${readSnapshot()}`,
    () => serverSnapshot,
  );
  const stored = useMemo(
    () => parseSnapshot(snapshot.slice(snapshot.indexOf(":") + 1)),
    [snapshot],
  );

  const write = useCallback((auth: PersistedAuth) => {
    writeSnapshot(auth);
    setNonce((n) => n + 1);
  }, []);

  const signInDev = useCallback(
    (wallet: string) => {
      write({ walletAddress: wallet, token: stored.token });
    },
    [write, stored.token],
  );

  const setToken = useCallback(
    (next: string | null) => {
      write({ walletAddress: stored.walletAddress, token: next });
    },
    [write, stored.walletAddress],
  );

  const signOut = useCallback(() => {
    write({ walletAddress: null, token: null });
  }, [write]);

  const api = useMemo<PactApi>(
    () =>
      createApiClient({
        getAuth: () => ({ token: stored.token, wallet: stored.walletAddress }),
      }),
    [stored.token, stored.walletAddress],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      walletAddress: stored.walletAddress,
      token: stored.token,
      // During hydration React renders the server snapshot (""); the client
      // value lands on the re-render right after. Gates keyed on `ready`
      // therefore wait exactly one render — no mismatch, no redirect flash.
      ready: snapshot !== serverSnapshot,
      signInDev,
      setToken,
      signOut,
      api,
    }),
    [stored.walletAddress, stored.token, snapshot, serverSnapshot, signInDev, setToken, signOut, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
