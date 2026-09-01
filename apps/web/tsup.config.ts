import { defineConfig } from "tsup"

/**
 * Bundles the custom server (`server.ts`) that hosts Next plus, in single
 * deploy mode, the worker runtime.
 *
 * `next` itself and the browser/SDK drivers stay external — Next must resolve
 * its own build output at runtime, and the drivers carry native optional
 * dependencies a bundler cannot follow.
 */
export default defineConfig({
  entry: ["server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@gauntlet\//],
  external: [
    "next",
    "react",
    "react-dom",
    "playwright",
    "playwright-core",
    "patchright-core",
    "yaml",
    "esbuild",
  ],
})
