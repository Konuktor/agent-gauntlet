import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const bundlePath = join(packageRoot, "dist", "gauntlet-shop.mjs")
const sourceDir = join(packageRoot, "src")

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
  if (existsSync(bundlePath) && !(await isStale())) {
    cached = describe(readFileSync(bundlePath, "utf8"))
    return cached
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

async function isStale(): Promise<boolean> {
  try {
    const builtAt = statSync(bundlePath).mtimeMs
    const files = await readdir(sourceDir)
    return files
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .some((f) => statSync(join(sourceDir, f)).mtimeMs > builtAt)
  } catch {
    return true
  }
}
