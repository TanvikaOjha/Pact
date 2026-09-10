import type { NextFunction, Request, Response } from "express";

import { log } from "../services/log.js";

export function requestId(req: Request, _res: Response, next: NextFunction) {
  req.requestId = Math.random().toString(36).slice(2, 10);
  next();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  cause: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  log.error(`[${req.requestId}] ${String(cause)}`);
  res.status(500).json({ error: "internal_error" });
}
