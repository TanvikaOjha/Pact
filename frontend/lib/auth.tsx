"use client";

// Client-side auth state - Privy primary, dev fallback.
// Privy lands here: @privy-io/react-auth wraps this provider (see components/PrivyWrapper.tsx).
// Backend already speaks Privy Bearer tokens via backend/src/middleware/privyAuth.ts (verifyAccessToken).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
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
    // Storage unavailable
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Dev fallback store (localStorage seam for x-wallet-address headers when Privy not authenticated)
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

  // Privy - fresh token per request to avoid stale JWTs
  const { ready: privyReady, authenticated, user, getAccessToken, login, logout } = usePrivy();
  const { wallets } = useWallets();

  // Derive embedded wallet - prefer Privy-managed, else first wallet
  const privyWallet = useMemo(() => {
    if (!authenticated || !user) return null;
    const embedded = wallets.find((w) => (w as unknown as { walletClientType?: string }).walletClientType === "privy");
    if (embedded?.address) return embedded.address;
    if (wallets[0]?.address) return wallets[0].address;
    const maybeWallet = (user as unknown as { wallet?: { address?: string } }).wallet;
    if (maybeWallet?.address) return maybeWallet.address;
    const accounts = (user as unknown as { linkedAccounts?: Array<{ type: string; address?: string; walletClient?: string; chainType?: string }> }).linkedAccounts;
    if (accounts) {
      const embeddedAcct = accounts.find((a) => a.type === "wallet" && a.walletClient === "privy" && a.chainType === "ethereum");
      if (embeddedAcct?.address) return embeddedAcct.address;
      const eth = accounts.find((a) => a.type === "wallet" && a.chainType === "ethereum");
      if (eth?.address) return eth.address;
    }
    return null;
  }, [authenticated, user, wallets]);

  // Effective identity: Privy wins when authenticated, else dev fallback
  const walletAddress = authenticated && privyWallet ? privyWallet : stored.walletAddress;
  const token = stored.token; // display token, real Bearer is fetched fresh per request
  const ready = privyReady && snapshot !== serverSnapshot;

  const signInDev = useCallback(
    (wallet: string) => {
      if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
        void login();
        write({ walletAddress: wallet, token: stored.token });
        return;
      }
      write({ walletAddress: wallet, token: stored.token });
    },
    [write, stored.token, login],
  );

  const setToken = useCallback(
    (next: string | null) => {
      write({ walletAddress: stored.walletAddress, token: next });
    },
    [write, stored.walletAddress],
  );

  const signOut = useCallback(() => {
    write({ walletAddress: null, token: null });
    if (authenticated) void logout();
  }, [write, authenticated, logout]);

  const api = useMemo<PactApi>(
    () =>
      createApiClient({
        getAuth: async () => {
          if (authenticated && privyReady) {
            try {
              const t = await getAccessToken();
              if (t) return { token: t, wallet: privyWallet ?? stored.walletAddress };
            } catch {
              // fall through to dev fallback
            }
          }
          return { token: stored.token, wallet: walletAddress };
        },
      }),
    [authenticated, privyReady, privyWallet, stored.token, stored.walletAddress, walletAddress, getAccessToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      walletAddress,
      token,
      ready,
      signInDev,
      setToken,
      signOut,
      api,
    }),
    [walletAddress, token, ready, signInDev, setToken, signOut, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
