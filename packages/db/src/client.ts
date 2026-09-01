import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema.js"

export type Database = PostgresJsDatabase<typeof schema>

export interface DbHandle {
  db: Database
  sql: postgres.Sql
  close(): Promise<void>
}

let shared: DbHandle | undefined

export interface CreateDbOptions {
  url?: string
  /** Long-lived processes (the worker) want a small pool; serverless route
   *  handlers want one connection and no idle sockets. */
  max?: number
  idleTimeoutSeconds?: number
}

export function createDb(options: CreateDbOptions = {}): DbHandle {
  const url = options.url ?? process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.")

  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    // Dates come back as Date objects; JSON as parsed values.
    transform: undefined,
    onnotice: () => {},
  })

  const db = drizzle(sql, { schema })
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 })
    },
  }
}

/** Process-wide handle. Next.js route handlers and the worker share one pool. */
export function getDb(): DbHandle {
  shared ??= createDb()
  return shared
}

export async function closeDb(): Promise<void> {
  if (!shared) return
  const handle = shared
  shared = undefined
  await handle.close()
}
