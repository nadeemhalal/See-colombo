// Downloads street furniture for the map area from OpenStreetMap via the Overpass API: bus stops and
// traffic signals. Small and separate from fetch-osm.ts so the big map download doesn't need repeating.
// Data © OpenStreetMap contributors, ODbL. Output: EXTRAS_FILE in config.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BBOX, EXTRAS_FILE } from './config.ts';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `
[out:json][timeout:180];
(
  node["highway"="bus_stop"](${b});
  node["public_transport"="platform"]["bus"="yes"](${b});
  node["amenity"="bus_station"](${b});
  node["highway"="traffic_signals"](${b});
);
out;
`;

async function main() {
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      console.log(`Querying ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'see-colombo-osm-build/0.1' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const text = await res.text();
      const json = JSON.parse(text);
      mkdirSync(dirname(EXTRAS_FILE), { recursive: true });
      writeFileSync(EXTRAS_FILE, text);
      console.log(`Saved ${json.elements.length} elements to ${EXTRAS_FILE}`);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`Failed on ${url}:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastErr;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
