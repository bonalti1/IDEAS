// Office-only printables (round 9, item 1): the "Meeting prep" sheet with the estimate. This module is the only
// client code that imports the rates, and only the drafter screens import it, lazily, so the homeowner bundle
// never carries RATES, a $/sf line or a price pair.
import { estimateLines } from './pricing.js'
import { summaryPageWith } from './plan-svg.js'
import { summaryDocWith } from './pdf.js'

const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
/** The three strings the summary layouts print for the office: heading, the big number, the rate line. */
export function moneyBlock(price) {
  if (!price) return null
  const parts = ['living', 'garage', 'porches'].filter((x) => price.parts?.[x] && price.areas?.[x]).map((x) => `${x} $${Math.round(price.parts[x][0]).toLocaleString()}–${Math.round(price.parts[x][1]).toLocaleString()}`)
  const extra = estimateLines(price).map((l) => `${l.label}: ${l.text}`)
  return {
    heading: price.confirmed ? 'Price range (office)' : 'Estimate (office)',
    big: price.needsCounty ? 'county not set' : `${k(price.low)}–${k(price.high)}`,
    line: `$${price.perSf[0]}–${price.perSf[1]}/sf living · ${price.county || 'county not set'}. ${parts.join(' · ')}${extra.length ? ' · ' + extra.join(' · ') : ''}. ${price.note}${price.confirmed ? '' : ' Rates to be confirmed by South Texas Builders.'}`,
  }
}
/** The office's printable "Meeting prep" page: the client summary layout with the estimate block, marked internal. */
export function meetingPrepHTML(design, price, audit, trust, titleBlock = {}) {
  return summaryPageWith(design, audit, trust, titleBlock, moneyBlock(price))
}
/** The same as a PDF. Never offered to a homeowner. */
export async function meetingPrepPDF(design, price, audit, trust, info = {}) {
  return summaryDocWith(design, audit, trust, info, moneyBlock(price))
}
