/**
 * Test-only stand-in for the `zalo-bot-js` SDK.
 *
 * The real package only publishes a "require" export condition (CJS-only,
 * see package.json), so Vite's ESM-based SSR resolver used by Vitest
 * cannot `import()` it directly (fails with an export-conditions error).
 * Production code is unaffected — `tsc` compiles `src/**` to CommonJS and
 * `require()`s the real package fine (verified via `npm run build`).
 *
 * This stub is aliased in place of "zalo-bot-js" for tests only (see
 * vitest.config.mts `resolve.alias`), letting us exercise the real
 * `createZaloBot` wiring logic against a controllable fake.
 */
export interface StubBotOptions {
  token: string;
  onError?: (error: unknown, ctx: { kind?: string }) => void;
}

export class Bot {
  options: StubBotOptions;
  handlers = new Map<string, (...args: unknown[]) => unknown>();

  constructor(options: StubBotOptions) {
    this.options = options;
    Bot.instances.push(this);
  }

  on(event: string, handler: (...args: unknown[]) => unknown): void {
    this.handlers.set(event, handler);
  }

  /** Test hook: every constructed instance, in creation order. */
  static instances: Bot[] = [];

  static reset(): void {
    Bot.instances = [];
  }
}
