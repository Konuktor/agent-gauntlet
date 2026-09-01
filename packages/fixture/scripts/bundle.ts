import { buildFixtureBundle } from "../src/bundle.js"

const bundle = await buildFixtureBundle()
console.log(`bundled ${(bundle.bytes / 1024).toFixed(1)} KB  sha256:${bundle.hash}`)
