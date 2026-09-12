import express, { Router } from "express";
import { loadEnv } from "./config/env.js";
import { getSupabase } from "./config/supabase.js";
import { getRegistryReader } from "./chain/registry.js";
import { getEscrowReader } from "./chain/escrow.js";
import { errorHandler, requestId } from "./middleware/http.js";
import { createRequireAuth, createPrivyVerifier, createRequireCronOrAuth, getPrivyClient } from "./middleware/privyAuth.js";
import { createIndexerArchive } from "./services/indexer.js";
import { createSupabaseBusinessStore } from "./repos/businesses.js";
import { createSupabaseDisputeVoteStore } from "./repos/disputes.js";
import { createSupabaseReputationStore } from "./repos/reputation.js";
import { createSupabaseEngagementStore, createSupabaseMilestoneStore } from "./repos/engagements.js";
import { createSupabaseProposalStore } from "./repos/proposals.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { createBusinessesRouter } from "./routes/businesses.js";
import { createDisputesRouter } from "./routes/disputes.js";
import { createEngagementsRouter } from "./routes/engagements.js";
import { createReputationRouter } from "./routes/reputation.js";
import { createProposalsRouter } from "./routes/proposals.js";
import { createSchedulerRouter } from "./routes/scheduler.js";
import { createWorldRouter } from "./routes/world.js";
import { startPactCompletedWatcher } from "./services/indexer.js";
import { log } from "./services/log.js";
import { createNotifier } from "./services/notifications.js";

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
  const requireAuth = createRequireAuth({
    allowDevAuth: env.ALLOW_DEV_AUTH,
    verifier: privyClient === null ? null : createPrivyVerifier(privyClient),
  });
  // Machine callers (external cron, keepers) use a service secret; humans
  // keep Privy Bearer auth. Either passes the scheduler surface below.
  const requireCronOrAuth = createRequireCronOrAuth({
    cronSecret: env.CRON_SECRET,
    requireAuth,
  });
  const indexerArchive = createIndexerArchive();
  const notify = createNotifier(env.RESEND_API_KEY, env.NOTIFY_FROM_EMAIL);
  apiRouter.use(requireAuth);
  apiRouter.use(meRouter);
  const businessStore = createSupabaseBusinessStore(
    getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
  );
  const registryReader = getRegistryReader(env.SEPOLIA_RPC_URL, env.PACT_REGISTRY_ADDRESS);
  const escrowReader = getEscrowReader(env.SEPOLIA_RPC_URL, env.PACT_ESCROW_ADDRESS);
  app.use(
    "/api",
    createProposalsRouter({
      store: createSupabaseProposalStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      businesses: businessStore,
      engagements: createSupabaseEngagementStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      milestones: createSupabaseMilestoneStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      ensRoot: env.ENS_ROOT_NAME,
      requireAuth,
      notify,
    }),
  );
  apiRouter.use(
    createEngagementsRouter({
      engagements: createSupabaseEngagementStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      milestones: createSupabaseMilestoneStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      businesses: businessStore,
      votes: createSupabaseDisputeVoteStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      reputation: createSupabaseReputationStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      notify,
      highValueThreshold: env.WORLD_HIGH_VALUE_THRESHOLD,
      world: {
        devWorldStub: env.DEV_WORLD_STUB,
        rpId: env.WORLD_APP_ID,
        expectedAction: env.WORLD_ACTION_ID,
      },
      checkReleased:
        escrowReader === null
          ? null
          : (onChainId: string, index: number) => escrowReader.isReleased(onChainId, index),
    }),
  );
  // Scheduler sits outside apiRouter on purpose: apiRouter enforces Privy
  // user auth, while the sweep also accepts the CRON_SECRET service token
  // for external cron. Detect+notify by default; wire requestAutoRelease
  // here when a session-signer submission path exists.
  app.use(
    "/api",
    createSchedulerRouter({
      milestones: createSupabaseMilestoneStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      engagements: createSupabaseEngagementStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      businesses: businessStore,
      notify,
      archive: indexerArchive,
      auth: requireCronOrAuth,
    }),
  );
  apiRouter.use(
    createDisputesRouter({
      engagements: createSupabaseEngagementStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      milestones: createSupabaseMilestoneStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      businesses: businessStore,
      votes: createSupabaseDisputeVoteStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      reputation: createSupabaseReputationStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
      notify,
      checkDisputed:
        escrowReader === null
          ? null
          : (onChainId: string, index: number) => escrowReader.isDisputed(onChainId, index),
    }),
  );
  app.use(
    "/api",
    createReputationRouter({
      businesses: businessStore,
      reputation: createSupabaseReputationStore(
        getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      ),
    }),
  );
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
  const watcher = startPactCompletedWatcher({
    rpcUrl: env.SEPOLIA_RPC_URL,
    escrowAddress: env.PACT_ESCROW_ADDRESS ?? "",
    businesses: businessStore,
    reputation: createSupabaseReputationStore(
      getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
    ),
    archive: indexerArchive,
  });
  if (watcher !== null) {
    log.info("pact completed indexer watching");
  }
  app.use(errorHandler);
  return app;
}
