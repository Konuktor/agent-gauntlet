import { NextResponse } from "next/server"
import { z } from "zod"
import { ERROR_COPY, GauntletError, type ErrorCode } from "@gauntlet/core"

export interface ApiErrorBody {
  error: {
    code: string
    title: string
    message: string
    hint: string
    /** Technical detail, shown only behind a disclosure in the UI. */
    detail?: string
  }
}

/**
 * Turn any failure into the shape the UI's error component expects.
 *
 * §45: a user never sees "HTTP 402" or a stack trace. They see what happened and
 * what to do about it, with the technical detail available but folded away.
 */
export function apiError(error: unknown, status = 500): NextResponse<ApiErrorBody> {
  if (error instanceof GauntletError) {
    const copy = ERROR_COPY[error.code]
    return NextResponse.json(
      {
        error: {
          code: error.code,
          title: copy.title,
          message: error.message,
          hint: copy.hint,
          ...(error.detail ? { detail: error.detail } : {}),
        },
      },
      { status: statusFor(error.code, status) },
    )
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          title: "That request was not valid",
          message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
          hint: "Check the highlighted fields and try again.",
        },
      },
      { status: 400 },
    )
  }

  return NextResponse.json(
    {
      error: {
        code: "internal",
        title: ERROR_COPY.internal.title,
        message: "The server hit an unexpected problem.",
        hint: ERROR_COPY.internal.hint,
        ...(error instanceof Error ? { detail: error.message } : {}),
      },
    },
    { status },
  )
}

function statusFor(code: ErrorCode, fallback: number): number {
  switch (code) {
    case "config_invalid":
    case "repository_invalid":
    case "repository_manifest_invalid":
      return 400
    case "solari_auth":
      return 401
    case "solari_plan":
      return 402
    case "solari_concurrency":
      return 429
    case "solari_capacity":
    case "solari_unavailable":
      return 503
    default:
      return fallback
  }
}

export function notFound(what: string): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      error: {
        code: "not_found",
        title: `${what} not found`,
        message: `No ${what.toLowerCase()} with that id exists.`,
        hint: "It may have been deleted, or the link may be stale.",
      },
    },
    { status: 404 },
  )
}

/** Parse a JSON body against a schema, with a readable failure. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new GauntletError({ code: "config_invalid", message: "Expected a JSON body." })
  }
  return schema.parse(raw)
}

export function ok<T>(value: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(value, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } })
}
