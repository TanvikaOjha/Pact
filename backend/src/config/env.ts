import { z } from "zod";
import dotenv from "dotenv";

import { log } from "../services/log.js";

dotenv.config();

const envSchema = z.object({
  SEPOLIA_RPC_URL: z.string().url().or(z.string().min(1)),
  DEPLOYER_PRIVATE_KEY: z.string().optional(),
  PACT_ETH_OWNER_PRIVATE_KEY: z.string().optional(),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  WORLD_APP_ID: z.string().optional(),
  WORLD_ACTION_ID: z.string().optional(),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY required"),
  RESEND_API_KEY: z.string().optional(),
  USDC_SEPOLIA_ADDRESS: z.string().optional(),
  PACT_REGISTRY_ADDRESS: z.string().optional(),
  PACT_ESCROW_ADDRESS: z.string().optional(),
  PORT: z.coerce.number().default(4000),
  DEV_WORLD_STUB: z.coerce.boolean().default(true),
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
