import { isAbsolute, resolve } from "node:path"

/**
 * Resolve a user-supplied path against the directory they actually typed it in.
 *
 * `pnpm gauntlet run ./gauntlet.yaml` reaches this process through
 * `pnpm --filter @gauntlet/cli`, which runs the script with its cwd set to
 * `apps/cli`. A relative path would then resolve against the package rather
 * than the repository root, so the documented command could never find the file
 * it names — and neither could the CI step built on it.
 *
 * npm and pnpm both export INIT_CWD for exactly this: the directory the command
 * was invoked from. Falling back to `process.cwd()` keeps a directly executed
 * binary (`node dist/index.js`) behaving normally.
 */
export function fromInvocationDir(path: string): string {
  if (isAbsolute(path)) return path
  return resolve(process.env.INIT_CWD ?? process.cwd(), path)
}
