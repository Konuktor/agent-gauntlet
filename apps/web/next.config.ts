import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source (no build step), so
  // Next compiles them itself.
  transpilePackages: [
    "@gauntlet/agents",
    "@gauntlet/config",
    "@gauntlet/core",
    "@gauntlet/db",
    "@gauntlet/evaluators",
    "@gauntlet/perturbations",
  ],
  serverExternalPackages: ["postgres", "@solarisdk/browser", "@solarisdk/sdk"],
  /**
   * Workspace packages are TypeScript source written in standards-compliant
   * ESM, so their relative imports carry `.js` specifiers that resolve to
   * `.ts` files. tsc, tsx, esbuild and Vitest all understand that; webpack does
   * not without being told. Rewriting the sources to drop the extensions would
   * make them non-portable to plain Node, so the resolver is taught instead.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    }
    return config
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
}

export default config
