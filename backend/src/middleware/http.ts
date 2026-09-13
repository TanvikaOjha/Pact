import type { NextFunction, Request, Response } from "express";

import { log } from "../services/log.js";

const developmentOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin !== undefined && developmentOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wallet-Address, X-Privy-Wallet-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

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
