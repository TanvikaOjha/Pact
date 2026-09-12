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
// Next 16 convention notes (see node_modules/next/dist/docs/01-app):
// - "use client" boundary at the top: this module uses state, context, and
//   browser-only APIs (localStorage), so it must be a Client Component.
// - Render providers as deep as possible in the tree; Server Components
//   above this boundary stay server-rendered.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

function readStoredAuth(): PersistedAuth {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { walletAddress: null, token: null };
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  // False until localStorage has been read on the client, so the first
  // server render and first client render agree (no hydration mismatch).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredAuth();
    setWalletAddress(stored.walletAddress);
    setTokenState(stored.token);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ walletAddress, token }),
      );
    } catch {
      // Storage unavailable (private mode, quota, SSR) — the session
      // simply won't persist; the in-memory state still works.
    }
  }, [walletAddress, token, ready]);

  const signInDev = useCallback((wallet: string) => {
    setWalletAddress(wallet);
  }, []);

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
  }, []);

  const signOut = useCallback(() => {
    setWalletAddress(null);
    setTokenState(null);
  }, []);

  const api = useMemo<PactApi>(
    () =>
      createApiClient({
        getAuth: () => ({ token, wallet: walletAddress }),
      }),
    [token, walletAddress],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ walletAddress, token, ready, signInDev, setToken, signOut, api }),
    [walletAddress, token, ready, signInDev, setToken, signOut, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
