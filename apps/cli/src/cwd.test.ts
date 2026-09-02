import { afterEach, describe, expect, it } from "vitest"
import { resolve } from "node:path"
import { fromInvocationDir } from "./cwd.js"

const original = process.env.INIT_CWD

afterEach(() => {
  if (original === undefined) delete process.env.INIT_CWD
  else process.env.INIT_CWD = original
})

/**
 * `pnpm gauntlet run ./gauntlet.yaml` is the documented command and the one CI
 * runs, and it reaches this process with cwd set to `apps/cli` — so a relative
 * path has to be resolved against where the user actually stood.
 */
describe("fromInvocationDir", () => {
  it("resolves a relative path against the directory the command was typed in", () => {
    process.env.INIT_CWD = "/repo"
    expect(fromInvocationDir("./gauntlet.yaml")).toBe("/repo/gauntlet.yaml")
    expect(fromInvocationDir("reports/a.json")).toBe("/repo/reports/a.json")
  })

  it("leaves an absolute path alone", () => {
    process.env.INIT_CWD = "/repo"
    expect(fromInvocationDir("/tmp/x.yaml")).toBe("/tmp/x.yaml")
  })

  // A directly executed binary has no INIT_CWD and must keep behaving normally.
  it("falls back to the process directory when INIT_CWD is absent", () => {
    delete process.env.INIT_CWD
    expect(fromInvocationDir("x.yaml")).toBe(resolve(process.cwd(), "x.yaml"))
  })
})
