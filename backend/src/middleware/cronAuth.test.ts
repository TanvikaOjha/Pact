import type { NextFunction, Request, RequestHandler, Response } from "express";
import { describe, expect, test } from "vitest";

import { createRequireCronOrAuth, isCronAuthorized } from "./cronAuth.js";

function requestWithAuth(header: string | undefined): Request {
  // SAFETY: tests only read req.header("authorization"); no other Request surface is touched.
  return {
    header: (name: string) => (name === "authorization" ? header : undefined),
  } as Request;
}

describe("isCronAuthorized", () => {
  test("matches the exact bearer secret only", () => {
    expect(isCronAuthorized(requestWithAuth("Bearer ops-secret"), "ops-secret")).toBe(true);
    expect(isCronAuthorized(requestWithAuth("Bearer wrong"), "ops-secret")).toBe(false);
    expect(isCronAuthorized(requestWithAuth(undefined), "ops-secret")).toBe(false);
    expect(isCronAuthorized(requestWithAuth("Bearer ops-secret"), undefined)).toBe(false);
    expect(isCronAuthorized(requestWithAuth("Bearer ops-secret"), "")).toBe(false);
  });
});

describe("createRequireCronOrAuth", () => {
  test("cron secret passes without touching user auth", async () => {
    let fallbackCalls = 0;
    const fallback: RequestHandler = (_req, _res, next) => {
      fallbackCalls += 1;
      next();
    };
    const handler = createRequireCronOrAuth({ cronSecret: "ops-secret", requireAuth: fallback });
    let nextCalls = 0;
    // SAFETY: handler only calls next() on this path; res is untouched.
    const res = {} as Response;
    await new Promise<void>((resolve) => {
      // SAFETY: test next() only counts calls and resolves; no Express internals needed.
      const next = (() => {
        nextCalls += 1;
        resolve();
      }) as NextFunction;
      handler(requestWithAuth("Bearer ops-secret"), res, next);
    });
    expect(nextCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
  });

  test("non-cron requests fall through to requireAuth", () => {
    const seen: string[] = [];
    const statuses: number[] = [];
    const fallback: RequestHandler = (req, res, _next) => {
      seen.push(req.header("authorization") ?? "none");
      res.status(401).json({ error: "missing_token" });
    };
    const handler = createRequireCronOrAuth({ cronSecret: "ops-secret", requireAuth: fallback });
    // SAFETY: fallback only uses res.status().json(); no other Response surface is touched.
    const res = {
      status: (code: number) => {
        statuses.push(code);
        return { json: (_body: { error: string }): void => {} };
      },
    } as Response;
    // SAFETY: fallback never calls next() on this path; a no-op satisfies the signature.
    const next = (() => {}) as NextFunction;
    handler(requestWithAuth(undefined), res, next);
    expect(seen).toEqual(["none"]);
    expect(statuses).toEqual([401]);
  });
});
