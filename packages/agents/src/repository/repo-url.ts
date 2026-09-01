import { GauntletError } from "@gauntlet/core"

/**
 * Repository URL validation.
 *
 * This is a security boundary, not a convenience check. The URL decides what
 * code gets cloned and executed, and although execution itself is confined to a
 * Solari Sandbox, a permissive parser still lets a caller reach network
 * locations they should not — a link-local metadata endpoint, a service on the
 * worker's own private network — through the sandbox's clone.
 *
 * The rule is an allowlist: https only, a public host, nothing else.
 */

const ALLOWED_PROTOCOLS = new Set(["https:"])

/** Hosts we accept without further thought. Anything else is scrutinised. */
const WELL_KNOWN_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "git.sr.ht",
])

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, incl. cloud instance metadata
  /^::1$/,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // unique-local IPv6
  /\.local$/i,
  /\.internal$/i,
]

export interface ValidatedRepository {
  url: string
  host: string
  /** True for hosts on the well-known list. */
  wellKnown: boolean
}

export function validateRepositoryUrl(input: string): ValidatedRepository {
  const raw = input.trim()
  if (!raw) {
    throw invalid("A repository URL is required.")
  }

  // Reject the shorthand forms before parsing: `git@host:org/repo` is not a URL
  // and `file://` / `ssh://` are not things we will ever fetch.
  if (/^[\w.-]+@[\w.-]+:/.test(raw)) {
    throw invalid("SCP-style git URLs are not supported. Use an https:// URL.")
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw invalid(`"${truncate(raw)}" is not a valid URL.`)
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw invalid(
      `Only https:// repository URLs are allowed. "${parsed.protocol}//" is not.`,
    )
  }

  // Credentials in the URL would be written into the sandbox's git config and
  // could land in a log. If a private repo needs auth, it goes through the
  // manifest's explicit token field, which is never persisted.
  if (parsed.username || parsed.password) {
    throw invalid("Do not put credentials in the repository URL.")
  }

  const host = parsed.hostname
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw invalid(`"${host}" is a local or private address and cannot be cloned.`)
  }
  if (!host.includes(".")) {
    throw invalid(`"${host}" does not look like a public hostname.`)
  }

  return {
    url: parsed.toString(),
    host,
    wellKnown: WELL_KNOWN_HOSTS.has(host.toLowerCase()),
  }
}

function invalid(message: string): GauntletError {
  return new GauntletError({ code: "repository_invalid", message })
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}...` : value
}
