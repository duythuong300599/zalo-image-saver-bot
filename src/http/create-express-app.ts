import express, { type Express, type NextFunction, type Request, type Response } from "express";

import type { WebhookBot } from "../bot/zalo-bot-client-factory";
import type { InFlightTaskTracker } from "./in-flight-task-tracker";
import { createWebhookSecretTokenMiddleware } from "./webhook-secret-token-middleware";

export interface CreateExpressAppDeps {
  bot: WebhookBot;
  webhookSecret: string;
  inFlightTracker: InFlightTaskTracker;
}

/**
 * Responds 200 immediately after the secret check, then hands the body to
 * `processUpdate` without awaiting it. Awaiting first would hold the
 * response open for the full download+reply cycle (can take seconds),
 * risking a Zalo-side timeout/retry that would duplicate the saved file.
 */
export function createExpressApp(deps: CreateExpressAppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(
    "/webhook",
    express.json({ limit: "1mb" }),
    createWebhookSecretTokenMiddleware(deps.webhookSecret),
    (req: Request, res: Response) => {
      res.status(200).json({ ok: true });
      void deps.inFlightTracker.track(deps.bot.processUpdate(req.body)).catch((error: unknown) => {
        console.error(
          "[webhook] processUpdate failed",
          error instanceof Error ? error.message : error,
        );
      });
    },
  );

  // Express 5 error handlers still need 4 params to be recognized as such.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && err.status === 400) {
      res.status(400).json({ ok: false, error: "Invalid JSON body" });
      return;
    }
    console.error("[express] unhandled error", err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false });
  });

  return app;
}
