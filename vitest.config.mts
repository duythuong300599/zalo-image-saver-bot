import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // zalo-bot-js only publishes a "require" export condition (CJS-only
      // SDK) — Vite's ESM-based SSR resolver can't `import()` it, so tests
      // use a local stub instead. Production build is unaffected (tsc
      // compiles to CommonJS and `require()`s the real package).
      "zalo-bot-js": path.resolve(import.meta.dirname, "tests/test-doubles/zalo-bot-js-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/scripts/**"],
    },
  },
});
