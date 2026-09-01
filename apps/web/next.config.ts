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
    "@gauntlet/solari",
  ],
  serverExternalPackages: ["postgres", "@solarisdk/browser", "@solarisdk/sdk"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
}

export default config
