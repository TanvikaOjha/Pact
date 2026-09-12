import { z } from "zod";
import dotenv from "dotenv";

import { log } from "../services/log.js";

dotenv.config();

/** Strict "true"/"false" flag parsing. Never use z.coerce.boolean() for flags:
// Boolean("false") === true, so ALLOW_X=false would silently enable X. */
function envFlag(defaultValue: boolean) {
  return z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true");
}

const envSchema = z.object({
  SEPOLIA_RPC_URL: z.string().url().or(z.string().min(1)),
  DEPLOYER_PRIVATE_KEY: z.string().optional(),
  PACT_ETH_OWNER_PRIVATE_KEY: z.string().optional(),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  PRIVY_JWT_VERIFICATION_KEY: z.string().optional(),
  WORLD_APP_ID: z.string().optional(),
  WORLD_ACTION_ID: z.string().optional(),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY required"),
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_FROM_EMAIL: z.string().min(1).default("Pact <onboarding@resend.dev>"),
  USDC_SEPOLIA_ADDRESS: z.string().optional(),
  PACT_REGISTRY_ADDRESS: z.string().optional(),
  PACT_ESCROW_ADDRESS: z.string().optional(),
  // pact-hack.eth is what's actually registered on Sepolia (see src/ens audit);
  // switch to pact.eth only after it is registered + verified on-chain.
  ENS_ROOT_NAME: z.string().min(1).default("pact-hack.eth"),
  PORT: z.coerce.number().default(4000),
  DEV_WORLD_STUB: envFlag(true),
  ALLOW_DEV_AUTH: envFlag(false),
  // Milestone amounts are whole USDC dollars; at or above this, acceptance
  // requires a bound World Selfie Check session (spec Q1 default $5,000).
  WORLD_HIGH_VALUE_THRESHOLD: z.coerce.number().positive().default(5000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    log.error(`Invalid env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}
