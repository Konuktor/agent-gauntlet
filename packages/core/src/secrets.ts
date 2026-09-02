import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto"
import { GauntletError } from "./errors.js"

/**
 * Envelope encryption for a credential that belongs to somebody else.
 *
 * A visitor may bring their own Solari session or API key so their runs spend
 * their credits rather than the operator's. Either one is a live capability —
 * a CDP endpoint drives a real browser, and an API key can create sessions,
 * read saved profiles and spend money — and the queue between the web service
 * and the worker is a Postgres table. Putting a borrowed credential there in
 * plaintext would mean the operator quietly becomes the custodian of other
 * people's secrets, in a database, indefinitely.
 *
 * So it is sealed on the way in, opened once in the worker, and the row is
 * wiped the moment the run reaches a terminal state.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly rather
 * than decrypting to nonsense.
 */
export interface SealedSecret {
  ciphertext: string
  iv: string
  tag: string
}

const ALGORITHM = "aes-256-gcm"
const KEY_BYTES = 32

export function parseSealingKey(raw: string | undefined): Buffer | undefined {
  if (!raw) return undefined
  const key = Buffer.from(raw, "base64")
  if (key.length !== KEY_BYTES) {
    throw new GauntletError({
      code: "config_invalid",
      message: `GAUNTLET_CREDENTIAL_KEY must be ${KEY_BYTES} base64-encoded bytes; got ${key.length}.`,
      detail:
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    })
  }
  return key
}

export function sealSecret(plaintext: string, key: Buffer): SealedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  }
}

export function openSecret(sealed: SealedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"))
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"))
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch (cause) {
    // Authentication failed: the ciphertext or the key is wrong. Never fall
    // back to returning something — a corrupted credential must not be used.
    throw new GauntletError({
      code: "internal",
      message: "A stored credential could not be opened.",
      cause,
    })
  }
}

/**
 * Whether a CDP endpoint is one we may accept from a stranger.
 *
 * The same reasoning as the repository-URL allowlist: a loopback or private
 * address would make this service fetch something inside its own network on a
 * visitor's behalf.
 */
export function validateCdpEndpoint(input: string): string {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new GauntletError({
      code: "config_invalid",
      message: "That does not look like a CDP endpoint URL.",
      detail: "It should start with wss:// and come from `gauntlet session`.",
    })
  }
  if (url.protocol !== "wss:") {
    throw new GauntletError({
      code: "config_invalid",
      message: "A CDP endpoint must use wss://.",
      detail: "ws:// would send a credential in the clear.",
    })
  }
  const host = url.hostname.toLowerCase()
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "::1"
  if (isPrivate) {
    throw new GauntletError({
      code: "config_invalid",
      message: "That endpoint points inside a private network.",
      detail: "A hosted run cannot reach your machine; use a Solari session endpoint.",
    })
  }
  return trimmed
}

/** Constant-time equality for two secrets of the same shape. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
