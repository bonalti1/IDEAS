import { useState } from 'react'
import { Button, Stat, Mark, money, sf } from '../ui.jsx'
import { kitFor } from '../lib/layout.js'
import { takeoff } from '../lib/takeoff.js'

const n = (x) => Math.round(x).toLocaleString()
const pct = (a, b) => (b ? `${a - b >= 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '')

export default function Send({ lot, style, program, rooms, history, onRestart, onBack }) {
  const [sent, setSent] = useState(false)
  const [tab, setTab] = useState('summary')
  const kit = kitFor(style)
  const t = takeoff(rooms, program, kit)
  const changes = history.filter((m) => m.who === 'you')
  const ref = kit.reference
  const isRef = ref && JSON.stringify(ref.program) === JSON.stringify(program) && changes.length === 0
  const estimate = t.areas.living * style.psf + program.garage * 28000

  if (sent)
    return (
      <div className="screen padded narrow center">
        <Mark size={56} />
        <h2>Sent to the drafting team</h2>
        <p className="lede">We have your lot, your layout, and every change you made. A drafter will have the first set to you within 5 business days.</p>
        <div className="card stats">
          <Stat k="What happens next" v="Structure, roof, details, and code check" />
          <Stat k="You will get" v={`${kit.sheets.length} sheets: ${kit.sheets.map((s) => s.title).filter((v, i, a) => a.indexOf(v) === i).join(', ').toLowerCase()}`} />
          <Stat k="Changes after this" v="Through your drafter, at drafting rates" />
        </div>
        <Button ghost onClick={onRestart}>
          Start another house
        </Button>
      </div>
    )

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>Ready to hand off?</h2>
        <p className="muted">Your design locks when you send it. Our drafters take it from here.</p>
      </div>
      <div className="tabs">
        {[
          ['summary', 'Summary'],
          ['package', 'Drafter package'],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <>
          <div className="card stats">
            <Stat k="Lot" v={lot?.address} />
            <Stat k="Style" v={style.name} />
            <Stat k="Program" v={`${program.beds} bed · ${program.baths}${program.halfBath ? '.5' : ''} bath · ${program.garage ? program.garage + '-car · ' : ''}${program.stories} story`} />
            <Stat k="Living area" v={sf(t.areas.living)} />
            <Stat k="Porches" v={sf(t.areas.frontPorch + t.areas.rearPorch)} />
            <Stat k="Rough estimate" v={money(estimate)} />
          </div>
          <div className="card">
            <h3>Your changes</h3>
            {changes.length === 0 ? (
              <p className="muted">None. You kept the first draft.</p>
            ) : (
              <ol className="list">
                {changes.map((c, i) => (
                  <li key={i}>{c.text}</li>
                ))}
              </ol>
            )}
            <p className="fine">Drafters see this list with the model, so nothing you asked for gets lost.</p>
          </div>
        </>
      )}

      {tab === 'package' && (
        <>
          <div className="card">
            <h3>Building area</h3>
            <table className="tbl">
              <tbody>
                <tr><td>Living area</td><td>{n(t.areas.living)} sf</td>{isRef && <td className="cmp">set: {n(ref.livingSf)} · {pct(t.areas.living, ref.livingSf)}</td>}</tr>
                <tr><td>Front porch</td><td>{n(t.areas.frontPorch)} sf</td>{isRef && <td className="cmp">set: {ref.frontPorchSf}</td>}</tr>
                <tr><td>Rear porch</td><td>{n(t.areas.rearPorch)} sf</td>{isRef && <td className="cmp">set: {ref.rearPorchSf}</td>}</tr>
                {t.areas.garage > 0 && <tr><td>Garage</td><td>{n(t.areas.garage)} sf</td></tr>}
                <tr className="total"><td>Total</td><td>{n(t.areas.total)} sf</td>{isRef && <td className="cmp">set: {n(ref.totalSf)} · {pct(t.areas.total, ref.totalSf)}</td>}</tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Material takeoff</h3>
            <table className="tbl">
              <tbody>
                <tr><td>{kit.exterior.siding}</td><td>{n(t.sidingSf)} sf</td>{isRef && <td className="cmp">set: {n(ref.takeoff.boardBattenSf)} · {pct(t.sidingSf, ref.takeoff.boardBattenSf)}</td>}</tr>
                <tr><td>Stone veneer</td><td>{n(t.stoneSf)} sf</td>{isRef && <td className="cmp">set: {n(ref.takeoff.stoneSf)} · {pct(t.stoneSf, ref.takeoff.stoneSf)}</td>}</tr>
                <tr><td>Shower tile</td><td>{n(t.showerTileSf)} sf</td>{isRef && <td className="cmp">set: {n(ref.takeoff.showerTileSf)} · {pct(t.showerTileSf, ref.takeoff.showerTileSf)}</td>}</tr>
                <tr><td>Exterior wall perimeter</td><td>{n(t.envelope.perimeter)} ft</td></tr>
                <tr><td>Average plate</td><td>{t.envelope.avgPlate.toFixed(1)} ft</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Window schedule</h3>
            <table className="tbl">
              <thead><tr><th>Mark</th><th>Size</th><th>Type</th><th>Head</th><th>Qty</th></tr></thead>
              <tbody>
                {t.windows.map((w) => (
                  <tr key={w.mark}><td>{w.mark}</td><td>{w.w}" × {w.h}"</td><td>{w.type}</td><td>{w.head}</td><td>{w.count}</td></tr>
                ))}
                <tr className="total"><td colSpan={4}>Single hung / fixed</td><td>{t.counts.singleHung} / {t.counts.fixed}{isRef && <span className="cmp"> · set: {ref.takeoff.singleHung} / {ref.takeoff.fixed}</span>}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Door schedule</h3>
            <table className="tbl">
              <thead><tr><th>Size</th><th>Material</th><th>Qty</th></tr></thead>
              <tbody>
                {t.doors.map((d) => (
                  <tr key={d.key}><td>{d.pair ? 'Pair ' : ''}{d.w}" × {d.h}"</td><td>{d.material}</td><td>{d.count}</td></tr>
                ))}
                <tr className="total"><td colSpan={2}>Interior / exterior</td><td>{t.counts.interiorDoors} / {t.counts.exteriorDoors}{isRef && <span className="cmp"> · set: {ref.takeoff.interiorDoors} / {ref.takeoff.exteriorDoors}</span>}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Sheet set the drafter receives</h3>
            <table className="tbl">
              <tbody>
                {kit.sheets.map((s) => (
                  <tr key={s.no}><td>{s.no}</td><td>{s.title}</td><td className="cmp">{s.contents}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              Plates {kit.plates.default}' and {kit.plates.public}' · roof {kit.roof.pitch} · {kit.roof.overhang} overhang · {kit.walls.exterior.studs} exterior, {kit.walls.plumbing.studs} plumbing walls.
            </p>
          </div>
          {isRef && <p className="fine">Columns marked "set" are the numbers on the Garza drawings. Differences are the gap between the packer and a drafter's plan.</p>}
        </>
      )}

      <div className="actions">
        <Button ghost onClick={onBack}>
          Keep editing
        </Button>
        <Button primary onClick={() => setSent(true)}>
          Send to drafters
        </Button>
      </div>
    </div>
  )
}
