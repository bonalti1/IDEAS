// Pick the store: Postgres when DATABASE_URL is set, else the JSON file in DATA_DIR.
import { jsonStore } from './json.mjs'
import { postgresStore } from './postgres.mjs'

export function openStore({ databaseUrl = process.env.DATABASE_URL, dataDir } = {}) {
  return databaseUrl ? postgresStore(databaseUrl) : jsonStore(dataDir)
}
