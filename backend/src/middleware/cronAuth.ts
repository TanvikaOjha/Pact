import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface CronAuthOptions {
  cronSecret: string | undefined;
  requireAuth: RequestHandler;
}

/**
 * Service-token check for machine callers (external cron / keepers).
 * Humans keep using Privy Bearer auth; machines send
 * `Authorization: Bearer <CRON_SECRET>`. Unset/empty secret never matches.
 */
export function isCronAuthorized(req: Request, cronSecret: string | undefined): boolean {
  if (cronSecret === undefined || cronSecret === "") return false;
  const header = req.header("authorization");
  if (header === undefined) return false;
  return header === `Bearer ${cronSecret}`;
}

/**
 * Cron-or-user auth: cron secret passes immediately, everything else falls
 * through to the Privy requireAuth handler (401/503 semantics unchanged).
 */
export function createRequireCronOrAuth(options: CronAuthOptions): RequestHandler {
  return function requireCronOrAuth(req: Request, res: Response, next: NextFunction): void {
    if (isCronAuthorized(req, options.cronSecret)) {
      next();
      return;
    }
    void options.requireAuth(req, res, next);
  };
}
