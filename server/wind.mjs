// Design wind speed (round 7, item 6). The decision: a drafter looks each city's speed up once on the free ASCE
// Hazard Tool page and enters it in the jurisdiction row; until then the app says "set by the engineer of
// record" (McAllen requires a PE design under the 2024 IRC, Mission an engineered sealed windstorm plan), never
// a number from a third-party range. The ASCE Hazard API path is here but dormant: it runs only when
// ASCE_HAZARD_API_KEY is set, caches per parcel point, counts calls against 1,000 a month, and never logs the key.
const fail = (status, error) => Object.assign(new Error(error), { status })
const now = () => new Date().toISOString()
export const WIND_UNSET = 'set by the engineer of record'
export const ASCE_MONTHLY_CAP = 1000

export function makeWind({ store, env = process.env, fetchImpl = globalThis.fetch, log = console.log }) {
  const key = (env.ASCE_HAZARD_API_KEY || '').trim()
  return {
    enabled: !!key,
    /**
     * The wind speed for a point: the city's row when a drafter has set it, the ASCE API when the key is set,
     * else { mph: null, text: 'set by the engineer of record' }.
     */
    async lookup({ lat, lon, row = null }) {
      if (row?.wind?.value?.mph) return { mph: row.wind.value.mph, standard: row.wind.value.standard || '7-22', riskCategory: row.wind.value.riskCategory || 'II', source: row.wind.source || 'ASCE Hazard Tool (drafter lookup)', checkedAt: row.wind.checkedAt || null, status: row.wind.status || 'summary', text: `${row.wind.value.mph} mph (ASCE ${row.wind.value.standard || '7-22'}, risk category ${row.wind.value.riskCategory || 'II'})` }
      if (!key || lat == null || lon == null) return { mph: null, text: WIND_UNSET, source: null, status: 'unset' }
      const ck = `wind:${(+lat).toFixed(4)},${(+lon).toFixed(4)}`
      const cached = await store.meta.get(ck)
      if (cached) return { ...cached, cached: true }
      const month = now().slice(0, 7)
      const usedKey = `asce:usage:${month}`
      const used = +((await store.meta.get(usedKey)) || 0)
      if (used >= ASCE_MONTHLY_CAP) {
        log('wind: the ASCE monthly cap is reached; not queried')
        return { mph: null, text: WIND_UNSET, source: null, status: 'unset', capped: true }
      }
      const url = `https://api-hazard.asce.org/v1/wind?${new URLSearchParams({ lat: String(lat), lon: String(lon), standardsVersion: '7-22', riskLevel: '2', token: key })}`
      let res
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
      } catch (e) {
        throw fail(502, 'the ASCE hazard service did not answer') // the URL (with the token) is never logged
      }
      await store.meta.set(usedKey, used + 1)
      if (!res.ok) throw fail(502, `the ASCE hazard service answered ${res.status}`)
      const body = await res.json()
      const mph = body?.data?.wind?.speed ?? body?.wind?.speed ?? body?.speed ?? null
      const rec = { mph: mph != null ? Math.round(mph) : null, standard: '7-22', riskCategory: 'II', source: 'ASCE Hazard API (api-hazard.asce.org)', checkedAt: now(), status: mph != null ? 'verified' : 'unset', text: mph != null ? `${Math.round(mph)} mph (ASCE 7-22, risk category II)` : WIND_UNSET }
      await store.meta.set(ck, rec)
      return rec
    },
    describe: () => ({ ok: true, detail: key ? 'ASCE Hazard API on (capped at 1,000 calls a month)' : 'drafter lookup per city; the ASCE API is dormant (no ASCE_HAZARD_API_KEY)' }),
  }
}
