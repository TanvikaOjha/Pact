import express, { Router } from "express";
import { loadEnv } from "./config/env.js";
import { getSupabase } from "./config/supabase.js";
import { getRegistryReader } from "./chain/registry.js";
import { errorHandler, requestId } from "./middleware/http.js";
import { createRequireAuth, createPrivyVerifier, getPrivyClient } from "./middleware/privyAuth.js";
import { createSupabaseBusinessStore } from "./repos/businesses.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { createBusinessesRouter } from "./routes/businesses.js";
import { createWorldRouter } from "./routes/world.js";

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
  const businessStore = createSupabaseBusinessStore(
    getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
  );
  const registryReader = getRegistryReader(env.SEPOLIA_RPC_URL, env.PACT_REGISTRY_ADDRESS);
  apiRouter.use(
    createBusinessesRouter({
      store: businessStore,
      checkChainActive:
        registryReader === null ? null : (wallet: string) => registryReader.isActive(wallet),
      world: {
        devWorldStub: env.DEV_WORLD_STUB,
        rpId: env.WORLD_APP_ID,
        expectedAction: env.WORLD_ACTION_ID,
      },
      ensRoot: env.ENS_ROOT_NAME,
    }),
  );
  apiRouter.use(
    createWorldRouter({
      devWorldStub: env.DEV_WORLD_STUB,
      rpId: env.WORLD_APP_ID,
      expectedAction: env.WORLD_ACTION_ID,
    }),
  );
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
}
