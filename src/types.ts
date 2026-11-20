// Shape of public/data/city.json, produced by scripts/build-city.ts.
// All coordinates are local metres: x = east, z = south (Three.js convention, north is -z).
// Flat number arrays are [x0, z0, x1, z1, ...] rounded to 0.1 m.

export type Flat = number[];

export const ROAD_TYPES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'service',
  'footway',
] as const;
export type RoadType = (typeof ROAD_TYPES)[number];

export interface Road {
  /** index into ROAD_TYPES */
  t: number;
  /** carriageway width in metres */
  w: number;
  n?: string;
  /** one-way: 1 = only in point order, -1 = only against point order */
  o?: 1 | -1;
  p: Flat;
}

export const BUILDING_STYLES = ['plain', 'glass', 'colonial', 'house'] as const;

export interface Building {
  /** outer ring, counter-clockwise when viewed from above (x right, -z up) */
  p: Flat;
  holes?: Flat[];
  /** height in metres */
  h: number;
  /** index into BUILDING_STYLES */
  s: number;
  n?: string;
}

export const AREA_KINDS = ['grass', 'park', 'wood', 'sand', 'paved', 'pitch', 'cemetery'] as const;

export interface Area {
  /** index into AREA_KINDS */
  k: number;
  p: Flat;
  holes?: Flat[];
}

export interface Place {
  n: string;
  x: number;
  z: number;
  /** suburb | neighbourhood | quarter */
  kind: string;
}

export interface Landmark {
  id: string;
  n: string;
  x: number;
  z: number;
  info: string;
  /** true when position came from OpenStreetMap, false when it is a hard-coded fallback */
  osm: boolean;
}

export interface CityData {
  version: 1;
  generated: string;
  source: string;
  origin: { lat: number; lon: number };
  bbox: { south: number; west: number; north: number; east: number };
  /** local-metre bounds of the bbox */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: Road[];
  rails: Flat[];
  buildings: Building[];
  areas: Area[];
  /** natural=coastline polylines; land is on the left of the direction of travel */
  coast: Flat[];
  /** water polygon rings (lakes, river banks, docks); filled with even-odd rule */
  water: Flat[];
  /** rings that are always land (islets, pier/breakwater areas); even-odd rule */
  land: Flat[];
  /** waterway lines without polygons (small canals, streams) */
  waterways: { w: number; p: Flat }[];
  /** breakwaters and piers */
  piers: { w: number; p: Flat }[];
  /** stride 4: x, z, kind (0 = coconut palm, 1 = broadleaf), scale */
  trees: Flat;
  /** how many of `buildings` are generated filler rather than OSM footprints (they come last) */
  fillerCount: number;
  places: Place[];
  landmarks: Landmark[];
  /** coastal line train routes (southbound and northbound) and the stations on them */
  trains?: { routes: Flat[]; stations: { n: string; x: number; z: number }[] };
}
