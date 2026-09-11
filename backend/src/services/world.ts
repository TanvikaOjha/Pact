import { z } from "zod";

import { log } from "./log.js";

/** Developer Portal verification endpoint (docs.world.org/world-id/idkit/integrate). */
export const WORLD_VERIFY_BASE_URL = "https://developer.world.org/api/v4/verify";

const worldResultSchema = z.object({
  identifier: z.string().optional(),
  success: z.boolean().optional(),
  nullifier: z.string().nullable().optional(),
  code: z.string().optional(),
  detail: z.string().optional(),
});

const worldSuccessSchema = z.object({
  success: z.literal(true),
  action: z.string().optional(),
  nullifier: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  results: z.array(worldResultSchema).optional(),
});

const worldErrorSchema = z.object({
  success: z.literal(false),
  code: z.string(),
  detail: z.string().optional(),
});

export interface WorldVerification {
  pass: boolean;
  sessionId: string | null;
  nullifier: string | null;
  code: string | null;
}

/** Arbitrary JSON: the IDKit result is forwarded byte-for-byte, never inspected. */
export type OpaqueProof =
  | string
  | number
  | boolean
  | null
  | OpaqueProof[]
  | { [key: string]: OpaqueProof };

export const jsonValueSchema: z.ZodType<OpaqueProof> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

/** Narrow fetch surface so tests can stub the portal without a network. */
export interface WorldFetch {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{ json(): Promise<OpaqueProof> }>;
}

export interface WorldVerifyOptions {
  rpId: string;
  expectedAction: string | undefined;
  fetchImpl?: WorldFetch;
}

function nullifierFromResults(results: z.infer<typeof worldSuccessSchema>["results"]): string | null {
  if (results === undefined) return null;
  for (const result of results) {
    if (result.success === true && result.nullifier !== undefined && result.nullifier !== null) {
      return result.nullifier;
    }
  }
  return null;
}

/**
 * Verify a complete IDKit result against the Developer Portal. The proof is
 * forwarded as-is (docs forbid remapping). Never throws: every failure maps
 * to `{ pass: false, code }`. Callers persist sessionId/nullifier and enforce
 * nullifier uniqueness at registration.
 */
export async function verifyWorldProof(
  proof: OpaqueProof,
  options: WorldVerifyOptions,
): Promise<WorldVerification> {
  const fetchFn: WorldFetch = options.fetchImpl ?? fetch;
  let response: { json(): Promise<OpaqueProof> };
  try {
    response = await fetchFn(`${WORLD_VERIFY_BASE_URL}/${options.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof),
    });
  } catch {
    log.error("World verify request failed");
    return { pass: false, sessionId: null, nullifier: null, code: "request_failed" };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    log.error("World verify returned a non-JSON payload");
    return { pass: false, sessionId: null, nullifier: null, code: "bad_response" };
  }
  const rejected = worldErrorSchema.safeParse(payload);
  if (rejected.success) {
    log.error(`World verify rejected: ${rejected.data.code}`);
    return { pass: false, sessionId: null, nullifier: null, code: rejected.data.code };
  }
  const parsed = worldSuccessSchema.safeParse(payload);
  if (!parsed.success) {
    log.error("World verify returned an unrecognized payload");
    return { pass: false, sessionId: null, nullifier: null, code: "bad_response" };
  }
  const data = parsed.data;
  if (
    options.expectedAction !== undefined &&
    data.action !== undefined &&
    data.action !== options.expectedAction
  ) {
    log.error(`World verify action mismatch: ${data.action}`);
    return { pass: false, sessionId: null, nullifier: null, code: "action_mismatch" };
  }
  return {
    pass: true,
    sessionId: data.session_id ?? null,
    nullifier: data.nullifier ?? nullifierFromResults(data.results),
    code: null,
  };
}
