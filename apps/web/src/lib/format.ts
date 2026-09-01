/** Formatting helpers shared by every view, so a number reads the same way
 *  wherever it appears. */

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—"
  return `${(value * 100).toFixed(digits)}%`
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—"
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const delta = Date.now() - new Date(value).getTime()
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 7)
}

/** "4 / 5" — always shown beside a percentage so a small sample is obvious. */
export function fraction(passed: number, total: number): string {
  return `${passed} / ${total}`
}
