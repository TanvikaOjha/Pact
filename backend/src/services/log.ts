/**
 * Minimal shared logger seam. All process output goes through here so
 * `no-console` stays green and a real logger (pino/winston) can replace
 * these two functions without touching call sites.
 */
export const log = {
  info(message: string): void {
    process.stdout.write(`[info] ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`[error] ${message}\n`);
  },
};
