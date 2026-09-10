import type { Identity } from "../middleware/privyAuth.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      identity?: Identity;
    }
  }
}

export {};
