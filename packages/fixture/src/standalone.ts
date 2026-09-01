/**
 * Entry point for the bundled fixture that runs inside a Solari sandbox.
 * Reads its port from argv or PORT and logs a single ready line the sandbox
 * manager waits for.
 */
import { startFixtureServer } from "./server.js"

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000)
const handle = await startFixtureServer({ port, host: "0.0.0.0" })
console.log(`GAUNTLET_SHOP_READY port=${handle.port}`)

const shutdown = () => {
  void handle.close().then(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
