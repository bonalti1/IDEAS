// Alert email through Resend (plain HTTPS, no SDK). Needs RESEND_API_KEY, ALERT_EMAIL_TO,
// ALERT_EMAIL_FROM (an address on a domain verified in Resend). Without them alerts only
// show in the dashboard activity and in the health check.
export function makeAlerts({ env = process.env, store, event, log = console.log }) {
  const apiKey = (env.RESEND_API_KEY || '').trim()
  const to = (env.ALERT_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean)
  const from = (env.ALERT_EMAIL_FROM || '').trim()
  const configured = !!(apiKey && to.length && from)
  const OFFLINE_MIN = +(env.WORKER_ALERT_MIN || 10)
  const sent = [] // last few, for health

  async function email(subject, text) {
    if (!configured) {
      log(`alert (email not configured): ${subject}`)
      return { ok: false, detail: 'email not configured' }
    }
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
        signal: AbortSignal.timeout(15000),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || `HTTP ${r.status}`)
      sent.unshift({ at: new Date().toISOString(), subject })
      sent.length = Math.min(sent.length, 10)
      return { ok: true, id: body.id }
    } catch (e) {
      log(`alert email failed: ${e.message}`)
      return { ok: false, detail: e.message }
    }
  }

  // Every minute: a worker silent for more than OFFLINE_MIN minutes gets one email, and one
  // more when it is back. The flag lives on the worker record so a restart does not resend.
  async function checkWorkers(nowMs = Date.now()) {
    const workers = await store.workers.list()
    for (const w of workers) {
      const silentMin = (nowMs - Date.parse(w.lastSeen)) / 60000
      if (silentMin > OFFLINE_MIN && !w.offlineAlertAt) {
        w.offlineAlertAt = new Date(nowMs).toISOString()
        await store.workers.put(w)
        const msg = `${w.name || w.id} has not reported for ${Math.round(silentMin)} minutes`
        await event('alert', msg, { worker: w.id })
        await email(`Draft House: ${w.name || w.id} is offline`, `${msg}.\n\nLast seen ${w.lastSeen}${w.host ? ` on ${w.host}` : ''}.\nJobs wait in the queue until it is back. Check that the office computer is awake and the worker task is running.`)
      } else if (silentMin <= OFFLINE_MIN && w.offlineAlertAt) {
        const downMin = Math.round((nowMs - Date.parse(w.offlineAlertAt)) / 60000) + OFFLINE_MIN
        delete w.offlineAlertAt
        await store.workers.put(w)
        await event('worker', `${w.name || w.id} is back after about ${downMin} minutes`, { worker: w.id })
        await email(`Draft House: ${w.name || w.id} is back online`, `${w.name || w.id} reported again after about ${downMin} minutes offline.`)
      }
    }
  }

  let timer = null
  return {
    configured,
    email,
    checkWorkers,
    start() {
      timer = setInterval(() => checkWorkers().catch((e) => log(`alert check failed: ${e.message}`)), 60000)
      timer.unref?.()
    },
    stop() {
      clearInterval(timer)
    },
    describe: () => ({ ok: configured, detail: configured ? `email to ${to.join(', ')}; worker offline after ${OFFLINE_MIN} min${sent[0] ? `; last sent ${sent[0].at.slice(0, 16)} "${sent[0].subject}"` : ''}` : 'no email: set RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM (alerts show in activity only)' }),
  }
}
