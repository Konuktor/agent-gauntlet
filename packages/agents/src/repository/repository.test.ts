import { describe, expect, it } from "vitest"
import { parseAgentClaim, parseManifest } from "./manifest.js"
import { validateRepositoryUrl } from "./repo-url.js"

describe("validateRepositoryUrl", () => {
  it("accepts public https repositories", () => {
    expect(validateRepositoryUrl("https://github.com/acme/agent.git")).toMatchObject({
      host: "github.com",
      wellKnown: true,
    })
    expect(validateRepositoryUrl("https://git.example.com/team/agent")).toMatchObject({
      host: "git.example.com",
      wellKnown: false,
    })
  })

  // These are the reason this function exists. Even though execution is
  // confined to a sandbox, the clone itself is a network request we initiate.
  it("rejects non-https schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "http://github.com/acme/agent",
      "ssh://git@github.com/acme/agent",
      "git://github.com/acme/agent",
      "javascript:alert(1)",
    ]) {
      expect(() => validateRepositoryUrl(url), url).toThrow()
    }
  })

  it("rejects SCP-style git URLs with a specific message", () => {
    expect(() => validateRepositoryUrl("git@github.com:acme/agent.git")).toThrow(/SCP-style/)
  })

  it("rejects local and private-network hosts", () => {
    for (const host of [
      "https://localhost/repo",
      "https://127.0.0.1/repo",
      "https://10.0.0.5/repo",
      "https://192.168.1.10/repo",
      "https://172.16.4.1/repo",
      "https://[::1]/repo",
      "https://build.local/repo",
      "https://vault.internal/repo",
    ]) {
      expect(() => validateRepositoryUrl(host), host).toThrow(/local or private|public hostname/)
    }
  })

  // 169.254.169.254 is the cloud instance-metadata address. A clone that
  // reaches it is an SSRF, sandbox or no sandbox.
  it("rejects the link-local metadata range", () => {
    expect(() => validateRepositoryUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /local or private/,
    )
  })

  it("rejects credentials embedded in the URL", () => {
    expect(() => validateRepositoryUrl("https://user:token@github.com/acme/agent")).toThrow(
      /credentials/,
    )
  })

  it("rejects empty and malformed input", () => {
    expect(() => validateRepositoryUrl("")).toThrow(/required/)
    expect(() => validateRepositoryUrl("   ")).toThrow(/required/)
    expect(() => validateRepositoryUrl("not a url")).toThrow(/not a valid URL/)
  })
})

describe("parseManifest", () => {
  const valid = `
version: 1
install:
  command: npm
  args: ["ci"]
run:
  command: node
  args: ["agent.mjs"]
timeoutMs: 90000
`

  it("parses a complete manifest and applies defaults", () => {
    const manifest = parseManifest(valid)
    expect(manifest.run).toEqual({ command: "node", args: ["agent.mjs"] })
    expect(manifest.install).toEqual({ command: "npm", args: ["ci"] })
    expect(manifest.timeoutMs).toBe(90_000)
    expect(manifest.installTimeoutMs).toBe(300_000)
    expect(manifest.env).toEqual({})
  })

  it("allows a manifest with no install step", () => {
    expect(parseManifest("version: 1\nrun:\n  command: python3\n  args: [agent.py]").install).toBeUndefined()
  })

  it("requires a run command", () => {
    expect(() => parseManifest("version: 1")).toThrow(/missing or malformed/)
  })

  it("rejects an unknown manifest version", () => {
    expect(() => parseManifest("version: 2\nrun:\n  command: node")).toThrow(/missing or malformed/)
  })

  it("rejects invalid YAML with a readable message", () => {
    expect(() => parseManifest("version: 1\n  bad: [unclosed")).toThrow(/not valid YAML/)
  })

  it("caps timeouts at the product limits", () => {
    expect(() => parseManifest("version: 1\nrun:\n  command: node\ntimeoutMs: 999999999")).toThrow(
      /missing or malformed/,
    )
  })
})

describe("parseAgentClaim", () => {
  // Everything here is recorded as a claim. Nothing here decides a verdict.
  it("extracts the structured result line", () => {
    expect(
      parseAgentClaim('starting\nAGENT_GAUNTLET_RESULT={"status":"completed","message":"done","steps":9}\n'),
    ).toEqual({ status: "completed", message: "done", steps: 9 })
  })

  it("takes the last result line when several are printed", () => {
    const out = [
      'AGENT_GAUNTLET_RESULT={"status":"failed"}',
      'AGENT_GAUNTLET_RESULT={"status":"completed"}',
    ].join("\n")
    expect(parseAgentClaim(out)?.status).toBe("completed")
  })

  it("tolerates leading whitespace", () => {
    expect(parseAgentClaim('   AGENT_GAUNTLET_RESULT={"status":"gave_up"}')?.status).toBe("gave_up")
  })

  it("returns null when the agent said nothing structured", () => {
    expect(parseAgentClaim("just some logs\n")).toBeNull()
    expect(parseAgentClaim("")).toBeNull()
  })

  it("returns null rather than throwing on malformed or hostile payloads", () => {
    expect(parseAgentClaim("AGENT_GAUNTLET_RESULT={not json}")).toBeNull()
    expect(parseAgentClaim('AGENT_GAUNTLET_RESULT={"status":"transcended"}')).toBeNull()
    expect(parseAgentClaim(`AGENT_GAUNTLET_RESULT={"status":"completed","message":"${"x".repeat(5000)}"}`)).toBeNull()
  })
})
