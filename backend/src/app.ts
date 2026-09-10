import express, { Router } from "express";
import { loadEnv } from "./config/env.js";
import { errorHandler, requestId } from "./middleware/http.js";
import { createRequireAuth, createPrivyVerifier, getPrivyClient } from "./middleware/privyAuth.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";

export function createApp() {
  const env = loadEnv();
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(healthRouter);
  const apiRouter = Router();
  const privyClient = getPrivyClient(
    env.PRIVY_APP_ID,
    env.PRIVY_APP_SECRET,
    env.PRIVY_JWT_VERIFICATION_KEY,
  );
  apiRouter.use(
    createRequireAuth({
      allowDevAuth: env.ALLOW_DEV_AUTH,
      verifier: privyClient === null ? null : createPrivyVerifier(privyClient),
    }),
  );
  apiRouter.use(meRouter);
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
}
