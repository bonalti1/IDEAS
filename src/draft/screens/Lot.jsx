import HouseScene from '../HouseScene.jsx'
import { Button, Stat, sf } from '../ui.jsx'
import { LOT_AREA_SF, SETBACK_CORNERS, SETBACK_EDGE_LABELS } from '../../data/survey.js'
import { polygonArea } from '../../lib/geometry.js'
import { CITIES } from '../lib/styles.js'

const ENVELOPE_SF = Math.abs(polygonArea(SETBACK_CORNERS))

export default function Lot({ lot, onNext, onBack }) {
  const city = CITIES.palmview
  return (
    <div className="screen split">
      <div className="viewport">
        <HouseScene view="top" showHouse={false} />
        <div className="viewport-tag">Lot 514 · Villa-Rama East Phase V</div>
      </div>
      <aside className="side">
        <h2>We found your lot</h2>
        <p className="muted">{lot?.address}</p>
        <div className="stats">
          <Stat k="City" v={city.name} />
          <Stat k="Zoning" v={city.zoning} />
          <Stat k="Lot area" v={sf(LOT_AREA_SF)} />
          <Stat k="Buildable area" v={sf(ENVELOPE_SF)} />
          <Stat k="Max coverage" v={`${city.maxCoverage * 100}% · ${sf(LOT_AREA_SF * city.maxCoverage)}`} />
        </div>
        <h3>Setbacks</h3>
        <ul className="list">
          {SETBACK_EDGE_LABELS.map((s) => (
            <li key={s}>{s.replace(' — ', ' from ').replace(/^(\d+)'/, "$1 ft")}</li>
          ))}
        </ul>
        <p className="fine">Red is your property line. Green dashed is where the house can sit. A drafter double-checks this before anything is final.</p>
        <div className="actions">
          <Button ghost onClick={onBack}>
            Back
          </Button>
          <Button primary onClick={onNext}>
            Looks right, pick a style
          </Button>
        </div>
      </aside>
    </div>
  )
}
