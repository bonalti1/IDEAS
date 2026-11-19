// "Rules used for this lot" (round 7, item 9): every number the plan was drafted to, with where it came from and
// how sure we are. Homeowners see the plain version; drafters see every field, the flags, the parcel ids and the
// raw rule objects. The same rows go into the summary PDF and design.json.
import { statusWords } from './lib/jurisdictions.js'

const PLAIN = ['front', 'side', 'rear', 'streetSide', 'garageFt', 'maxCoverage', 'maxHeightFt', 'minLotSf', 'district', 'irc', 'windstorm', 'wind']
const chipClass = (u) => (u.status === 'verified' ? (u.stale ? 'warn' : 'good') : u.status === 'summary' ? 'warn' : 'bad')

export function floodLine(flood) {
  if (!flood) return null
  if (flood.status === 'no-digital-firm') return 'No digital FEMA flood map covers this spot; the county floodplain administrator decides. The office asks before the slab height is set.'
  if (flood.status === 'no-address') return flood.note
  if (flood.sfha) return `FEMA zone ${flood.zone}: special flood hazard area${flood.bfe != null ? `, base flood elevation ${flood.bfe} ft` : ''}.${flood.lomr ? ' A Letter of Map Revision applies here.' : ''}`
  if (flood.status === 'shaded-x') return 'FEMA zone X (shaded): the 0.2% annual-chance flood area.'
  if (flood.zone) return `FEMA zone ${flood.zone}: outside the 1% annual-chance flood area.${flood.lomr ? ' A Letter of Map Revision applies here.' : ''}${flood.prelim ? ' A preliminary map change is in progress.' : ''}`
  return 'A digital FEMA map covers the area but no zone polygon sits on this point; the drafter reads the panel.'
}

export default function RulesPanel({ lot, mode = 'homeowner', open = false, title = 'Rules used for this lot', onLookupOwner = null, owner = null }) {
  if (!lot || !lot.rules) return null
  const used = lot.rulesUsed || []
  const rows = mode === 'drafter' ? used : used.filter((u) => PLAIN.includes(u.id))
  const flags = lot.flags || []
  const j = lot.jurisdiction
  const where = j ? `${j.name}${j.type === 'county' ? ' (county rules)' : ''}` : lot.cityName
  const fl = floodLine(lot.flood)
  return (
    <details className="rules-panel card thin" open={open} data-testid="rules-panel">
      <summary>
        <span>{title}</span>
        <span className="muted small"> · {where}</span>
        {lot.flags?.length ? <span className="pill warn small">{lot.flags.length} to confirm</span> : null}
      </summary>
      <p className="fine">
        {where}
        {lot.zoning?.district ? ` · zoned ${lot.zoning.district}${lot.zoning.residential === false ? ` (${lot.zoning.use})` : ''}` : lot.zoning?.status === 'unknown' ? ' · zoning: the drafter reads the city map' : ''}
        {lot.parcel?.legal ? ` · ${lot.parcel.legal}` : ''}. {mode === 'drafter' ? 'Every line below says where it came from and when it was checked. "Unknown" means the ordinance was not read: confirm with the city before the permit set.' : 'Where each number came from and how sure we are. A drafter confirms every line before anything is built.'}
      </p>
      <table className="tbl rules-used">
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className={u.status}>
              <td>{u.label || u.id}</td>
              <td>{u.value}</td>
              <td>
                <span className={'pill ' + chipClass(u)}>{statusWords(u)}</span>
                {mode === 'drafter' && (u.source || u.checkedAt) ? (
                  <div className="muted small">
                    {u.source}
                    {u.checkedAt ? ` · ${u.checkedAt}` : ''}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
          {fl && (
            <tr>
              <td>Flood zone</td>
              <td colSpan={2}>
                {fl}
                {mode === 'drafter' && lot.flood?.source ? <div className="muted small">{lot.flood.source}</div> : null}
              </td>
            </tr>
          )}
          {lot.zoning && (
            <tr className={lot.zoning.residential === false ? 'bad' : ''}>
              <td>Zoning</td>
              <td colSpan={2}>
                {lot.zoning.status === 'found' ? `${lot.zoning.district} (${lot.zoning.use})` : lot.zoning.status === 'none' ? 'no district polygon at this point; the drafter reads the map' : lot.zoning.reason || 'unknown'}
                {mode === 'drafter' && lot.zoning.layer ? <div className="muted small">{lot.zoning.layer}</div> : null}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {(lot.ruleNotes || []).length > 0 && (
        <ul className="list small">
          {lot.ruleNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {flags.length > 0 && (
        <ul className="list small flags">
          {flags.map((f) => (
            <li key={f} className="warn">
              {f}
            </li>
          ))}
        </ul>
      )}
      {mode === 'drafter' && lot.parcel && (
        <p className="fine">
          Parcel {lot.parcel.propId || '?'}
          {lot.parcel.geoId ? ` · geo id ${lot.parcel.geoId}` : ''}
          {lot.parcel.source?.name ? ` · ${lot.parcel.source.name}` : ''}
          {lot.parcel.fetchedAt ? ` · fetched ${String(lot.parcel.fetchedAt).slice(0, 10)}` : ''}
          {lot.parcel.matchedBy ? ` · matched by ${lot.parcel.matchedBy}` : ''}. Advisory: the recorded plat or a survey wins.
          {onLookupOwner && !owner ? (
            <>
              {' '}
              <button className="linkish" onClick={onLookupOwner}>
                Look up the owner of record
              </button>
            </>
          ) : null}
          {owner ? ` Owner of record: ${owner.owner || 'not given'}${owner.mailing ? `, ${owner.mailing}` : ''}.` : ''}
        </p>
      )}
      {mode !== 'drafter' && <p className="fine">Setbacks, coverage and height come from the city or county table; the flood zone from FEMA; the zoning from the city map. The permit set is drawn by a drafter and sealed where the city requires it.</p>}
    </details>
  )
}
