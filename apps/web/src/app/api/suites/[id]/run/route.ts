import { z } from "zod"
import {
  deriveSeed,
  GauntletError,
  parseSealingKey,
  sealSecret,
  validateCdpEndpoint,
} from "@gauntlet/core"
import {
  attachRunCredential,
  countActiveSuiteRuns,
  enqueueSuiteRun,
  getSuite,
  type SealedRunCredential,
} from "@gauntlet/db"
import { requirePerturbation } from "@gauntlet/perturbations"
import { apiError, notFound, ok, parseBody } from "@/lib/api"
import { checkRunAuthorization } from "@/lib/auth"
import { config, db } from "@/lib/server"

export const dynamic = "force-dynamic"

const runSchema = z.object({
  label: z.string().max(120).optional(),
  /**
   * A credential the visitor brings so the run spends THEIR credits.
   *
   * `byoSession` is a CDP endpoint for a browser they created — the least
   * authority that makes a run possible, and the option that never asks them
   * to hand over an account key. `byoKey` is a Solari API key, needed only for
   * a repository agent, which requires a sandbox of its own.
   */
  byoSession: z.string().min(1).max(2_000).optional(),
  byoKey: z.string().min(1).max(500).optional(),
  git: z
    .object({ repo: z.string().optional(), branch: z.string().optional(), sha: z.string().optional() })
    .optional(),
})

/**
 * Enqueue a gauntlet.
 *
 * This is the only endpoint that costs money, so it is explicitly a POST that a
 * human has to trigger — nothing here ever fires on page load (§35), and the UI
 * shows the exact browser-run count before the button is enabled.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = await parseBody(request, runSchema).catch(() => ({}) as z.infer<typeof runSchema>)

    const cfg = config()

    // Whose credits pay for this. A visitor who brings their own session or
    // key is spending their own money, so the operator's access code — which
    // exists only to protect the operator's balance — does not apply to them.
    const byo = await sealBorrowedCredential(body, cfg.GAUNTLET_CREDENTIAL_KEY)

    // Money is spent past this line. Everything above it — browsing the seeded
    // demo, inspecting a failure, comparing two runs — stays public.
    const auth = byo ? { authorized: true as const, reason: "byo" as const } : await checkRunAuthorization()
    if (!auth.authorized) {
      return ok(
        {
          error: {
            code: "unauthorized",
            title: "Real runs need an access code",
            message:
              "This deployment executes on Solari, and each run spends real credits. Enter the demo access code to start one.",
            hint: "The seeded demo results are fully browsable without it.",
          },
        },
        { status: 401 },
      )
    }

    const database = db()
    const suite = await getSuite(database, id)
    if (!suite) return notFound("Suite")

    // One suite at a time. Without this a visitor can queue faster than the
    // worker drains, and every queued run is a browser session somebody pays for.
    const active = await countActiveSuiteRuns(database)
    if (active > 0) {
      return ok(
        {
          error: {
            code: "busy",
            title: "A gauntlet is already running",
            message: "This deployment runs one suite at a time so it cannot outrun its Solari quota.",
            hint: "Wait for the current run to finish, then try again.",
          },
        },
        { status: 429 },
      )
    }

    // Repository agents clone and execute code we did not write. That is safe
    // because it happens inside a Solari Sandbox — but it still costs sandbox
    // credits, so it is never available anonymously.
    if (suite.agent.type === "repository" && auth.reason === "ungated" && cfg.runsAreGated) {
      return ok({ error: { code: "unauthorized", title: "Not permitted", message: "Repository agents require authorization.", hint: "" } }, { status: 401 })
    }
    // Both of the next two gates ask "can THIS deployment pay for a run?".
    // A visitor who brought a session or a key is not asking it to.
    if (!byo && cfg.resolvedMode === "solari" && !cfg.hasSolariCredentials) {
      throw new GauntletError({
        code: "config_invalid",
        message: "Real runs need a Solari API key. Add SOLARI_API_KEY to .env and restart.",
      })
    }
    // Local mode drives a real browser, and a production image ships none on
    // purpose: this service orchestrates runs, it never hosts one. Refusing
    // here beats enqueuing work the worker cannot possibly do.
    if (!byo && !cfg.canExecuteRuns) {
      throw new GauntletError({
        code: "config_invalid",
        message:
          "This deployment has no way to execute a run: there is no Solari key, and the " +
          "production image carries no browser by design. Add SOLARI_API_KEY to enable real runs.",
      })
    }

    const variants = suite.variants.map((v) => {
      const perturbation = requirePerturbation(v.perturbationType)
      return { id: perturbation.id, name: perturbation.name, category: perturbation.category }
    })

    const total = variants.length * suite.suite.runsPerVariant
    if (total > cfg.GAUNTLET_MAX_RUNS_PER_SUITE) {
      throw new GauntletError({
        code: "config_invalid",
        message: `This suite is ${total} browser runs, above the configured cap of ${cfg.GAUNTLET_MAX_RUNS_PER_SUITE}.`,
      })
    }

    const suiteRun = await enqueueSuiteRun(database, {
      suiteId: suite.suite.id,
      mode: byo ? "solari" : cfg.resolvedMode,
      ...(body.label ? { label: body.label } : {}),
      variants,
      runsPerVariant: suite.suite.runsPerVariant,
      // Seeds are derived once, here, and persisted — so re-reading a run later
      // reproduces exactly the environment it faced.
      seedFor: (variant, repetition) => deriveSeed(suite.suite.id, variant, repetition),
      ...(body.git ? { git: body.git } : {}),
    })

    // Attached after the row exists, and wiped by the worker the moment the
    // run finishes. It is sealed already; nothing here has the plaintext.
    if (byo) await attachRunCredential(database, suiteRun.id, byo)

    return ok(
      { id: suiteRun.id, totalRuns: total, mode: suiteRun.mode, status: suiteRun.status },
      { status: 202 },
    )
  } catch (error) {
    return apiError(error)
  }
}


/**
 * Seal what the visitor brought, or return undefined when they brought nothing.
 *
 * Two refusals here are deliberate. Without a sealing key the feature is simply
 * off — a borrowed secret never goes into the queue in plaintext. And a session
 * endpoint is validated against the same private-address rules as a repository
 * URL, because accepting one from a stranger is accepting an instruction to
 * connect somewhere.
 */
async function sealBorrowedCredential(
  body: { byoSession?: string; byoKey?: string },
  sealingKey: string | undefined,
): Promise<SealedRunCredential | undefined> {
  const raw = body.byoSession ?? body.byoKey
  if (!raw) return undefined

  const key = parseSealingKey(sealingKey)
  if (!key) {
    throw new GauntletError({
      code: "config_invalid",
      message: "This deployment cannot accept your own key or session.",
      detail: "GAUNTLET_CREDENTIAL_KEY is not configured, so a borrowed credential has nowhere safe to live.",
    })
  }

  if (body.byoSession) {
    return { kind: "session", ...sealSecret(validateCdpEndpoint(body.byoSession), key) }
  }
  const apiKey = body.byoKey!.trim()
  if (!apiKey.startsWith("slr_")) {
    throw new GauntletError({
      code: "config_invalid",
      message: "That does not look like a Solari API key.",
      detail: "Solari keys begin with slr_.",
    })
  }
  return { kind: "key", ...sealSecret(apiKey, key) }
}
