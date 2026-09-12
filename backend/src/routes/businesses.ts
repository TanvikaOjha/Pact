import { Router, type NextFunction, type Request, type Response } from "express";
import { keccak256, stringToHex } from "viem";
import { z } from "zod";

import type { BusinessStore } from "../repos/businesses.js";
import { jsonValueSchema, verifyWorldProof } from "../services/world.js";

const registerRequestSchema = z.object({
  slug: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  /** Complete IDKit result, verified server-side before anything is stored. */
  proof: jsonValueSchema,
  /** Optional contact for lifecycle notifications (submission, release, disputes). */
  email: z.string().email().max(254).optional(),
});

export interface BusinessesRouteOptions {
  store: BusinessStore;
  /** Null when chain config is absent; the check is skipped (fail open, logged). */
  checkChainActive: ((walletAddress: string) => Promise<boolean>) | null;
  world: {
    devWorldStub: boolean;
    rpId: string | undefined;
    expectedAction: string | undefined;
  };
  /** ENS root subnames live under (env ENS_ROOT_NAME, pact-hack.eth on Sepolia). */
  ensRoot: string;
}

export function devSessionId(): string {
  return `session_dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function suggestSlugs(
  store: BusinessStore,
  slug: string,
  ensRoot: string,
  limit: number,
): Promise<string[]> {
  const suggestions: string[] = [];
  for (let counter = 2; suggestions.length < limit; counter += 1) {
    const candidate = `${slug}-${counter}.${ensRoot}`;
    const taken = await store.findBySubname(candidate);
    if (taken === null) suggestions.push(candidate);
  }
  return suggestions;
}

/**
 * POST /businesses/register — reserve a business identity after World
 * verification. The backend verifies, dedupes (wallet, slug, session), and
 * records the mirror row; the caller then sends `registerBusiness` from their
 * own wallet (backend never holds user keys), and ENS minting follows.
 */
export function createBusinessesRouter(options: BusinessesRouteOptions): Router {
  const router = Router();
  router.post("/businesses/register", (req: Request, res: Response, next: NextFunction) => {
    void handleRegister(req, res, options).catch(next);
  });
  return router;
}

async function handleRegister(
  req: Request,
  res: Response,
  options: BusinessesRouteOptions,
): Promise<void> {
  const identity = req.identity;
  if (identity === undefined) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  const parsed = registerRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { slug, proof, email } = parsed.data;
  const existing = await options.store.findByWallet(identity.walletAddress);
  if (existing !== null) {
    res.status(409).json({ error: "already_registered", ensSubname: existing.ens_subname });
    return;
  }
  const ensSubname = `${slug}.${options.ensRoot}`;
  const slugTaken = await options.store.findBySubname(ensSubname);
  if (slugTaken !== null) {
    res.status(409).json({
      error: "slug_taken",
      suggestions: await suggestSlugs(options.store, slug, options.ensRoot, 2),
    });
    return;
  }
  const sessionId = await verifySession(proof, options, res);
  if (sessionId === null) return;
  const sessionUsed = await options.store.findByWorldSession(sessionId);
  if (sessionUsed !== null) {
    res.status(409).json({ error: "session_reused" });
    return;
  }
  if (options.checkChainActive !== null) {
    const active = await options.checkChainActive(identity.walletAddress);
    if (active) {
      res.status(409).json({ error: "already_active_onchain" });
      return;
    }
  }
  await options.store.insert({
    walletAddress: identity.walletAddress,
    privyWalletId: identity.privyWalletId,
    ensSubname,
    worldSessionId: sessionId,
    email: email ?? null,
  });
  res.status(201).json({
    ensSubname,
    walletAddress: identity.walletAddress,
    worldSessionId: sessionId,
    worldSessionIdBytes32: keccak256(stringToHex(sessionId)),
    status: "pending_onchain",
  });
}

/**
 * Verify the World proof and return the bound session id, or null after
 * responding with the failure. Stub sessions are unique per call so the
 * reuse guard stays meaningful in dev.
 */
async function verifySession(
  proof: z.infer<typeof registerRequestSchema>["proof"],
  options: BusinessesRouteOptions,
  res: Response,
): Promise<string | null> {
  if (options.world.devWorldStub) return devSessionId();
  if (options.world.rpId === undefined || options.world.rpId === "") {
    res.status(503).json({ error: "world_unconfigured" });
    return null;
  }
  const result = await verifyWorldProof(proof, {
    rpId: options.world.rpId,
    expectedAction: options.world.expectedAction,
  });
  if (!result.pass || result.sessionId === null) {
    res.status(422).json({ pass: false, code: result.code ?? "no_session" });
    return null;
  }
  return result.sessionId;
}
