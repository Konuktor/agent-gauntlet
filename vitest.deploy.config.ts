import { defineConfig } from "vitest/config"

/**
 * Deployment-contract tests.
 *
 * They boot the REAL production artifacts — `apps/web/dist/server.js` and
 * `apps/worker/dist/index.js`, as two separate processes — the way Northflank
 * runs them, and assert the behaviours the platform depends on. They simulate
 * the platform locally rather than requiring it, so they run in ordinary CI.
 *
 *   pnpm build && pnpm test:deploy
 */
export default defineConfig({
  test: {
    include: ["deploy-tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: "forks",
    fileParallelism: false,
  },
})
