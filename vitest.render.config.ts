import { defineConfig } from "vitest/config"

/**
 * Deployment-contract tests.
 *
 * They boot the REAL production artifact (`apps/web/dist/server.js`) the way
 * Render does — dynamic `PORT`, `GAUNTLET_DEPLOY_MODE=single`, migrations at
 * startup — and assert the behaviours the platform depends on. They simulate
 * Render locally rather than requiring it, so they run in ordinary CI.
 *
 *   pnpm build && pnpm test:render
 */
export default defineConfig({
  test: {
    include: ["**/*.render.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: "forks",
    fileParallelism: false,
  },
})
