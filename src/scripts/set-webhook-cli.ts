import { Bot } from "zalo-bot-js";

/**
 * Standalone CLI, not wired through server.ts config — run via
 * `npm run set-webhook -- [url] [--info|--delete]`.
 */
async function main(): Promise<void> {
  const botToken = process.env.BOT_TOKEN?.trim();
  if (!botToken) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }

  const bot = new Bot({ token: botToken as string });
  const args = process.argv.slice(2);

  if (args.includes("--info")) {
    const info = await bot.getWebhookInfo();
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (args.includes("--delete")) {
    const deleted = await bot.deleteWebhook();
    console.log(`Webhook deleted: ${deleted}`);
    return;
  }

  const url = args.find((a) => !a.startsWith("--")) ?? process.env.WEBHOOK_URL?.trim();
  const webhookSecret = process.env.WEBHOOK_SECRET?.trim();
  if (!url) {
    console.error("Usage: set-webhook <url> (or set WEBHOOK_URL env var)");
    process.exit(1);
  }
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET is required");
    process.exit(1);
  }

  const result = await bot.setWebhook(url as string, webhookSecret as string);
  console.log("url:", url);
  console.log("verification.ok:", result?.verification?.ok);
  console.log("verification.hint:", result?.verification?.hint);
}

main().catch((error: unknown) => {
  console.error("[set-webhook-cli] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
