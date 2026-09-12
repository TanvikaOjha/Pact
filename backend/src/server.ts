import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { getSupabase } from "./config/supabase.js";
import { createSupabaseBusinessStore } from "./repos/businesses.js";
import {
  createSupabaseEngagementStore,
  createSupabaseMilestoneStore,
} from "./repos/engagements.js";
import { createSupabaseProposalStore } from "./repos/proposals.js";
import { buildCronJobs, startCron } from "./services/cron.js";
import { log } from "./services/log.js";
import { createNotifier } from "./services/notifications.js";

const env = loadEnv();
const app = createApp();

if (env.CRON_ENABLED) {
  const supabase = getSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  startCron(
    buildCronJobs({
      milestones: createSupabaseMilestoneStore(supabase),
      engagements: createSupabaseEngagementStore(supabase),
      businesses: createSupabaseBusinessStore(supabase),
      proposals: createSupabaseProposalStore(supabase),
      notify: createNotifier(env.RESEND_API_KEY, env.NOTIFY_FROM_EMAIL),
    }),
  );
  log.info("cron loop started");
}

app.listen(env.PORT, () => {
  log.info(`pact-backend listening on :${env.PORT}`);
});
