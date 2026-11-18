// Monthly CAD parcel downloads into PostGIS (round 7, item 12): the plan, as a script that does nothing until the
// office agrees to run it. Each appraisal district publishes a shapefile or file geodatabase once a month; this
// loads it into a `cad_parcels` table in the Supabase Postgres (PostGIS enabled) so a lookup never depends on the
// county's ArcGIS server being up. Not scheduled: run by hand, and only with CAD_POSTGIS=1 and DATABASE_URL set.
//
//   node scripts/cad-import.mjs --plan                 prints the table SQL and the per-county download notes
//   CAD_POSTGIS=1 node scripts/cad-import.mjs <county> <file.zip|.gdb>   loads one county (needs ogr2ogr on the PATH)
//
// What it would cost: Supabase Pro ($25/month) for PostGIS and the ~2 GB the eight counties take; nothing else.
// What it changes: server/parcels.mjs tries this table after the live sources (source id 'cad-postgis').
import { spawnSync } from 'node:child_process'
import { PARCEL_SOURCES } from '../server/parcel-sources.mjs'

const SQL = `
create extension if not exists postgis;
create table if not exists cad_parcels (
  id bigserial primary key,
  county text not null,
  prop_id text not null,
  geo_id text,
  situs text,
  legal text,
  acres numeric,
  owner_name text,          -- drafter-only, never sent to a homeowner
  owner_addr text,          -- drafter-only
  source text not null,     -- the download's file name and month
  loaded_at timestamptz not null default now(),
  geom geometry(MultiPolygon, 4326) not null
);
create index if not exists cad_parcels_geom on cad_parcels using gist (geom);
create index if not exists cad_parcels_situs on cad_parcels (county, situs);
create unique index if not exists cad_parcels_key on cad_parcels (county, prop_id);
`
const DOWNLOADS = {
  'Hidalgo County': 'hidalgoad.org, GIS data request (monthly shapefile by email); or the RGV911 layer exported with ogr2ogr',
  'Cameron County': 'cameroncad.org, GIS downloads (geodatabase, monthly); the City of Brownsville hosts the same as CameronCAD_Parcels_<month>',
  'Nueces County': 'nuecescad.net, Data downloads, parcels shapefile',
  'Starr County': 'starrcad.org, GIS request by email',
  'Willacy County': 'willacycad.org; RGV911 SCC layer 48 export',
  'Jim Wells County': 'jimwellscad.org, GIS downloads',
  'Kleberg County': 'klebergcad.org, GIS downloads',
  'San Patricio County': 'sanpatcad.org, GIS downloads',
}

const [, , a, b] = process.argv
if (!a || a === '--plan') {
  console.log(SQL)
  console.log('Per-county downloads:')
  for (const [county, how] of Object.entries(DOWNLOADS)) console.log(`  ${county}: ${how}`)
  console.log('\nLive layers these would mirror:')
  for (const s of PARCEL_SOURCES.filter((s) => s.kind === 'arcgis' && !s.disabled)) console.log(`  ${s.county}: ${s.url}`)
  console.log('\nNot scheduled. Run by hand with CAD_POSTGIS=1 once the office agrees (docs/FIX-ROUND-7.md, item 12).')
  process.exit(0)
}
if (process.env.CAD_POSTGIS !== '1' || !process.env.DATABASE_URL) {
  console.error('refusing to load: set CAD_POSTGIS=1 and DATABASE_URL (this is the dormant monthly import; see --plan)')
  process.exit(2)
}
const county = a
const file = b
if (!DOWNLOADS[county] || !file) {
  console.error('usage: CAD_POSTGIS=1 node scripts/cad-import.mjs "<County Name> County" <file.zip|.gdb>')
  process.exit(2)
}
// ogr2ogr does the heavy lifting: reproject to 4326, promote to multipolygon, append into cad_parcels
const r = spawnSync('ogr2ogr', ['-f', 'PostgreSQL', `PG:${process.env.DATABASE_URL}`, file, '-nln', 'cad_parcels_stage', '-t_srs', 'EPSG:4326', '-nlt', 'PROMOTE_TO_MULTI', '-overwrite'], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error('ogr2ogr failed (is GDAL installed?)')
  process.exit(r.status || 1)
}
console.log(`staged ${county} from ${file} into cad_parcels_stage; map its fields into cad_parcels with the county's schema (server/parcel-sources.mjs) and swap the rows in one transaction.`)
