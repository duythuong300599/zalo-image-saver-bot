import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import { createExpressApp } from "../../src/http/create-express-app";
import type { WebhookBot } from "../../src/bot/zalo-bot-client-factory";

const SECRET = "test-webhook-secret-16";
const HEADER = "X-Bot-Api-Secret-Token";

function buildApp(bot: WebhookBot) {
  return createExpressApp({ bot, webhookSecret: SECRET });
}

describe("createExpressApp", () => {
  it("GET /health returns 200 ok", async () => {
    const app = buildApp({ processUpdate: vi.fn().mockResolvedValue(undefined) });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /webhook without the secret header returns 401 and does not call processUpdate", async () => {
    const processUpdate = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({ processUpdate });
    const res = await request(app).post("/webhook").send({ hello: "world" });
    expect(res.status).toBe(401);
    expect(processUpdate).not.toHaveBeenCalled();
  });

  it("POST /webhook with a wrong secret returns 401", async () => {
    const app = buildApp({ processUpdate: vi.fn() });
    const res = await request(app)
      .post("/webhook")
      .set(HEADER, "wrong-secret")
      .send({ hello: "world" });
    expect(res.status).toBe(401);
  });

  it("POST /webhook with a wrong-length secret returns 401 without throwing", async () => {
    const app = buildApp({ processUpdate: vi.fn() });
    const res = await request(app).post("/webhook").set(HEADER, "x").send({});
    expect(res.status).toBe(401);
  });

  it("POST /webhook with the correct secret returns 200 and forwards the body to processUpdate", async () => {
    const processUpdate = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({ processUpdate });
    const payload = { ok: true, result: { message: { message_id: "m1" } } };

    const res = await request(app).post("/webhook").set(HEADER, SECRET).send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(processUpdate).toHaveBeenCalledWith(payload);
  });

  it("still returns 200 when processUpdate rejects, without an unhandled rejection", async () => {
    const processUpdate = vi.fn().mockRejectedValue(new Error("boom"));
    const app = buildApp({ processUpdate });

    const res = await request(app).post("/webhook").set(HEADER, SECRET).send({});

    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 on malformed JSON body", async () => {
    const app = buildApp({ processUpdate: vi.fn() });
    const res = await request(app)
      .post("/webhook")
      .set(HEADER, SECRET)
      .set("Content-Type", "application/json")
      .send("{not-json");
    expect(res.status).toBe(400);
  });
});
