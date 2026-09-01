import { defineConfig } from "vitest/config"

/**
 * Real-credential acceptance tests. Never part of `pnpm test` or CI:
 * every run here spends actual Solari credits.
 *   SOLARI_E2E=1 SOLARI_API_KEY=slr_live_... pnpm test:solari
 */
export default defineConfig({
  test: {
    include: ["**/*.solari.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 300_000,
    pool: "forks",
    fileParallelism: false,
  },
})
