import { GauntletError } from "./errors.js"

/**
 * A counting semaphore with an explicit "slot freed" signal.
 *
 * Solari's docs are blunt about 429s: "A tight retry loop here burns quota
 * against a wall" — a concurrency limit only clears when somebody else's
 * session ends. So when a launch is refused for concurrency we release our slot
 * and wait to be *told* one is free, rather than polling the API.
 */
export class Semaphore {
  private available: number
  private readonly waiters: Array<() => void> = []

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("Semaphore capacity must be >= 1")
    this.available = capacity
  }

  get inUse(): number {
    return this.capacity - this.available
  }

  get queued(): number {
    return this.waiters.length
  }

  async acquire(signal?: AbortSignal): Promise<Release> {
    throwIfAborted(signal)
    if (this.available > 0) {
      this.available -= 1
      return this.makeRelease()
    }

    await new Promise<void>((resolve, reject) => {
      const onFree = () => {
        cleanup()
        resolve()
      }
      const onAbort = () => {
        const index = this.waiters.indexOf(onFree)
        if (index >= 0) this.waiters.splice(index, 1)
        cleanup()
        reject(abortError())
      }
      const cleanup = () => signal?.removeEventListener("abort", onAbort)
      signal?.addEventListener("abort", onAbort, { once: true })
      this.waiters.push(onFree)
    })

    this.available -= 1
    return this.makeRelease()
  }

  /** Run `fn` while holding a slot. The slot is always returned. */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private makeRelease(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      this.available += 1
      this.waiters.shift()?.()
    }
  }
}

export type Release = () => void

export function abortError(): GauntletError {
  return new GauntletError({ code: "cancelled", message: "The run was cancelled." })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/**
 * Race a promise against a deadline. The underlying work is NOT cancelled by
 * this alone — callers pass the same signal down so the work can abort itself.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout: () => GauntletError,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const abortParent = () => controller.abort()
  parent?.addEventListener("abort", abortParent, { once: true })

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(onTimeout())
    }, timeoutMs)
  })

  try {
    return await Promise.race([fn(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    parent?.removeEventListener("abort", abortParent)
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export interface RetryOptions {
  attempts: number
  baseDelayMs: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Only genuinely transient infrastructure failures should retry. */
  shouldRetry: (error: unknown, attempt: number) => boolean
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
}

/** Exponential backoff with full jitter, for INFRASTRUCTURE only (§17). */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const maxDelay = opts.maxDelayMs ?? 8_000
  let lastError: unknown

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    throwIfAborted(opts.signal)
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt === opts.attempts || !opts.shouldRetry(error, attempt)) throw error
      const backoff = Math.min(maxDelay, opts.baseDelayMs * 2 ** (attempt - 1))
      const delay = Math.round(backoff * (0.5 + Math.random() * 0.5))
      opts.onRetry?.(error, attempt, delay)
      await sleep(delay, opts.signal)
    }
  }

  throw lastError
}

/**
 * Run tasks with bounded concurrency, collecting every settled outcome.
 * A rejected task never aborts its siblings — a single bad run must not take
 * the suite down (§16).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index] as T, index) }
      } catch (reason) {
        results[index] = { status: "rejected", reason }
      }
    }
  })

  await Promise.all(workers)
  return results
}
