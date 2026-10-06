import fs from "node:fs";

import { createZaloBot } from "./bot/zalo-bot-client-factory";
import { loadConfig } from "./config/env-config-loader";
import { createExpressApp } from "./http/create-express-app";
import { createInFlightTaskTracker } from "./http/in-flight-task-tracker";
import { createImageStorage } from "./storage/image-download-and-save-service";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();

  await fs.promises.mkdir(config.saveDir, { recursive: true });
  try {
    await fs.promises.access(config.saveDir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `SAVE_DIR is not writable: ${config.saveDir} (check bind-mount ownership, e.g. chown 1000:1000)`,
    );
  }

  const storage = createImageStorage({ saveDir: config.saveDir });
  const bot = createZaloBot(config, storage);

  // Validates the token against the Zalo API at startup. Only warns (never
  // exits) on failure, so a transient Zalo outage doesn't crash-loop the container.
  try {
    await bot.initialize();
  } catch (error) {
    console.warn(
      "[server] bot.initialize() failed — continuing to listen anyway",
      error instanceof Error ? error.message : error,
    );
  }

  const inFlightTracker = createInFlightTaskTracker();
  const app = createExpressApp({ bot, webhookSecret: config.webhookSecret, inFlightTracker });
  const server = app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}, shutting down`);

    const forceExitTimer = setTimeout(() => {
      console.error("[server] shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    server.close(() => {
      // The webhook route responds before the photo download finishes (see
      // create-express-app.ts), so server.close() alone wouldn't wait for
      // it — that race is exactly what truncated a file during this
      // feature's own manual testing. forceExitTimer above still bounds
      // the total wait if a download were ever stuck.
      void inFlightTracker.waitForIdle().then(() => {
        bot
          .shutdown()
          .catch((error: unknown) => console.error("[server] bot.shutdown() failed", error))
          .finally(() => {
            clearTimeout(forceExitTimer);
            process.exit(0);
          });
      });
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error("[server] unhandledRejection", reason);
  });
}

main().catch((error: unknown) => {
  console.error("[server] fatal startup error", error instanceof Error ? error.message : error);
  process.exit(1);
});
