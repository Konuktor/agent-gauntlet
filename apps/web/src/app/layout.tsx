import type { Metadata } from "next"
import Link from "next/link"
import { Swords } from "lucide-react"
import "@/styles/globals.css"
import { clientCapabilities } from "@/lib/server"
import { ModeBadge } from "@/components/primitives"

// The layout reads runtime config to render the mode badge, so prerendering it
// would require a live DATABASE_URL at build time — which broke the Render
// build on `/_not-found`, the one route Next makes static on its own. Every
// real page here is already force-dynamic; this is a dashboard over a
// database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "AgentGauntlet — crash-test your browser agent",
  description:
    "Run the same task across changing browsers, states, networks and UI conditions. Measure what survives.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const capabilities = clientCapabilities()

  return (
    <html lang="en">
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--color-raised)] focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-plane)_88%,transparent)] backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 overflow-hidden px-4 sm:gap-4 sm:px-5">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Swords size={17} style={{ color: "var(--color-accent)" }} aria-hidden />
              AgentGauntlet
            </Link>
            <nav aria-label="Main" className="ml-4 flex items-center gap-1 text-sm">
              <Link className="btn btn-ghost" href="/runs">
                Runs
              </Link>
              <Link className="btn btn-ghost" href="/suites/new">
                New suite
              </Link>
            </nav>
            <div className="ml-auto flex min-w-0 shrink items-center gap-2">
              {/* Which mode a NEW run would execute in. Never hidden. */}
              <ModeBadge mode={capabilities.mode} />
              {!capabilities.hasSolari ? (
                <span className="hidden text-xs text-[var(--color-ink-3)] sm:inline">
                  no SOLARI_API_KEY — real runs disabled
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1400px] px-5 py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-[1400px] px-5 pb-10 pt-4 text-xs text-[var(--color-ink-3)]">
          Intended for agents and applications you own or are authorised to automate. The bundled
          demo runs entirely against its own synthetic storefront.
        </footer>
      </body>
    </html>
  )
}
