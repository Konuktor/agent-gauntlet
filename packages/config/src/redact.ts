/**
 * Solari's WebSocket endpoints carry an HMAC-signed composite session id in the
 * path and are checked with no Authorization header — the docs are explicit:
 * "The URL is the credential ... anyone holding the URL can drive the browser."
 *
 * So they are secrets. They are never persisted and never rendered, and this
 * scrubber is the last line of defence for anything that reaches a log.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/\bslr_live_[A-Za-z0-9_-]+/g, "slr_live_[redacted]"],
  [/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[redacted]"],
  [/\bsk-[A-Za-z0-9]{20,}/g, "sk-[redacted]"],
  // Solari browser control endpoints: wss://host/ws/<id>, /cdp/<id>, /control/<id>
  [/\bwss?:\/\/[^\s"']*\/(?:ws|cdp|control)\/[^\s"']+/gi, "[redacted-session-endpoint]"],
  // Presigned artifact URLs (replays, file up/downloads).
  [/([?&](?:X-Amz-Signature|token|sig|signature)=)[^&\s"']+/gi, "$1[redacted]"],
  [/\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi, "postgres://[redacted]@"],
]

export function redactSecrets(input: string): string {
  let out = input
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/** Deep-redact an arbitrary value for logging. Cycles become "[circular]". */
export function redactValue<T>(value: T, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactSecrets(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value as object)) return "[circular]"
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : redactValue(v, seen)
  }
  return out
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "password",
  "secret",
  "token",
  "cdpendpoint",
  "wsendpoint",
  "controlurl",
  "streamurl",
  "solari_api_key",
  "anthropic_api_key",
  "openai_api_key",
  "database_url",
])
