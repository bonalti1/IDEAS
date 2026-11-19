// What the live acceptance test does when FEMA's flood service fails for an address (round 11, item 4; round 12,
// item 6). An outage (a reset, a timeout, a 5xx) is a skipped flood check with a note: the product answers 502 with
// a plain line and caches nothing, which is right. But the test must not go green with FEMA gone for good: an
// answer that says the service or a layer is not there (a 404, a bad layer) fails at once, and so do skips on more
// than half the addresses.
import { FEMA_DOWN } from '../server/lots.mjs'

/** 'skip' for an outage; throws for anything else (FEMA gone, or an error that is not FEMA's at all). */
export function floodFailure(e, address) {
  if (e?.message !== FEMA_DOWN) throw e
  if (e.why === 'gone') throw new Error(`${address}: FEMA answered, but not with data (${e.detail}). Its service has moved or a layer is gone; this is not an outage, and no flood zone is being read at all`)
  return 'skip'
}

/** After the run: more than half the addresses skipped is not a bad minute. */
export function checkFloodSkips(skipped, total) {
  if (skipped > total / 2) throw new Error(`FEMA did not answer for ${skipped} of ${total} addresses: more than half. That is not a bad minute; check hazards.fema.gov and the layer numbers in server/lots.mjs`)
  return skipped ? `FEMA did not answer for ${skipped} of ${total} addresses: the flood check was skipped for those (a FEMA outage, not a failure here)` : null
}
