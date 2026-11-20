// Phase 1 map area: Fort, Pettah, Galle Face, Slave Island, Beira Lake, Kollupitiya, Town Hall area.
// The west edge must be open sea: the land mask is filled by scanning from the west edge.
export const BBOX = { south: 6.905, west: 79.82, north: 6.946, east: 79.868 };

// Game origin (0,0,0). Old Colombo Lighthouse clock tower, Chatham Street, Fort.
// Replaced by the OSM position of the clock tower when it is found in the data.
export const ORIGIN_FALLBACK = { lat: 6.93462, lon: 79.84307 };

export const RAW_FILE = 'data/raw/colombo-phase1.osm.json';
export const OUT_FILE = 'public/data/city.json';

// Tier 1 landmarks (PRD 4.5 + a few Tier 2 that fall inside the Phase 1 area).
// `match` is tested against OSM name / name:en. Fallback lat/lon are approximate.
export interface LandmarkDef {
  id: string;
  name: string;
  match: RegExp;
  lat: number;
  lon: number;
  info: string;
}

export const LANDMARKS: LandmarkDef[] = [
  { id: 'lotus', name: 'Lotus Tower', match: /lotus tower|nelum kuluna/i, lat: 6.92706, lon: 79.85825,
    info: 'About 350 m tall and shaped like a lotus bud. Opened in 2019.' },
  { id: 'gallefacegreen', name: 'Galle Face Green', match: /^galle face green$/i, lat: 6.9256, lon: 79.8452,
    info: 'Seafront promenade laid out in 1859 under Governor Sir Henry Ward.' },
  { id: 'oldparliament', name: 'Old Parliament (Presidential Secretariat)', match: /presidential secretariat|old parliament/i, lat: 6.9300, lon: 79.8437,
    info: 'Home of Parliament until 1982, now the Presidential Secretariat. Exterior only.' },
  { id: 'gallefacehotel', name: 'Galle Face Hotel', match: /^galle face hotel$/i, lat: 6.9211, lon: 79.8457,
    info: 'Founded in 1864, one of the oldest hotels in Asia.' },
  { id: 'wtc', name: 'World Trade Center', match: /world trade cent(er|re)/i, lat: 6.9338, lon: 79.8437,
    info: 'Twin 39-storey towers in Fort, completed in 1997.' },
  { id: 'clocktower', name: 'Old Colombo Lighthouse', match: /old colombo lighthouse|clock tower lighthouse|^lighthouse clock tower$/i, lat: 6.93462, lon: 79.84307,
    info: 'Clock tower from 1857 that also worked as a lighthouse until 1952.' },
  { id: 'dutchhospital', name: 'Dutch Hospital', match: /dutch hospital/i, lat: 6.9336, lon: 79.8423,
    info: 'Dutch-era hospital building, thought to be among the oldest in Fort. Now shops and restaurants.' },
  { id: 'fortstation', name: 'Colombo Fort Railway Station', match: /^(colombo )?fort( railway)? station$|^colombo fort$/i, lat: 6.9338, lon: 79.8501,
    info: "Colombo's main railway station, opened in 1917." },
  { id: 'redmosque', name: 'Jami Ul-Alfar Mosque (Red Mosque)', match: /jami.?ul.?alfar|red mosque/i, lat: 6.9387, lon: 79.8538,
    info: 'The red-and-white mosque on Second Cross Street, Pettah, completed in 1909.' },
  { id: 'gangaramaya', name: 'Gangaramaya Temple', match: /gangaramaya/i, lat: 6.9166, lon: 79.8565,
    info: 'Buddhist temple by Beira Lake, founded in the late 1800s.' },
  { id: 'seemamalaka', name: 'Seema Malaka', match: /seema malaka|sima malaka/i, lat: 6.9175, lon: 79.8557,
    info: 'Meditation hall on Beira Lake, designed by Geoffrey Bawa.' },
  { id: 'altair', name: 'Altair', match: /^altair/i, lat: 6.9214, lon: 79.8556,
    info: 'Two residential towers, one leaning against the other.' },
  { id: 'khanclock', name: 'Khan Clock Tower', match: /khan clock tower/i, lat: 6.9358, lon: 79.8530,
    info: "Pettah's clock tower at the top of Main Street." },
  { id: 'townhall', name: 'Colombo Town Hall', match: /^(colombo )?town hall$/i, lat: 6.9165, lon: 79.8632,
    info: 'White domed home of the Colombo Municipal Council, opened in 1928.' },
  { id: 'viharamahadevi', name: 'Viharamahadevi Park', match: /vihara ?maha ?devi/i, lat: 6.9130, lon: 79.8620,
    info: "Colombo's largest park, formerly Victoria Park." },
  { id: 'museum', name: 'National Museum of Colombo', match: /national museum/i, lat: 6.9100, lon: 79.8610,
    info: "Sri Lanka's largest museum, founded in 1877." },
  { id: 'beiralake', name: 'Beira Lake', match: /(?!)/ /* lake centroid is misleading; use fallback */, lat: 6.9230, lon: 79.8530,
    info: 'Lake at the heart of the city, dating back to the Portuguese period.' },
];
