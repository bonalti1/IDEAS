import {
  ARC,
  ARC_RECORDED,
  LOT_AREA_SF,
  STREET_WIDTH_ILLUSTRATIVE,
} from '../data/survey.js'

function Row({ k, v }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}

export default function Panel() {
  return (
    <aside className="panel">
      <section>
        <h2>LEGEND</h2>
        <div className="legend-item">
          <span className="swatch line-red" /> Property line (recorded plat)
        </div>
        <div className="legend-item">
          <span className="swatch line-green-dash" /> Setback envelope (buildable)
        </div>
        <div className="legend-item">
          <span className="swatch fill-street" /> Street (width illustrative)
        </div>
        <div className="legend-item">
          <span className="swatch fill-lot" /> Lot 514
        </div>
      </section>

      <section>
        <h2>LOT DATA</h2>
        <Row k="Computed area" v={`${Math.round(LOT_AREA_SF).toLocaleString()} sf`} />
        <Row k="Recorded area" v="≈21,000 sf (0.48 ac)" />
        <Row
          k="Delta"
          v={`${(((LOT_AREA_SF - 21000) / 21000) * 100).toFixed(1)}%`}
        />
      </section>

      <section>
        <h2>DON ST CURVE CHECK</h2>
        <Row k="R (recorded)" v="50.00'" />
        <Row k="Δ recorded" v="62°58'14&quot;" />
        <Row k="Δ as rendered" v={`${ARC.deltaDeg.toFixed(2)}°`} />
        <Row k="L recorded / rendered" v={`55.11' / ${ARC.arcLength.toFixed(2)}'`} />
        <Row k="Chord rec. / coords" v={`52.23' / ${ARC.chord.toFixed(2)}'`} />
        <p className="note">
          Arc fit through recorded PC/PT at R=50'. Small residual vs recorded Δ/L
          reflects rounding in the plat coordinates.
        </p>
      </section>

      <section>
        <h2>NOTES</h2>
        <p className="note">
          Street bands drawn at {STREET_WIDTH_ILLUSTRATIVE}' for context — ROW widths
          not surveyed. Setbacks: 6' side (Lot 513) · 25' Don St · 10' Ida Blvd ·
          20' Showers Rd.
        </p>
      </section>
    </aside>
  )
}
