import { Router, type NextFunction, type Request, type Response } from "express";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { z } from "zod";

import { verifyWorldProof, jsonValueSchema } from "../services/world.js";

const worldVerifyRequestSchema = z.object({
  /** Complete IDKit result, forwarded to the portal byte-for-byte. */
  proof: jsonValueSchema,
});

export interface WorldRouteOptions {
  devWorldStub: boolean;
  appId: string | undefined;
  rpId: string | undefined;
  expectedAction: string | undefined;
  signingKey?: string | undefined;
}

export interface WorldRpContextResponse {
  app_id: string;
  rp_id: string;
  action: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/**
 * GET /world/rp-context — signed RP request for UI widgets (public, no auth).
 * The signing key must live in the server secret store and never reach the client.
 */
async function handleWorldRpContext(
  _req: Request,
  res: Response,
  options: WorldRouteOptions,
): Promise<void> {
  if (options.signingKey === undefined || options.signingKey === "") {
    res.status(503).json({ error: "world_unconfigured" });
    return;
  }
  if (
    options.appId === undefined ||
    options.appId === "" ||
    options.rpId === undefined ||
    options.rpId === ""
  ) {
    res.status(503).json({ error: "world_unconfigured" });
    return;
  }

  const action = options.expectedAction ?? "pact-selfie-check";
  const signed = signRequest({
    action,
    signingKeyHex: options.signingKey,
  });

  const payload: WorldRpContextResponse = {
    app_id: options.appId ?? "",
    rp_id: options.rpId,
    action,
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    signature: signed.sig,
  };

  res.json(payload);
}

/**
 * POST /world/verify — World Selfie Check for identity activation (and later
 * high-value milestone acceptance). Mounted behind requireAuth: the caller is
 * always Privy-authed by this step, and auth prevents anonymous proof-spraying.
 */
export function createWorldRpContextRouter(options: WorldRouteOptions): Router {
  const router = Router();
  router.get("/world/rp-context", (req: Request, res: Response, next: NextFunction) => {
    void handleWorldRpContext(req, res, options).catch(next);
  });
  return router;
}

export function createWorldRouter(options: WorldRouteOptions): Router {
  const router = Router();
  router.post("/world/verify", (req: Request, res: Response, next: NextFunction) => {
    void handleWorldVerify(req, res, options).catch(next);
  });
  return router;
}

async function handleWorldVerify(
  req: Request,
  res: Response,
  options: WorldRouteOptions,
): Promise<void> {
  const parsed = worldVerifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_proof" });
    return;
  }
  if (options.devWorldStub) {
    res.json({ pass: true, sessionId: "session_dev_stub", nullifier: null });
    return;
  }
  if (options.rpId === undefined || options.rpId === "") {
    res.status(503).json({ error: "world_unconfigured" });
    return;
  }
  const result = await verifyWorldProof(parsed.data.proof, {
    rpId: options.rpId,
    expectedAction: options.expectedAction,
  });
  if (!result.pass) {
    res.status(422).json({ pass: false, code: result.code });
    return;
  }
  res.json({ pass: true, sessionId: result.sessionId, nullifier: result.nullifier });
}
