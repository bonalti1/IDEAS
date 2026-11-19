// Jurisdiction rules with their sources (round 7, item 5). One row per city and per county for unincorporated
// land, in STB's verification priority. Every rule field is { value, source, checkedAt, status } where status is
// 'verified' (read in the code or the city's own sheet), 'summary' (likely; the office checks once) or 'unknown'
// (renders "unknown, confirm with city"; the engine uses the county default and flags the project).
// A value is a number of feet, or a rule object the engine resolves against the lot's own dimensions:
//   { pctOfDepth, min, max }             rear = pct of the lot depth, clamped (Pharr)
//   { pctOfDepth, max, lesser: true }    the lesser of the cap and pct of depth (Weslaco)
//   { halfRow: true, max }               half the right of way, capped (Hidalgo County; ROW unknown → 50 ft, flagged)
//   { pctOfWidth, min }                  side = pct of the lot width with a floor (McAllen narrow lots of record, §7.2.3)
// Seeded from draft-house-decisions.md B2 (Nov 18, 2026) and the parcel-and-codes research (Nov 17). The office
// edits any field with its source URL, status and date on the dashboard; the saved table wins over this file.
export const CHECKED = '2026-11-18'
const V = 'verified'
const L = 'summary'
const U = 'unknown'
const f = (value, source, status = V, checkedAt = CHECKED, note = null) => ({ value, source, checkedAt, status, ...(note ? { note } : {}) })
const unknown = (source = null) => ({ value: null, source, checkedAt: null, status: U })

export const STALE_DAYS = 180

// the eight counties STB prices in; the first four are the Rio Grande Valley
export const COUNTIES = ['Hidalgo County', 'Cameron County', 'Starr County', 'Willacy County', 'Jim Wells County', 'Nueces County', 'Kleberg County', 'San Patricio County']
export const RGV = COUNTIES.slice(0, 4)
// TDI windstorm (catastrophe-area) counties among them (tdi.texas.gov/WIND/adopted-codes.html)
export const WINDSTORM_COUNTIES = ['Cameron County', 'Willacy County', 'Nueces County', 'Kleberg County', 'San Patricio County']
export const WINDSTORM_NOTE = 'Coastal windstorm county: to qualify for TWIA insurance the house is built and inspected to the 2024 IRC windstorm rules and gets a TDI Certificate of Compliance (WPI-8). The office goes over it with you in the meeting.'
export const WIND_UNSET = 'set by the engineer of record'

// the state rows, exactly as researched
export const STATE_RULES = {
  tdiWindstorm: f('2024 IRC from 4/1/2026 (TDI windstorm building code)', 'https://www.tdi.texas.gov/WIND/adopted-codes.html', V, '2026-11-17'),
  energyCode: f('2015 IECC statewide unless the city adopted newer', 'https://comptroller.texas.gov/programs/seco/code/', L, '2026-11-17'),
  countyCodes: f('IRC per Local Government Code §233.153 (counties adopt the IRC for residential construction)', 'https://statutes.capitol.texas.gov/Docs/LG/htm/LG.233.htm', V, '2026-11-17'),
}

const MCALLEN_SRC = 'https://ecode360.com/50752982; https://www.mcallen.net/docs/default-source/planning-files/udc_adopted-02-09-2026.pdf'
const MCALLEN_CHECKLIST = 'https://www.mcallen.net/docs/default-source/permits-inspections-files/checklist-residential-submittals-rev-1-26.pdf'
const EDINBURG_SRC = 'https://zoneomics.com/code/edinburg-TX/chapter_4 (UDC Table 3.102-1, eff. 8/9/2022)'
const MISSION_SRC = 'https://www.missiontexas.us/DocumentCenter/View/1554 (permit application rev 06/19/2025)'
const PHARR_SRC = 'https://zoneomics.com/code/pharr-TX/chapter_2 (§1.11, Ord. O-2019-19)'
const WESLACO_SRC = 'Weslaco UDO Ord. 2026-39 adopted Nov 3, 2026 (civicclerk agenda fileId=6862); text https://cms9files.revize.com/weslacotx/Weslaco_UDO_10_06_2026.pdf Table 2.4-1, §2.3.4, §2.4.1'
const SANJUAN_SRC = 'https://ecode360.com/39522229'
const MERCEDES_SRC = 'https://ecode360.com/48100496 (Art. 32, Ord. 2025-06)'
const BROWNSVILLE_SRC = 'https://www.brownsvilletx.gov/DocumentCenter/View/10954 (UDC R-1 sheet)'
const HARLINGEN_SRC = 'https://ecode360.com/46403975 (§111-118/119); https://ecode360.com/46402380'
const SANBENITO_SRC = 'https://ecode360.com/38954869 (§5.01–5.06)'
const RGC_SRC = 'citizenportal.ai article 11324046 (Ord. 2026-14, adopted Oct 21, 2026); setbacks MuniScout (Nov 17)'
const ALICE_SRC = 'https://library.municode.com/TX/Alice (S5-1DIDIBO); https://alliancepermitting.com/guides/texas/alice-building-permit'
const PALMVIEW_SRC = 'https://codelibrary.amlegal.com/codes/palmview/latest/palmview_tx/0-0-0-4445; …/0-0-0-4916'
const CORPUS_SRC = 'https://online.encodeplus.com/regs/corpuschristi-tx/doc-viewer.aspx?secid=590'
const HIDALGO_SRC = 'Hidalgo County Subdivision Rules eff. 9/23/2025'

const county = (id, name, extra = {}) => ({
  id,
  name: `${name} (unincorporated)`,
  county: name,
  kind: 'county',
  priority: 100,
  district: f(null, STATE_RULES.countyCodes.source, U),
  front: f(25, 'office default (county defaults until the county’s subdivision rules are read)', L),
  side: f(5, 'office default', L),
  rear: f(10, 'office default', L),
  streetSide: f(15, 'office default', L),
  garageFt: f(18, 'office default', L),
  easement: unknown(),
  maxCoverage: f(0.5, 'office default', L),
  coverageIncludesImpervious: f(false, 'office default', L),
  maxHeightFt: f(35, 'office default', L),
  maxStories: unknown(),
  minLotSf: unknown(),
  minLotWidth: unknown(),
  minHouseSf: unknown(),
  irc: f('IRC per LGC §233.153', STATE_RULES.countyCodes.source, V, '2026-11-17'),
  energyCode: STATE_RULES.energyCode,
  windstorm: f(WINDSTORM_COUNTIES.includes(name), STATE_RULES.tdiWindstorm.source, V, '2026-11-17'),
  wind: unknown('ASCE Hazard Tool (a drafter looks it up once per city)'),
  driveway: unknown(),
  permitChecklist: unknown(),
  zoningLayer: null,
  flags: [],
  ...extra,
})

export const JURISDICTIONS = {
  mcallen: {
    id: 'mcallen', name: 'McAllen, TX', county: 'Hidalgo County', kind: 'city', priority: 1,
    district: f('R-1', MCALLEN_SRC),
    front: f(20, MCALLEN_SRC), side: f(5, MCALLEN_SRC), rear: f(10, MCALLEN_SRC), streetSide: f(10, MCALLEN_SRC),
    // non-conforming narrow lots of record: side yards 10% of the width, never under 3.5 ft (UDC §7.2.3)
    narrowSide: f({ pctOfWidth: 10, min: 3.5 }, MCALLEN_SRC + ' §7.2.3'),
    garageFt: f(18, MCALLEN_SRC + ' ("Entrances to a garage or carport shall be a minimum of eighteen (18) feet from streets or alleys", or the plat note)'),
    easement: f('per the recorded plat', MCALLEN_CHECKLIST, L),
    maxCoverage: f(0.5, MCALLEN_SRC), coverageIncludesImpervious: f(false, MCALLEN_SRC, L),
    maxHeightFt: f(35, MCALLEN_SRC), maxStories: unknown(MCALLEN_SRC),
    minLotSf: f(5000, MCALLEN_SRC), minLotWidth: f(45, MCALLEN_SRC), minHouseSf: unknown(MCALLEN_SRC),
    irc: f('2024 IRC + 2024 IECC; PE-designed structure required', MCALLEN_CHECKLIST), energyCode: f('2024 IECC', MCALLEN_CHECKLIST),
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: f('driveway approach width per the permit checklist', MCALLEN_CHECKLIST, L),
    permitChecklist: f('recorded plat, PE design under 2024 IRC, 2024 IECC report, Manual J/D/S, driveway approach width', MCALLEN_CHECKLIST),
    zoningLayer: 'mcallen',
    flags: [],
  },
  edinburg: {
    id: 'edinburg', name: 'Edinburg, TX', county: 'Hidalgo County', kind: 'city', priority: 2,
    district: f('RP', EDINBURG_SRC, L),
    front: f(20, EDINBURG_SRC, L, CHECKED, '15 on a cul-de-sac or irregular lot'), side: f(6, EDINBURG_SRC, L), rear: f(20, EDINBURG_SRC, L), streetSide: f(10, EDINBURG_SRC, L),
    garageFt: unknown(EDINBURG_SRC), easement: unknown(EDINBURG_SRC),
    // round 9, item 14: the UDC's 60% is impervious cover (building plus paving), not building coverage; building coverage is not read yet
    maxCoverage: unknown(EDINBURG_SRC), coverageIncludesImpervious: f(false, EDINBURG_SRC, L), imperviousMax: f(0.6, EDINBURG_SRC, L, 'impervious cover: house, porches, driveway and walks together'),
    maxHeightFt: f(35, EDINBURG_SRC, L), maxStories: unknown(EDINBURG_SRC),
    minLotSf: f(5000, EDINBURG_SRC, L), minLotWidth: f(50, EDINBURG_SRC, L), minHouseSf: unknown(EDINBURG_SRC),
    irc: f('2018 IRC, 2018 IECC', EDINBURG_SRC, V, '2026-11-17'), energyCode: f('2018 IECC', EDINBURG_SRC, V, '2026-11-17'),
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: 'edinburg',
    flags: ['code change pending'], // UDC update in progress
  },
  mission: {
    id: 'mission', name: 'Mission, TX', county: 'Hidalgo County', kind: 'city', priority: 3,
    district: f('R-1', MISSION_SRC, L),
    front: f(20, MISSION_SRC, L), side: f(6, MISSION_SRC, L), rear: f(10, MISSION_SRC, L), streetSide: f(10, MISSION_SRC, L),
    garageFt: f(18, MISSION_SRC + ' (18 ft from the ROW)', L), easement: unknown(MISSION_SRC),
    maxCoverage: unknown(MISSION_SRC), coverageIncludesImpervious: unknown(MISSION_SRC),
    maxHeightFt: unknown(MISSION_SRC), maxStories: unknown(MISSION_SRC),
    minLotSf: unknown(MISSION_SRC), minLotWidth: unknown(MISSION_SRC), minHouseSf: unknown(MISSION_SRC),
    irc: f('2024 IRC / 2024 I-codes / 2023 NEC; engineered sealed windstorm plan required (Municode’s "2000 IRC" is a stale codification)', MISSION_SRC), energyCode: f('2024 IECC (2024 REScheck on the application)', MISSION_SRC),
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(),
    permitChecklist: f('2024 REScheck, Manual J, engineered sealed windstorm plan, 11×17 set, pre-pour survey on cul-de-sac or irregular lots at the exact setback', MISSION_SRC),
    zoningLayer: null,
    flags: [],
  },
  pharr: {
    id: 'pharr', name: 'Pharr, TX', county: 'Hidalgo County', kind: 'city', priority: 4,
    district: f('R-1', PHARR_SRC, L),
    front: f(20, PHARR_SRC, L), side: f(5, PHARR_SRC, L, CHECKED, 'or per the plat'), rear: f({ pctOfDepth: 10, min: 9, max: 15 }, PHARR_SRC, L), streetSide: f(10, PHARR_SRC, L),
    garageFt: f(18, PHARR_SRC + ' (18 ft from the ROW)', L), easement: unknown(PHARR_SRC),
    maxCoverage: f(0.5, PHARR_SRC, L), coverageIncludesImpervious: f(false, PHARR_SRC, L),
    maxHeightFt: f(36, PHARR_SRC, L), maxStories: f(2.5, PHARR_SRC, L),
    minLotSf: f(6000, PHARR_SRC, L), minLotWidth: f(50, PHARR_SRC, L, CHECKED, '50 × 100 ft'), minHouseSf: unknown(PHARR_SRC),
    irc: f('2018 IRC', PHARR_SRC, L, '2026-11-17'), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: 'pharr',
    flags: [],
  },
  hidalgo: county('hidalgo', 'Hidalgo County', {
    priority: 5,
    district: f('county subdivision rules', HIDALGO_SRC),
    front: f({ halfRow: true, max: 50 }, HIDALGO_SRC, V, '2026-11-17', 'cul-de-sac 15; arterial 50; collector 40'),
    side: f(6, HIDALGO_SRC, V, '2026-11-17'), rear: f(15, HIDALGO_SRC, V, '2026-11-17'),
    streetSide: f(10, HIDALGO_SRC, V, '2026-11-17', '20 on an arterial or collector'),
    garageFt: f(18, HIDALGO_SRC + ' (corner lot: 18 ft from the side line; the front-entry rule text is ambiguous)', V, '2026-11-17'),
    maxCoverage: f(0.5, 'office default (the county rules set none)', L),
    irc: f('IRC per LGC §233.153', STATE_RULES.countyCodes.source, V, '2026-11-17'),
  }),
  weslaco: {
    id: 'weslaco', name: 'Weslaco, TX', county: 'Hidalgo County', kind: 'city', priority: 6,
    district: f('R-1 (new UDO)', WESLACO_SRC, L),
    front: f(25, WESLACO_SRC, L, CHECKED, '20 on a cul-de-sac'), side: f(5, WESLACO_SRC, L), rear: f({ pctOfDepth: 20, max: 25, lesser: true }, WESLACO_SRC, L), streetSide: f(10, WESLACO_SRC, L),
    garageFt: f(20, WESLACO_SRC + ' §2.3.4 (a side-street garage keeps 20 ft in front of it)', L), easement: unknown(WESLACO_SRC),
    maxCoverage: f(0.6, WESLACO_SRC, L), coverageIncludesImpervious: f(true, WESLACO_SRC, L),
    maxHeightFt: f(35, WESLACO_SRC, L), maxStories: f(2.5, WESLACO_SRC, L),
    minLotSf: f(6000, WESLACO_SRC, L), minLotWidth: f(50, WESLACO_SRC, L), minHouseSf: unknown(WESLACO_SRC),
    irc: f('2015 IRC', WESLACO_SRC, V, '2026-11-17'), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: 'weslaco',
    flags: ['code just changed, re-check'], // UDO adopted Nov 3, 2026; the adopted text may differ from the October draft
  },
  sanjuan: {
    id: 'sanjuan', name: 'San Juan, TX', county: 'Hidalgo County', kind: 'city', priority: 7,
    district: f('R-S', SANJUAN_SRC),
    front: f(20, SANJUAN_SRC), side: f(6, SANJUAN_SRC), rear: unknown(SANJUAN_SRC), streetSide: unknown(SANJUAN_SRC),
    garageFt: unknown(SANJUAN_SRC), easement: unknown(SANJUAN_SRC),
    maxCoverage: unknown(SANJUAN_SRC), coverageIncludesImpervious: unknown(SANJUAN_SRC),
    maxHeightFt: f(35, SANJUAN_SRC), maxStories: f(2.5, SANJUAN_SRC),
    minLotSf: f(6000, SANJUAN_SRC, V, CHECKED, 'corner 6,500'), minLotWidth: f(60, SANJUAN_SRC, V, CHECKED, 'corner 65; 100 ft deep'), minHouseSf: unknown(SANJUAN_SRC),
    irc: unknown(SANJUAN_SRC), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: null,
    flags: [],
  },
  mercedes: {
    id: 'mercedes', name: 'Mercedes, TX', county: 'Hidalgo County', kind: 'city', priority: 8,
    district: f('R-1', MERCEDES_SRC),
    front: f(25, MERCEDES_SRC), side: f(5, MERCEDES_SRC), rear: f(10, MERCEDES_SRC), streetSide: f(10, MERCEDES_SRC),
    garageFt: unknown(MERCEDES_SRC), easement: unknown(MERCEDES_SRC),
    maxCoverage: unknown(MERCEDES_SRC), coverageIncludesImpervious: unknown(MERCEDES_SRC),
    maxHeightFt: unknown(MERCEDES_SRC), maxStories: unknown(MERCEDES_SRC),
    minLotSf: f(5000, MERCEDES_SRC), minLotWidth: unknown(MERCEDES_SRC), minHouseSf: unknown(MERCEDES_SRC),
    irc: unknown(MERCEDES_SRC), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: null,
    flags: [],
  },
  brownsville: {
    id: 'brownsville', name: 'Brownsville, TX', county: 'Cameron County', kind: 'city', priority: 9,
    district: f('R-1', BROWNSVILLE_SRC),
    front: f(25, BROWNSVILLE_SRC), side: f(5, BROWNSVILLE_SRC), rear: f(5, BROWNSVILLE_SRC), streetSide: f(20, BROWNSVILLE_SRC),
    garageFt: unknown(BROWNSVILLE_SRC), easement: unknown(BROWNSVILLE_SRC),
    maxCoverage: f(0.5, BROWNSVILLE_SRC, V, CHECKED, 'including accessory buildings'), coverageIncludesImpervious: f(false, BROWNSVILLE_SRC, L),
    maxHeightFt: f(35, BROWNSVILLE_SRC), maxStories: unknown(BROWNSVILLE_SRC),
    minLotSf: f(5000, BROWNSVILLE_SRC), minLotWidth: f(50, BROWNSVILLE_SRC, V, CHECKED, '70 ft deep'), minHouseSf: unknown(BROWNSVILLE_SRC),
    irc: f('2018 IRC', BROWNSVILLE_SRC, L, '2026-11-17'), energyCode: STATE_RULES.energyCode,
    windstorm: f(true, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: 'brownsville',
    flags: [],
  },
  harlingen: {
    id: 'harlingen', name: 'Harlingen, TX', county: 'Cameron County', kind: 'city', priority: 10,
    district: f('R-1', HARLINGEN_SRC),
    front: f(20, HARLINGEN_SRC), side: f(5, HARLINGEN_SRC), rear: f(10, HARLINGEN_SRC), streetSide: f(10, HARLINGEN_SRC),
    garageFt: f(20, HARLINGEN_SRC + ' §111-118 ("set back no less than 20 feet unless … side entry")', V, CHECKED, 'side-entry garages exempt'),
    garageSideEntryExempt: f(true, HARLINGEN_SRC),
    easement: unknown(HARLINGEN_SRC),
    maxCoverage: f(0.6, HARLINGEN_SRC), coverageIncludesImpervious: f(true, HARLINGEN_SRC),
    maxHeightFt: unknown(HARLINGEN_SRC), maxStories: unknown(HARLINGEN_SRC),
    minLotSf: f(6000, HARLINGEN_SRC), minLotWidth: f(50, HARLINGEN_SRC), minHouseSf: unknown(HARLINGEN_SRC),
    irc: f('2024 IRC (Ord. 2025-23)', HARLINGEN_SRC), energyCode: STATE_RULES.energyCode,
    windstorm: f(true, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: 'harlingen',
    flags: [],
  },
  sanbenito: {
    id: 'sanbenito', name: 'San Benito, TX', county: 'Cameron County', kind: 'city', priority: 11,
    district: f('SF-1', SANBENITO_SRC),
    front: f(25, SANBENITO_SRC), side: f(5, SANBENITO_SRC, V, CHECKED, '4 if the lot is 49 ft or narrower; 3 if 35 ft or narrower'), rear: f(15, SANBENITO_SRC), streetSide: unknown(SANBENITO_SRC),
    garageFt: unknown(SANBENITO_SRC), easement: unknown(SANBENITO_SRC),
    maxCoverage: unknown(SANBENITO_SRC), coverageIncludesImpervious: unknown(SANBENITO_SRC),
    maxHeightFt: unknown(SANBENITO_SRC), maxStories: unknown(SANBENITO_SRC),
    minLotSf: f(6250, SANBENITO_SRC, V, CHECKED, '50 × 115 ft'), minLotWidth: f(50, SANBENITO_SRC), minHouseSf: unknown(SANBENITO_SRC),
    irc: f('2024 IRC', SANBENITO_SRC, L, '2026-11-17'), energyCode: STATE_RULES.energyCode,
    windstorm: f(true, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: null,
    flags: [],
  },
  riograndecity: {
    id: 'riograndecity', name: 'Rio Grande City, TX', county: 'Starr County', kind: 'city', priority: 12,
    district: f('R-1', RGC_SRC, L),
    front: f(25, RGC_SRC, L), side: f(5, RGC_SRC, L), rear: f(15, RGC_SRC, L), streetSide: unknown(RGC_SRC),
    garageFt: unknown(RGC_SRC), easement: unknown(RGC_SRC),
    maxCoverage: unknown(RGC_SRC), coverageIncludesImpervious: unknown(RGC_SRC),
    maxHeightFt: unknown(RGC_SRC), maxStories: unknown(RGC_SRC),
    minLotSf: f(6250, RGC_SRC, L), minLotWidth: unknown(RGC_SRC), minHouseSf: unknown(RGC_SRC),
    irc: f('2024 IRC + 2023 NEC (Ord. 2026-14, adopted Oct 21, 2026)', RGC_SRC), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: null,
    flags: ['code just changed, re-check'],
  },
  alice: {
    id: 'alice', name: 'Alice, TX', county: 'Jim Wells County', kind: 'city', priority: 13,
    district: f('R-1', ALICE_SRC, L),
    front: f(25, ALICE_SRC, L), side: f(5, ALICE_SRC, L), rear: f(5, ALICE_SRC, L), streetSide: f(15, ALICE_SRC, L),
    garageFt: unknown(ALICE_SRC), easement: unknown(ALICE_SRC),
    maxCoverage: unknown(ALICE_SRC), coverageIncludesImpervious: unknown(ALICE_SRC),
    maxHeightFt: unknown(ALICE_SRC), maxStories: unknown(ALICE_SRC),
    minLotSf: unknown(ALICE_SRC), minLotWidth: unknown(ALICE_SRC), minHouseSf: unknown(ALICE_SRC),
    irc: f('2012 IRC (adopted 2014)', ALICE_SRC, L), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: null,
    flags: [],
  },
  palmview: {
    id: 'palmview', name: 'Palmview, TX', county: 'Hidalgo County', kind: 'city', priority: 14,
    district: f('R-1', PALMVIEW_SRC),
    front: f(20, PALMVIEW_SRC, V, CHECKED, 'collector 30 / minor arterial 35 / major arterial 40; cul-de-sac 10'), side: f(6, PALMVIEW_SRC), rear: f(10, PALMVIEW_SRC), streetSide: f(10, PALMVIEW_SRC),
    garageFt: f(18, PALMVIEW_SRC + ' (18 ft from the ROW)'), easement: unknown(PALMVIEW_SRC),
    maxCoverage: unknown(PALMVIEW_SRC), coverageIncludesImpervious: unknown(PALMVIEW_SRC),
    maxHeightFt: f(35, PALMVIEW_SRC, V, CHECKED, '+1 ft of setback per ft above 25'), maxStories: unknown(PALMVIEW_SRC),
    minLotSf: f(6000, PALMVIEW_SRC, V, CHECKED, 'corner 7,000'), minLotWidth: f(60, PALMVIEW_SRC, V, CHECKED, 'corner 65; 100 ft deep'), minHouseSf: unknown(PALMVIEW_SRC),
    irc: f('IRC, edition not stated (§150.01)', PALMVIEW_SRC, L), energyCode: STATE_RULES.energyCode,
    windstorm: f(false, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: null,
    flags: [],
  },
  corpuschristi: {
    id: 'corpuschristi', name: 'Corpus Christi, TX', county: 'Nueces County', kind: 'city', priority: 15,
    district: f('RS-6 / SF-6', CORPUS_SRC),
    front: f(25, CORPUS_SRC), side: f(5, CORPUS_SRC, V, CHECKED, '10 ft total'), rear: f(5, CORPUS_SRC), streetSide: f(10, CORPUS_SRC + ' §4.2.10', L),
    garageFt: unknown(CORPUS_SRC), easement: unknown(CORPUS_SRC),
    maxCoverage: f(0.7, CORPUS_SRC, V, CHECKED, 'open space at least 30%'), coverageIncludesImpervious: f(false, CORPUS_SRC, L),
    maxHeightFt: f(35, CORPUS_SRC), maxStories: unknown(CORPUS_SRC),
    minLotSf: f(6000, CORPUS_SRC), minLotWidth: f(50, CORPUS_SRC), minHouseSf: unknown(CORPUS_SRC),
    irc: f('2021 IRC with amendments', CORPUS_SRC, V, '2026-11-17'), energyCode: STATE_RULES.energyCode,
    windstorm: f(true, STATE_RULES.tdiWindstorm.source, V, '2026-11-17'), wind: unknown('ASCE Hazard Tool'),
    driveway: unknown(), permitChecklist: unknown(),
    zoningLayer: 'corpuschristi',
    flags: [],
  },
  'cameron-county': county('cameron-county', 'Cameron County', { priority: 101 }),
  'starr-county': county('starr-county', 'Starr County', { priority: 102 }),
  'willacy-county': county('willacy-county', 'Willacy County', { priority: 103 }),
  'jimwells-county': county('jimwells-county', 'Jim Wells County', { priority: 104 }),
  'nueces-county': county('nueces-county', 'Nueces County', { priority: 105 }),
  'kleberg-county': county('kleberg-county', 'Kleberg County', { priority: 106 }),
  'sanpatricio-county': county('sanpatricio-county', 'San Patricio County', { priority: 107 }),
}
export const JURISDICTION_IDS = Object.keys(JURISDICTIONS).sort((a, b) => JURISDICTIONS[a].priority - JURISDICTIONS[b].priority)
/** The county row for unincorporated land in a county ('hidalgo' keeps its old id). */
export const countyRowId = (countyName) => (countyName === 'Hidalgo County' ? 'hidalgo' : Object.keys(JURISDICTIONS).find((id) => JURISDICTIONS[id].kind === 'county' && JURISDICTIONS[id].county === countyName) || null)

// the rule fields the engine reads, the labels the panel prints, and the office defaults for an unknown value
export const RULE_FIELDS = ['front', 'side', 'rear', 'streetSide', 'garageFt', 'maxCoverage', 'maxHeightFt', 'minLotSf', 'minLotWidth']
export const ALL_FIELDS = ['district', 'front', 'side', 'rear', 'streetSide', 'garageFt', 'easement', 'maxCoverage', 'coverageIncludesImpervious', 'imperviousMax', 'maxHeightFt', 'maxStories', 'minLotSf', 'minLotWidth', 'minHouseSf', 'irc', 'energyCode', 'windstorm', 'wind', 'driveway', 'permitChecklist']
export const FIELD_LABELS = {
  district: 'Single-family district', front: 'Front setback', side: 'Side setback', rear: 'Rear setback', streetSide: 'Street-side setback', garageFt: 'Garage door from the street', easement: 'Easements',
  maxCoverage: 'Max lot coverage', coverageIncludesImpervious: 'Coverage counts driveways and walks', imperviousMax: 'Max impervious cover', maxHeightFt: 'Max height', maxStories: 'Max stories', minLotSf: 'Min lot area', minLotWidth: 'Min lot width', minHouseSf: 'Min house size',
  irc: 'Building code', energyCode: 'Energy code', windstorm: 'TDI windstorm county', wind: 'Design wind speed', driveway: 'Driveway and curb cut', permitChecklist: 'Permit checklist',
}
export const COUNTY_DEFAULTS = { front: 25, side: 5, rear: 10, streetSide: 15, garageFt: 18, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: null, minLotWidth: null }

/** 'ok' | 're-check due': a rule checked more than 180 days ago, or never. */
export function staleness(field, now = Date.now()) {
  if (!field || !field.checkedAt) return field?.status === 'unknown' ? 'unknown' : 're-check due'
  return now - Date.parse(field.checkedAt) > STALE_DAYS * 86400000 ? 're-check due' : 'ok'
}

/**
 * A rule's number for this lot: a plain number stays; a rule object is computed from the lot's width and depth
 * (feet) and explained ("rear 13.1 ft = 10% of 131 ft depth, at least 9 and at most 15"); an unknown value is
 * the county default, flagged. Returns { value, text, flag }.
 */
export function resolveRule(field, key, dims = {}, { row = 'front' } = {}) {
  const dflt = COUNTY_DEFAULTS[key]
  if (!field || field.value === null || field.value === undefined) return { value: dflt, text: dflt != null ? `${key} ${dflt} ft: unknown, confirm with city (county default used)` : null, flag: 'unknown' }
  const v = field.value
  if (typeof v === 'number') return { value: v, text: null, flag: null }
  if (typeof v !== 'object') return { value: dflt, text: null, flag: 'unknown' }
  const depth = Number(dims.depth) || null
  const width = Number(dims.width) || null
  if (v.pctOfDepth != null) {
    if (!depth) return { value: v.min ?? v.max ?? dflt, text: `${key}: ${v.pctOfDepth}% of the lot depth (depth unknown yet)`, flag: 'needs-dims' }
    let n = (v.pctOfDepth / 100) * depth
    let how = `${v.pctOfDepth}% of ${Math.round(depth)} ft depth`
    if (v.lesser && v.max != null) {
      if (v.max < n) {
        n = v.max
        how = `the lesser of ${v.max} ft and ${v.pctOfDepth}% of ${Math.round(depth)} ft depth`
      } else how = `the lesser of ${v.max} ft and ${v.pctOfDepth}% of ${Math.round(depth)} ft depth`
    } else {
      if (v.min != null && n < v.min) n = v.min
      if (v.max != null && n > v.max) n = v.max
      if (v.min != null || v.max != null) how += ` (${v.min != null ? `at least ${v.min}` : ''}${v.min != null && v.max != null ? ', ' : ''}${v.max != null ? `at most ${v.max}` : ''})`
    }
    n = Math.round(n * 10) / 10
    return { value: n, text: `${key} ${n} ft = ${how}`, flag: null }
  }
  if (v.halfRow) {
    const row = Number(dims.rowFt) || 50
    const n = Math.min(v.max ?? Infinity, row / 2)
    return { value: n, text: `${key} ${n} ft = half the ${row} ft right of way${dims.rowFt ? '' : ' (ROW unknown: 50 ft assumed, confirm)'}${v.max != null ? `, at most ${v.max}` : ''}`, flag: dims.rowFt ? null : 'row-assumed' }
  }
  if (v.pctOfWidth != null) {
    if (!width) return { value: v.min ?? dflt, text: null, flag: 'needs-dims' }
    const n = Math.round(Math.max(v.min ?? 0, (v.pctOfWidth / 100) * width) * 10) / 10
    return { value: n, text: `${key} ${n} ft = ${v.pctOfWidth}% of ${Math.round(width)} ft width${v.min != null ? `, never under ${v.min}` : ''}`, flag: null }
  }
  return { value: dflt, text: null, flag: 'unknown' }
}

/**
 * The rules of a jurisdiction resolved for a lot: the numbers the engine needs, the derived-value texts, the
 * flags (unknown fields, re-check due, code changed), and `used` rows for the "Rules used for this lot" panel.
 * `overrides` are per-lot setbacks (a plat's printed numbers win); `dims` { width, depth, rowFt, corner }.
 */
export function resolveRules(row, overrides = {}, dims = {}, now = Date.now()) {
  if (!row) return null
  const out = { id: row.id, name: row.name, county: row.county, kind: row.kind, zoning: row.district?.value || null, verified: ALL_FIELDS.every((k) => !row[k] || row[k].status !== 'unknown' ? true : false) && RULE_FIELDS.every((k) => row[k]?.status === 'verified'), flags: [...(row.flags || [])], derived: [], used: [] }
  const width = Number(dims.width) || null
  for (const k of RULE_FIELDS) {
    const field = row[k]
    const r = resolveRule(field, k, dims)
    let value = r.value
    let text = r.text
    // McAllen's narrow lots of record: side yards 10% of the width, never under 3.5 ft (§7.2.3)
    if (k === 'side' && row.narrowSide?.value && width && row.minLotWidth?.value && width < row.minLotWidth.value) {
      const n = resolveRule(row.narrowSide, 'side', dims)
      value = n.value
      text = `side ${n.value} ft = ${row.narrowSide.value.pctOfWidth}% of ${Math.round(width)} ft width (lot of record under the ${row.minLotWidth.value} ft minimum, ${row.narrowSide.source})`
      out.flags.push('narrow lot of record')
    }
    const o = overrides[k]
    if (o !== undefined && o !== null && o !== '' && ['front', 'side', 'rear', 'streetSide'].includes(k)) {
      value = +o
      text = `${k} ${+o} ft: printed on the plat or set by the drafter (overrides the city table)`
    }
    out[k] = value
    if (text) out.derived.push(text)
    const stale = staleness(field, now)
    if (r.flag === 'unknown' || field?.status === 'unknown') out.flags.push(`${k}: unknown, confirm with city`)
    else if (stale === 're-check due') out.flags.push(`${k}: re-check due`)
    const unknown = r.flag === 'unknown' || !field || field.status === 'unknown'
    out.used.push({ id: k, label: FIELD_LABELS[k], value: unknown && o === undefined ? `${formatValue(k, value, null)} (county default; unknown, confirm with city)` : formatValue(k, value, field), text, source: field?.source || null, checkedAt: field?.checkedAt || null, status: field?.status || 'unknown', stale: stale === 're-check due' })
  }
  out.coverageIncludesImpervious = !!row.coverageIncludesImpervious?.value
  out.imperviousMax = row.imperviousMax?.value ?? null
  out.maxStories = row.maxStories?.value ?? null
  out.minHouseSf = row.minHouseSf?.value ?? null
  out.garageSideEntryExempt = !!row.garageSideEntryExempt?.value
  out.irc = row.irc?.value || null
  out.energyCode = row.energyCode?.value || null
  out.windstorm = !!row.windstorm?.value
  out.wind = row.wind?.value || null
  out.windText = row.wind?.value?.mph ? `${row.wind.value.mph} mph (ASCE ${row.wind.value.standard || '7-22'}, risk category ${row.wind.value.riskCategory || 'II'})` : WIND_UNSET
  out.permitChecklist = row.permitChecklist?.value || null
  out.easement = row.easement?.value || null
  out.driveway = row.driveway?.value || null
  for (const k of ['district', 'maxStories', 'minHouseSf', 'irc', 'energyCode', 'windstorm', 'wind', 'coverageIncludesImpervious', 'imperviousMax', 'easement', 'driveway']) {
    const field = row[k]
    const stale = staleness(field, now)
    out.used.push({ id: k, label: FIELD_LABELS[k], value: k === 'wind' ? out.windText : formatValue(k, field?.value, field), text: null, source: field?.source || null, checkedAt: field?.checkedAt || null, status: field?.status || 'unknown', stale: stale === 're-check due' })
  }
  out.flags = [...new Set(out.flags)]
  out.unknown = out.used.filter((u) => u.status === 'unknown').map((u) => u.id)
  out.recheck = out.used.filter((u) => u.stale && u.status !== 'unknown').map((u) => u.id)
  return out
}

export function formatValue(k, v, field) {
  if (v === null || v === undefined) return k === 'wind' ? WIND_UNSET : 'unknown, confirm with city'
  if (k === 'maxCoverage' || k === 'imperviousMax') return `${Math.round(v * 100)}%${field?.note ? ` (${field.note})` : ''}`
  if (k === 'windstorm') return v ? 'yes (TDI catastrophe area)' : 'no'
  if (k === 'coverageIncludesImpervious') return v ? 'yes' : 'no'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'object') return v.pctOfDepth != null ? `${v.lesser ? `the lesser of ${v.max} ft and ` : ''}${v.pctOfDepth}% of the lot depth${v.min != null || (v.max != null && !v.lesser) ? ` (${v.min != null ? `at least ${v.min}` : ''}${v.min != null && v.max != null ? ', ' : ''}${v.max != null && !v.lesser ? `at most ${v.max}` : ''})` : ''}` : v.halfRow ? `half the right of way (at most ${v.max} ft)` : v.pctOfWidth != null ? `${v.pctOfWidth}% of the lot width, at least ${v.min} ft` : JSON.stringify(v)
  if (['front', 'side', 'rear', 'streetSide', 'garageFt', 'maxHeightFt'].includes(k)) return `${v} ft${field?.note ? ` (${field.note})` : ''}`
  if (k === 'minLotSf') return `${Number(v).toLocaleString()} sf${field?.note ? ` (${field.note})` : ''}`
  if (k === 'minLotWidth') return `${v} ft${field?.note ? ` (${field.note})` : ''}`
  return String(v)
}

/** A status chip's words for the panel. */
export const statusWords = (u) => (u.status === 'verified' ? (u.stale ? 'from the city code, re-check due' : 'from the city code') : u.status === 'summary' ? (u.stale ? 'summary, office confirms (re-check due)' : 'summary, office confirms') : 'unknown, confirm with city')

/** The office's edits applied on top of the seed: a saved field is { value, source, checkedAt, status, by }. */
export function jurisdictionTable(overrides = {}) {
  const out = {}
  for (const id of JURISDICTION_IDS) {
    const base = JURISDICTIONS[id]
    const o = overrides[id] || {}
    const row = { ...base }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'flags' && Array.isArray(v)) row.flags = v
      else if (v && typeof v === 'object' && 'value' in v) row[k] = { ...(base[k] || {}), ...v }
      else if (ALL_FIELDS.includes(k) || k === 'narrowSide') row[k] = { ...(base[k] || {}), value: v, status: base[k]?.status || 'summary' }
      else row[k] = v
    }
    out[id] = row
  }
  return out
}

/** The jurisdiction for a geocoded place: the city row when we have one, else the county's row (or null outside the 8 counties). */
export function jurisdictionFor({ place, county } = {}, table = JURISDICTIONS) {
  const p = String(place || '').toLowerCase().replace(/[^a-z]/g, '')
  const cityId = Object.keys(table).find((id) => table[id].kind === 'city' && table[id].name.split(',')[0].toLowerCase().replace(/[^a-z]/g, '') === p) || null
  if (cityId) return { type: 'city', id: cityId, name: table[cityId].name, county: table[cityId].county, etj: null, source: 'Census Incorporated Places' }
  const cid = county && COUNTIES.includes(county) ? countyRowId(county) : null
  if (cid) return { type: 'county', id: cid, name: table[cid].name, county, etj: null, source: 'Census Counties' }
  return null
}

// a homeowner reads this line: the rules are named in plain words, not by their field names (round 12 walkthrough)
const RULE_WORDS = { front: 'the street side', side: 'the sides', rear: 'the back', streetSide: 'a side street', garageFt: 'the garage door', maxCoverage: 'how much of the lot a house may cover', maxHeightFt: 'the height', minLotSf: 'the smallest lot', minLotWidth: 'the narrowest lot' }
/** What the lot step says about a geocoded address (item 2): the four cases. */
export function geoMessage(geo, table = JURISDICTIONS, lang = 'en') {
  if (!geo) return ''
  if (lang === 'es') return geoMessageEs(geo, table)
  if (!geo.found) return geo.note || 'The address was not found. Check it, or type the lot in.'
  const j = geo.jurisdiction || jurisdictionFor(geo, table)
  if (j?.type === 'city') {
    const row = table[j.id]
    const unverified = RULE_FIELDS.filter((k) => row[k]?.status !== 'verified')
    return unverified.length ? `We have the ${row.name} rules; ${unverified.length === 1 ? 'one of them is a summary' : `${unverified.length} of them are summaries`} the office confirms (${unverified.map((k) => RULE_WORDS[k] || k).join(', ')}).` : `We have the ${row.name} rules, from the city code.`
  }
  if (j?.type === 'county') {
    if (geo.place) return `${geo.place} is in ${j.county}; we have no rules for that city yet, so the county row is used, unverified, and a drafter checks the city's rules.`
    return `Unincorporated ${j.county}: the county subdivision rules are used${j.id === 'hidalgo' ? '' : ' (office defaults until they are read)'}, and a drafter checks them.`
  }
  return `${geo.place ? `${geo.place}${geo.state ? ', ' + geo.state : ''}` : 'This address'} is outside the eight counties we build in (${COUNTIES.map((c) => c.replace(' County', '')).join(', ')}). You can still draft to see a plan; the setbacks shown are office defaults.`
}

// round 13: the same four cases for a homeowner who reads Spanish. No jargon: where the English says "setbacks"
// this says the space the city keeps open along each edge of the lot.
const RULE_WORDS_ES = { front: 'el lado de la calle', side: 'los lados', rear: 'el fondo', streetSide: 'una calle lateral', garageFt: 'la puerta de la cochera', maxCoverage: 'cuánto del lote puede cubrir una casa', maxHeightFt: 'la altura', minLotSf: 'el lote más chico', minLotWidth: 'el lote más angosto' }
const condado = (c) => String(c || '').replace(/^(.+?) County$/, 'Condado de $1')
function geoMessageEs(geo, table) {
  if (!geo.found) return geo.note || 'No encontramos la dirección. Revísala, o escribe las medidas del lote.'
  const j = geo.jurisdiction || jurisdictionFor(geo, table)
  if (j?.type === 'city') {
    const row = table[j.id]
    const unverified = RULE_FIELDS.filter((k) => row[k]?.status !== 'verified')
    return unverified.length ? `Tenemos las reglas de ${row.name}; ${unverified.length === 1 ? 'una es un resumen' : `${unverified.length} son resúmenes`} que la oficina confirma (${unverified.map((k) => RULE_WORDS_ES[k] || k).join(', ')}).` : `Tenemos las reglas de ${row.name}, tomadas del código de la ciudad.`
  }
  if (j?.type === 'county') {
    if (geo.place) return `${geo.place} está en el ${condado(j.county)}; todavía no tenemos las reglas de esa ciudad, así que usamos las del condado, sin verificar, y un dibujante revisa las reglas de la ciudad.`
    return `Fuera de los límites de la ciudad, en el ${condado(j.county)}: usamos las reglas de subdivisión del condado${j.id === 'hidalgo' ? '' : ' (los valores de la oficina, hasta que se lean)'}, y un dibujante las revisa.`
  }
  return `${geo.place ? `${geo.place}${geo.state ? ', ' + geo.state : ''}` : 'Esta dirección'} queda fuera de los ocho condados donde construimos (${COUNTIES.map((c) => c.replace(' County', '')).join(', ')}). De todos modos puedes hacer un borrador para ver un plano; el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote se muestra con los valores de la oficina.`
}
