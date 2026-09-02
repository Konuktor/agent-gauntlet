import { describe, expect, it } from "vitest"
import { BORROWED_SESSION_ID, displaySessionId } from "./run.js"

/**
 * Solari's composite session id is the authorizing component of that session's
 * WebSocket URL — prefix it with the public base and you hold the capability.
 * It must be stored, because asynchronous replay retrieval needs the real value
 * minutes after a run ends, but it must never reach an API response.
 *
 * This was found on the live deployment: every real run's `sessionId` was being
 * served verbatim by `/api/suite-runs/:id`, signature and internal hostname
 * included, while the project's own SECURITY.md claimed no column held one.
 */
describe("displaySessionId", () => {
  // The exact shape observed in production, with a synthetic signature.
  const composite =
    "ip-10-0-10-96:e6220cda-6d86-467f-956a-cf35b42799c6:cmtiq0lo101ge:1788349933653.EXAMPLESIGNATURE"

  it("drops the signature, the internal hostname and the rest of the composite", () => {
    const shown = displaySessionId(composite)!
    expect(shown).not.toContain("EXAMPLESIGNATURE")
    expect(shown).not.toContain("ip-10-0-10-96")
    expect(shown).not.toContain(":")
    expect(shown).not.toContain(".")
  })

  it("still identifies the run it came from", () => {
    expect(displaySessionId(composite)).toBe("e6220cda-6d8")
    // Two sessions must not collapse to the same label.
    const other = composite.replace("e6220cda", "aaaaaaaa")
    expect(displaySessionId(other)).not.toBe(displaySessionId(composite))
  })

  // The UI branches on this marker to explain why a borrowed run has no replay.
  it("passes the borrowed marker through untouched", () => {
    expect(displaySessionId(BORROWED_SESSION_ID)).toBe(BORROWED_SESSION_ID)
  })

  it("has nothing to say about a local run", () => {
    expect(displaySessionId(null)).toBeNull()
    expect(displaySessionId(undefined)).toBeNull()
    expect(displaySessionId("")).toBeNull()
  })
})
