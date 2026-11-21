// Downloads the map area (see config.ts) from OpenStreetMap via the Overpass API.
// Data © OpenStreetMap contributors, ODbL. Output: RAW_FILE in config.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BBOX, RAW_FILE } from './config.ts';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `
[out:json][timeout:600][maxsize:536870912];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["railway"~"^(rail|light_rail|narrow_gauge|platform)$"](${b});
  way["natural"="coastline"](${b});
  way["natural"~"^(water|wood|scrub|grassland|beach|sand|wetland)$"](${b});
  relation["natural"~"^(water|wood|beach)$"](${b});
  way["waterway"~"^(riverbank|canal|river|stream|drain|dock)$"](${b});
  relation["waterway"="riverbank"](${b});
  way["leisure"~"^(park|garden|pitch|playground|stadium|marina)$"](${b});
  relation["leisure"~"^(park|garden)$"](${b});
  way["landuse"~"^(grass|recreation_ground|cemetery|forest|village_green|basin|reservoir)$"](${b});
  way["man_made"~"^(breakwater|pier|groyne)$"](${b});
  way["area:highway"](${b});
  node["natural"="tree"](${b});
  node["place"~"^(suburb|neighbourhood|quarter)$"](${b});
  nwr["tourism"~"^(attraction|museum|hotel)$"](${b});
  nwr["historic"](${b});
  nwr["amenity"~"^(place_of_worship|townhall)$"](${b});
  nwr["man_made"~"^(lighthouse|tower)$"](${b});
  nwr["railway"="station"](${b});
  nwr["name"~"Lotus Tower|Galle Face|Altair|Seema Malaka|Beira Lake|Presidential Secretariat|Independence|Arcade|Racecourse|Race Course|Nelum Pokuna|Premadasa|Sugathadasa|Majestic City|Liberty Plaza|Port City|Cinnamon Life|Floating Market|Kelani|Sambodhi|Kayman|Dewatagaha|Kathiresan|Ponnambala|Wolvendaal|Lucia|Anthony|University of Colombo|BMICH|Bandaranaike Memorial",i](${b});
);
out geom;
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
      mkdirSync(dirname(RAW_FILE), { recursive: true });
      writeFileSync(RAW_FILE, text);
      console.log(`Saved ${json.elements.length} elements (${(text.length / 1e6).toFixed(1)} MB) to ${RAW_FILE}`);
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
