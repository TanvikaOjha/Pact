import express from "express";
import { loadEnv } from "./config/env.js";
import { errorHandler, requestId } from "./middleware/http.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  loadEnv();
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(healthRouter);
  app.use(errorHandler);
  return app;
}
