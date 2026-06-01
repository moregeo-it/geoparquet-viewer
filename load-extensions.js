import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import process from 'process';
import { Buffer } from 'buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function getDuckDBVersion() {
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
  const wasmPath = join(__dirname, 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm');
  const bundles = { eh: { mainModule: wasmPath, mainWorker: null } };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({});
  const conn = db.connect();
  const version = conn.query('SELECT version() AS version').toArray()[0].version;
  conn.close();
  return version;
}

const duckdbVersion = await getDuckDBVersion();
console.log(`DuckDB version: ${duckdbVersion}`);

const EXTENSIONS = [
  `https://extensions.duckdb.org/${duckdbVersion}/wasm_eh/httpfs.duckdb_extension.wasm`,
  `https://extensions.duckdb.org/${duckdbVersion}/wasm_eh/spatial.duckdb_extension.wasm`,
  `https://extensions.duckdb.org/${duckdbVersion}/wasm_eh/parquet.duckdb_extension.wasm`,
  // Available for v1.5.2 or later
  `https://community-extensions.duckdb.org/${duckdbVersion}/wasm_eh/duck_geoarrow.duckdb_extension.wasm`,
];

for (const url of EXTENSIONS) {
  const filename = url.split('/').at(-1);
  const dest = join(__dirname, 'extensions', filename);
  process.stdout.write(`Downloading ${filename}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
  console.log(`saved (${(buffer.length / 1024).toFixed(1)} KB)`);
}
