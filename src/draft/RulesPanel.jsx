// "Rules used for this lot" (round 7, item 9): every number the plan was drafted to, with where it came from and
// how sure we are. Homeowners see the plain version; drafters see every field, the flags, the parcel ids and the
// raw rule objects. The same rows go into the summary PDF and design.json.
import { statusWords } from './lib/jurisdictions.js'
import { plainReason, homeLabel } from './lib/plain.js'
import { useLang, EN, placeName, ruleValue, ruleNote, phrase } from './lib/i18n.js'

const PLAIN = ['front', 'side', 'rear', 'streetSide', 'garageFt', 'maxCoverage', 'maxHeightFt', 'minLotSf', 'district', 'irc', 'windstorm', 'wind']
const chipClass = (u) => (u.status === 'verified' ? (u.stale ? 'warn' : 'good') : u.status === 'summary' ? 'warn' : 'bad')

export function floodLine(flood, words = EN) {
  if (!flood) return null
  const { t, say } = words
  if (flood.status === 'no-digital-firm') return t('No digital FEMA flood map covers this spot; the county floodplain administrator decides. The office asks before the slab height is set.')
  if (flood.status === 'no-address') return say(flood.note)
  if (flood.sfha) return `${t('FEMA zone {zone}: special flood hazard area', { zone: flood.zone })}${flood.bfe != null ? `, ${t('base flood elevation {ft} ft', { ft: flood.bfe })}` : ''}.${flood.lomr ? ` ${t('A Letter of Map Revision applies here.')}` : ''}`
  if (flood.status === 'shaded-x') return t('FEMA zone X (shaded): the 0.2% annual-chance flood area.')
  if (flood.zone) return `${t('FEMA zone {zone}: outside the 1% annual-chance flood area.', { zone: flood.zone })}${flood.lomr ? ` ${t('A Letter of Map Revision applies here.')}` : ''}${flood.prelim ? ` ${t('A preliminary map change is in progress.')}` : ''}`
  return t('A digital FEMA map covers the area but no zone polygon sits on this point; the drafter reads the panel.')
}

export default function RulesPanel({ lot, mode = 'homeowner', open = false, title = phrase('Rules used for this lot'), onLookupOwner = null, owner = null }) {
  const words = useLang()
  const { lang, t, say } = words
  if (!lot || !lot.rules) return null
  const used = lot.rulesUsed || []
  const rows = mode === 'drafter' ? used : used.filter((u) => PLAIN.includes(u.id))
  const flags = lot.flags || []
  const j = lot.jurisdiction
  const where = j ? (j.type === 'county' ? t('{name} (county rules)', { name: placeName(j.name, lang) }) : j.name) : lot.cityName
  const fl = floodLine(lot.flood, words)
  return (
    <details className="rules-panel card thin" open={open} data-testid="rules-panel">
      <summary>
        <span>{t(title)}</span>
        <span className="muted small"> · {where}</span>
        {lot.flags?.length ? <span className="pill warn small">{t('{n} to confirm', { n: lot.flags.length })}</span> : null}
      </summary>
      <p className="fine">
        {where}
        {lot.zoning?.district ? ` · ${t('zoned {district}', { district: lot.zoning.district })}${lot.zoning.residential === false ? ` (${say(lot.zoning.use)})` : ''}` : lot.zoning?.status === 'unknown' ? ` · ${t('zoning: the drafter reads the city map')}` : ''}
        {lot.parcel?.legal ? ` · ${lot.parcel.legal}` : ''}. {mode === 'drafter' ? 'Every line below says where it came from and when it was checked. "Unknown" means the ordinance was not read: confirm with the city before the permit set.' : t('Where each number came from and how sure we are. A drafter confirms every line before anything is built.')}
      </p>
      <table className="tbl rules-used">
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className={u.status}>
              <td>{mode !== 'drafter' ? t(homeLabel(u.id, u.label)) : u.label || u.id}</td>
              <td>{mode !== 'drafter' && typeof u.value === 'string' ? ruleValue(plainReason(u.value), lang) : u.value}</td>
              <td>
                <span className={'pill ' + chipClass(u)}>{t(statusWords(u))}</span>
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
              <td>{t('Flood zone')}</td>
              <td colSpan={2}>
                {fl}
                {mode === 'drafter' && lot.flood?.source ? <div className="muted small">{lot.flood.source}</div> : null}
              </td>
            </tr>
          )}
          {lot.zoning && (
            <tr className={lot.zoning.residential === false ? 'bad' : ''}>
              <td>{t('Zoning')}</td>
              <td colSpan={2}>
                {lot.zoning.status === 'found' ? `${lot.zoning.district} (${say(lot.zoning.use)})` : lot.zoning.status === 'none' ? t('no district polygon at this point; the drafter reads the map') : say(lot.zoning.reason) || t('unknown')}
                {mode === 'drafter' && lot.zoning.layer ? <div className="muted small">{lot.zoning.layer}</div> : null}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {(lot.ruleNotes || []).length > 0 && (
        <ul className="list small">
          {lot.ruleNotes.map((n) => (
            <li key={n}>{mode !== 'drafter' ? ruleNote(plainReason(n), lang) : n}</li>
          ))}
        </ul>
      )}
      {flags.length > 0 && (
        <ul className="list small flags">
          {flags.map((f) => (
            <li key={f} className="warn">
              {mode !== 'drafter' ? ruleNote(plainReason(f), lang) : f}
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
      {mode !== 'drafter' && <p className="fine">{t('The open space along each edge, how much of the lot a house may cover and how tall it may be come from the city or county table; the flood zone from FEMA; the zoning from the city map. The permit set is drawn by a drafter and sealed where the city requires it.')}</p>}
    </details>
  )
}
