import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages ship as TypeScript source, so they must be compiled in.
  noExternal: [/^@gauntlet\//],
  // ...but the browser drivers and SDKs must NOT be. They carry native and
  // optional dependencies (`chromium-bidi`, platform esbuild binaries) that a
  // bundler cannot resolve statically, and they are ordinary runtime
  // dependencies at the far end anyway.
  // tsup externalises everything in `dependencies`, which is why this app
  // declares the workspace packages' runtime dependencies as its own. These are
  // listed again because bundling them is not merely suboptimal, it is broken:
  // the browser drivers carry native and optional dependencies esbuild cannot
  // resolve, and `yaml` is CJS that calls `require("process")` at load time.
  external: ["playwright", "playwright-core", "patchright-core", "yaml"],
})
