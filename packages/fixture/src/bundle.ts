import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourceDir = join(packageRoot, "src")

/**
 * Where the prebuilt bundle might be.
 *
 * `packageRoot` is derived from `import.meta.url`, which is only this package
 * when the module is loaded from its own directory. tsup inlines every
 * `@gauntlet/*` package into the worker binary, so at runtime this file lives
 * in `apps/worker/dist` and `packageRoot` is the worker — which has no `src`
 * to rebuild from. The build copies the bundle next to the binary for exactly
 * that case, so look beside us first.
 */
const bundleCandidates = [
  join(packageRoot, "dist", "gauntlet-shop.mjs"),
  join(dirname(fileURLToPath(import.meta.url)), "gauntlet-shop.mjs"),
]
const bundlePath = bundleCandidates[0]!

function findPrebuilt(): string | undefined {
  return bundleCandidates.find((candidate) => existsSync(candidate))
}

export interface FixtureBundle {
  /** The complete, dependency-free server as one ES module. */
  code: string
  /** Short content hash, so a stale upload into a long-lived sandbox is
   *  detectable instead of silently serving old markup. */
  hash: string
  bytes: number
}

let cached: FixtureBundle | undefined

/**
 * The Gauntlet Shop, packed into a single file for delivery into a sandbox.
 *
 * It must be one file because it is written over the sandbox control channel
 * with `files.write` — there is no npm install on the far side.
 *
 * Built on demand when the dist output is missing or older than the sources, so
 * `pnpm dev` needs no separate build step, and read straight from disk in a
 * built deployment.
 */
export async function getFixtureBundle(): Promise<FixtureBundle> {
  if (cached) return cached
  const prebuilt = findPrebuilt()
  if (prebuilt && !(await isStale(prebuilt))) {
    cached = describe(readFileSync(prebuilt, "utf8"))
    return cached
  }
  if (!existsSync(sourceDir)) {
    // A production image ships no sources, so there is nothing to rebuild
    // from. Say what is actually wrong instead of failing inside esbuild with
    // a path that means nothing to the reader.
    throw new Error(
      "The Gauntlet Shop bundle is missing from this deployment. It is built at image build " +
        `time and copied next to the binary; looked in:\n  ${bundleCandidates.join("\n  ")}`,
    )
  }
  cached = await buildFixtureBundle()
  return cached
}

export async function buildFixtureBundle(): Promise<FixtureBundle> {
  const { build } = await import("esbuild")
  const result = await build({
    entryPoints: [join(sourceDir, "standalone.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    write: false,
    minify: false,
    legalComments: "none",
    metafile: true,
    banner: { js: "// Gauntlet Shop — generated bundle. Do not edit." },
  })

  const external = Object.keys(result.metafile.inputs).filter((f) => f.includes("node_modules"))
  if (external.length > 0) {
    throw new Error(
      `the fixture bundle pulled in dependencies, which cannot be installed inside a sandbox:\n  ${external.join("\n  ")}`,
    )
  }

  const code = result.outputFiles[0]?.text
  if (!code) throw new Error("esbuild produced no output for the fixture bundle")

  await mkdir(dirname(bundlePath), { recursive: true })
  await writeFile(bundlePath, code, "utf8")
  return describe(code)
}

function describe(code: string): FixtureBundle {
  return {
    code,
    hash: createHash("sha256").update(code).digest("hex").slice(0, 16),
    bytes: Buffer.byteLength(code),
  }
}

/** Only meaningful where sources exist; a built deployment has none. */
async function isStale(builtBundle: string): Promise<boolean> {
  if (!existsSync(sourceDir)) return false
  try {
    const builtAt = statSync(builtBundle).mtimeMs
    const files = await readdir(sourceDir)
    return files
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .some((f) => statSync(join(sourceDir, f)).mtimeMs > builtAt)
  } catch {
    return true
  }
}
