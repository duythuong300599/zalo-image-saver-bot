import path from "node:path";

export interface AppConfig {
  botToken: string;
  webhookSecret: string;
  saveDir: string;
  port: number;
}

const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 256;
const DEFAULT_PORT = 3000;

/**
 * Fail-fast loader: throws a single Error listing every missing/invalid
 * variable so operators fix the .env in one pass instead of one error at a time.
 * Never includes secret values in the thrown message.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];

  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) problems.push("BOT_TOKEN is required");

  const webhookSecret = env.WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    problems.push("WEBHOOK_SECRET is required");
  } else if (
    webhookSecret.length < MIN_SECRET_LENGTH ||
    webhookSecret.length > MAX_SECRET_LENGTH
  ) {
    problems.push(
      `WEBHOOK_SECRET must be ${MIN_SECRET_LENGTH}-${MAX_SECRET_LENGTH} characters`,
    );
  }

  const saveDirRaw = env.SAVE_DIR?.trim();
  if (!saveDirRaw) problems.push("SAVE_DIR is required");

  let port = DEFAULT_PORT;
  if (env.PORT !== undefined && env.PORT.trim() !== "") {
    const parsed = Number(env.PORT);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      problems.push("PORT must be an integer between 1 and 65535");
    } else {
      port = parsed;
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join("\n- ")}`);
  }

  return {
    botToken: botToken as string,
    webhookSecret: webhookSecret as string,
    saveDir: path.resolve(saveDirRaw as string),
    port,
  };
}
