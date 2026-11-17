// The dependencies the shipped app carries (`npm audit --omit=dev`) have no high or critical advisories.
// Runs `npm audit` against the registry; skipped when the registry cannot be reached.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('npm audit --omit=dev: no high or critical advisories in the shipped dependencies', (t) => {
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', timeout: 120000 })
  let report
  try {
    report = JSON.parse(r.stdout || '{}')
  } catch {
    report = null
  }
  if (!report || (report.error && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|audit endpoint/i.test(JSON.stringify(report.error)))) {
    t.skip('the npm registry cannot be reached')
    return
  }
  const counts = report.metadata?.vulnerabilities || {}
  const bad = Object.entries(report.vulnerabilities || {}).filter(([, v]) => ['high', 'critical'].includes(v.severity)).map(([name, v]) => `${name} (${v.severity})`)
  assert.deepEqual(bad, [], `high or critical advisories: ${bad.join(', ')}`)
  assert.equal((counts.high || 0) + (counts.critical || 0), 0, JSON.stringify(counts))
})
