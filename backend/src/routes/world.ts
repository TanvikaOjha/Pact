import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { verifyWorldProof, type OpaqueProof } from "../services/world.js";

const jsonValueSchema: z.ZodType<OpaqueProof> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const worldVerifyRequestSchema = z.object({
  /** Complete IDKit result, forwarded to the portal byte-for-byte. */
  proof: jsonValueSchema,
});

export interface WorldRouteOptions {
  devWorldStub: boolean;
  rpId: string | undefined;
  expectedAction: string | undefined;
}

/**
 * POST /world/verify — World Selfie Check for identity activation (and later
 * high-value milestone acceptance). Mounted behind requireAuth: the caller is
 * always Privy-authed by this step, and auth prevents anonymous proof-spraying.
 */
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
