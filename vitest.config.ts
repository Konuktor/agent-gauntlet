import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Solari-credit-burning acceptance tests live behind their own config.
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.solari.test.ts", "e2e/**"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: "forks",
    // The integration tests share one Postgres and truncate it between cases,
    // so two files running at once wipe each other's rows. Serialising files
    // costs ~12s and removes a whole class of flake.
    fileParallelism: false,
  },
})
