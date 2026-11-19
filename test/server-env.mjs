// Round 10, item 2: every test that starts the office API starts it on the recorded fixtures, so a test run never
// depends on (or loads) the Census, the county, FEMA, TIGERweb or a city server. LIVE=1 turns that off on purpose.
// Importing this file also turns the network guard on for the test process itself: a fetch to a real host throws.
import { guardNetwork } from '../server/fixtures.mjs'

export const LIVE = process.env.LIVE === '1'
guardNetwork()

/** Spread into the env of every spawned server, right after ...process.env. */
export const fixtureEnv = LIVE ? {} : { DRAFTHOUSE_FIXTURES: '1' }
