import { PrivyClient, type LinkedAccount, type User } from "@privy-io/node";
import type { NextFunction, Request, Response } from "express";

/**
 * Verified caller identity. Shape is stable: route handlers must not reach
 * into Privy SDK types. `privyWalletId` is the embedded wallet id when the
 * resolving wallet is Privy-embedded, otherwise the user's Privy DID.
 */
export interface Identity {
  walletAddress: string;
  privyWalletId: string;
}

/** Minimal surface of PrivyClient used here; kept narrow so tests can stub it. */
export interface PrivyVerifier {
  verifyToken(token: string): Promise<{ userId: string }>;
  getUser(userId: string): Promise<User>;
}

export interface AuthOptions {
  allowDevAuth: boolean;
  verifier: PrivyVerifier | null;
}

interface WalletCandidate {
  address: string;
  id: string | null;
  embedded: boolean;
}

function embeddedId(account: LinkedAccount): string | null {
  if (account.type !== "wallet") return null;
  if (!("wallet_client" in account) || account.wallet_client !== "privy") return null;
  if (!("id" in account)) return null;
  const id = account.id;
  if (id === null || id === undefined) return null;
  return id;
}

/** All ethereum wallets on the user, embedded first, deduped by address. */
function ethereumWallets(user: User): WalletCandidate[] {
  const candidates: WalletCandidate[] = [];
  for (const account of user.linked_accounts) {
    if (account.type !== "wallet") continue;
    if (!("chain_type" in account) || account.chain_type !== "ethereum") continue;
    if (!("address" in account)) continue;
    const embedded = "wallet_client" in account && account.wallet_client === "privy";
    candidates.push({
      address: account.address,
      id: embedded ? embeddedId(account) : null,
      embedded,
    });
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Resolve the signing identity for a verified Privy user: the embedded
 * ethereum wallet when present, else the first ethereum wallet. Returns null
 * when the user has no ethereum wallet to sign with.
 */
export function resolveIdentity(user: User): Identity | null {
  const wallets = ethereumWallets(user);
  if (wallets.length === 0) return null;
  const selected = wallets.find((wallet) => wallet.embedded) ?? wallets[0];
  return {
    walletAddress: selected.address,
    privyWalletId: selected.id ?? user.id,
  };
}

/** Null when Privy credentials are absent; callers fall back to dev auth or 503. */
export function getPrivyClient(
  appId: string | undefined,
  appSecret: string | undefined,
  jwtVerificationKey: string | undefined,
): PrivyClient | null {
  if (appId === undefined || appId === "" || appSecret === undefined || appSecret === "") {
    return null;
  }
  return new PrivyClient({ appId, appSecret, jwtVerificationKey });
}

/** Adapt PrivyClient to the narrow verifier surface (isolates SDK API drift). */
export function createPrivyVerifier(client: PrivyClient): PrivyVerifier {
  return {
    verifyToken: async (token: string) => {
      const claims = await client.utils().auth().verifyAccessToken(token);
      return { userId: claims.user_id };
    },
    getUser: (userId: string) => client.users()._get(userId),
  };
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header === undefined) return null;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return null;
  const token = header.slice(prefix.length);
  return token === "" ? null : token;
}

/**
 * Dev-only header auth. Never reachable in prod unless ALLOW_DEV_AUTH=true.
 * Kept as a named export so tests and local tooling can use it directly.
 */
export function privyAuthStub(req: Request, res: Response, next: NextFunction): void {
  const wallet = req.header("x-wallet-address");
  const privyWalletId = req.header("x-privy-wallet-id") ?? "dev";
  if (wallet === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  req.identity = {
    walletAddress: wallet,
    privyWalletId,
  };
  next();
}

async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
  verifier: PrivyVerifier | null,
  token: string,
): Promise<void> {
  if (verifier === null) {
    res.status(503).json({ error: "auth_unavailable" });
    return;
  }
  try {
    const claims = await verifier.verifyToken(token);
    const user = await verifier.getUser(claims.userId);
    const identity = resolveIdentity(user);
    if (identity === null) {
      res.status(401).json({ error: "no_wallet" });
      return;
    }
    req.identity = identity;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

/**
 * Bearer-token auth via Privy; dev-header fallback only when allowDevAuth.
 * Mount on routers that require a verified caller (e.g. `/api`).
 */
export function createRequireAuth(
  options: AuthOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = bearerToken(req);
    if (token !== null) {
      await authenticateToken(req, res, next, options.verifier, token);
      return;
    }
    if (options.allowDevAuth) {
      privyAuthStub(req, res, next);
      return;
    }
    res.status(401).json({ error: "missing_token" });
  };
}
