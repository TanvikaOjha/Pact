import type { NextFunction, Request, Response } from "express";

/**
 * Placeholder Privy auth: expects `x-wallet-address` + `x-privy-wallet-id`
 * headers in dev. Swapped for real Privy token verification in commit 3
 * without changing route handlers (req.identity shape is stable).
 */
export interface Identity {
  walletAddress: string;
  privyWalletId: string;
}

export function privyAuthStub(req: Request, res: Response, next: NextFunction) {
  const wallet = req.header("x-wallet-address");
  const privyWalletId = req.header("x-privy-wallet-id") ?? "dev";
  if (!wallet) {
    res.status(401).json({ error: "missing_identity" });
    return;
  }
  req.identity = {
    walletAddress: wallet,
    privyWalletId,
  };
  next();
}
