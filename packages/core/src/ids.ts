import { randomUUID } from "node:crypto"

export function newId(): string {
  return randomUUID()
}

/** Short, readable, URL-safe id for display (e.g. "run_4f2a9c"). */
export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 6)
}
