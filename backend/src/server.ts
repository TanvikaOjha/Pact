import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { log } from "./services/log.js";

const env = loadEnv();
const app = createApp();

app.listen(env.PORT, () => {
  log.info(`pact-backend listening on :${env.PORT}`);
});
