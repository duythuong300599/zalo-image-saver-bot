import crypto from "node:crypto";
import type { RequestHandler } from "express";

const SECRET_HEADER = "x-bot-api-secret-token";

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch — guard first, and the
  // length check itself is not secret-dependent so it leaks nothing.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Rejects any request whose secret header is missing or doesn't match, before it reaches the bot. */
export function createWebhookSecretTokenMiddleware(expectedSecret: string): RequestHandler {
  return (req, res, next) => {
    const provided = req.get(SECRET_HEADER);
    if (!provided || !timingSafeEquals(provided, expectedSecret)) {
      console.warn("[webhook-secret] rejected request", { ip: req.ip });
      res.status(401).json({ ok: false });
      return;
    }
    next();
  };
}
