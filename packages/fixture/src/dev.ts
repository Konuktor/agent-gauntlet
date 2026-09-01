import { startFixtureServer } from "./server.js"

const port = Number(process.env.FIXTURE_PORT ?? 4310)
const handle = await startFixtureServer({ port })
console.log(`Gauntlet Shop listening on http://127.0.0.1:${handle.port}`)
console.log(`  store  http://127.0.0.1:${handle.port}/?run=dev`)
console.log(`  state  http://127.0.0.1:${handle.port}/__gauntlet/state?run=dev`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handle.close().then(() => process.exit(0))
  })
}
