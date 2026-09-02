import { createInterface } from "node:readline/promises"
import pc from "picocolors"
import { GauntletError } from "@gauntlet/core"

/**
 * Create a Solari browser session and print its CDP endpoint.
 *
 * This exists so somebody can be tested by a hosted AgentGauntlet without
 * handing over an API key. The endpoint is a capability scoped to one browser
 * they own: they create it, they watch it, and closing this command ends it.
 *
 * The session stays open while this process runs, because the gauntlet needs
 * a live browser to drive. Ctrl+C — or Enter — releases it.
 */
export async function runSessionCommand(options: { json: boolean }): Promise<number> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) {
    throw new GauntletError({
      code: "config_invalid",
      message: "gauntlet session needs SOLARI_API_KEY.",
      detail: "This command creates a session on YOUR account, so the key stays on your machine.",
    })
  }

  const { Solari } = await import("@solarisdk/browser")
  const baseUrl = (process.env.SOLARI_BASE_URL ?? "https://api.getsolari.com").replace(/\/$/, "")
  const solari = new Solari({ apiKey, baseUrl })
  let released = false

  // Created directly against the API: the SDK wraps its endpoints through a
  // loopback proxy, and a loopback URL is useless to a hosted runner.
  const res = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ recording: false, stealth: false }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new GauntletError({
      code: "internal",
      message: `Solari refused to create a session (HTTP ${res.status}).`,
      detail: text.slice(0, 300),
    })
  }
  const data = JSON.parse(text) as { sessionId: string; wsEndpoint: string; cdpEndpoint?: string; expiresAt?: string }
  const cdp = data.cdpEndpoint ?? data.wsEndpoint.replace("/ws/", "/cdp/")

  const release = async () => {
    if (released) return
    released = true
    await solari.sessions.releaseAndWait(data.sessionId).catch(() => {})
    await solari.close().catch(() => {})
  }
  process.on("SIGINT", () => void release().then(() => process.exit(0)))

  if (options.json) {
    // Still a long-lived command: the endpoint is worthless the moment this
    // process releases the session, so a script pipes the line and keeps the
    // process alive until it is done.
    process.stdout.write(`${JSON.stringify({ cdpEndpoint: cdp, expiresAt: data.expiresAt })}\n`)
    await new Promise<void>((resolve) => {
      process.stdin.on("end", resolve)
      process.stdin.on("close", resolve)
      process.once("SIGTERM", resolve)
      process.stdin.resume()
    })
  } else {
    process.stdout.write(`
${pc.bold("Your session is open.")} Paste this into AgentGauntlet:

  ${pc.cyan(cdp)}

${pc.dim("It drives one browser on your account, and nothing else — no access to")}
${pc.dim("your other sessions, your profiles or your balance. Treat it as a secret")}
${pc.dim("while it lives: anyone holding it can drive that browser.")}

${pc.dim(`Expires ${data.expiresAt ?? "in about an hour"}.`)}

Press ${pc.bold("Enter")} to release it when the run has finished.
`)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    await rl.question("")
    rl.close()
  }

  await release()
  return 0
}
