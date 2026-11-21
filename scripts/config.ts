// Map area: the whole Colombo Municipal Council area, Colombo 1 to 15. Mattakkuliya and the Kelani
// river mouth in the north, Wellawatte canal in the south, Kirulapone, Narahenpita and the Kolonnawa
// canal in the east, plus the port and Port City to the west.
// The west edge must be open sea: the land mask is filled by scanning from the west edge.
export const BBOX = { south: 6.86, west: 79.82, north: 6.985, east: 79.893 };

// Game origin (0,0,0). Old Colombo Lighthouse clock tower, Chatham Street, Fort.
// Replaced by the OSM position of the clock tower when it is found in the data.
export const ORIGIN_FALLBACK = { lat: 6.93462, lon: 79.84307 };

export const RAW_FILE = 'data/raw/colombo-city.osm.json';
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
  { id: 'independencehall', name: 'Independence Memorial Hall', match: /independence (memorial )?hall/i, lat: 6.9040, lon: 79.8676,
    info: 'Built for the ceremonial opening of Parliament after independence in 1948, modelled on a Kandyan royal audience hall.' },
  { id: 'arcade', name: 'Arcade Independence Square', match: /arcade independence/i, lat: 6.9032, lon: 79.8687,
    info: 'Restored colonial buildings, once a lunatic asylum and auditors\' offices, now shops and cafes.' },
  { id: 'wolvendaal', name: 'Wolvendaal Church', match: /wolvendaal/i, lat: 6.9418, lon: 79.8590,
    info: 'Dutch Reformed church completed in 1757, one of the oldest Protestant churches in the country.' },
  { id: 'stanthonys', name: "St. Anthony's Shrine, Kochchikade", match: /st\.? ?anthony'?s (shrine|church)/i, lat: 6.9466, lon: 79.8565,
    info: 'Catholic shrine visited by people of every faith. Rebuilt after the 2019 Easter Sunday attack.' },
  { id: 'stlucias', name: "St. Lucia's Cathedral", match: /st\.? ?lucia('?s)? (cathedral|church)/i, lat: 6.9481, lon: 79.8645,
    info: 'The largest church in Sri Lanka, in Kotahena, completed in 1906.' },
  { id: 'ponnambalavaneswaram', name: 'Sri Ponnambalavaneswaram Kovil', match: /ponnambala/i, lat: 6.9476, lon: 79.8637,
    info: 'Hindu temple in Kotahena built in granite in the early 1900s.' },
  { id: 'kathiresan', name: 'New Kathiresan Kovil', match: /new kathiresan|kathiresan kovil/i, lat: 6.8925, lon: 79.8560,
    info: 'Hindu temple on Galle Road, Bambalapitiya, starting point of the Vel festival procession.' },
  { id: 'dewatagaha', name: 'Dewatagaha Mosque', match: /dewatagaha/i, lat: 6.9160, lon: 79.8612,
    info: 'Mosque and shrine opposite Town Hall, more than a century old.' },
  { id: 'sambodhi', name: 'Sambodhi Chaithya', match: /sambodhi/i, lat: 6.9424, lon: 79.8457,
    info: 'Stupa raised on arches above the road near the port, built in 1956.' },
  { id: 'kaymansgate', name: "Kayman's Gate", match: /kayman/i, lat: 6.9384, lon: 79.8555,
    info: 'A Dutch-era belfry in Pettah that marked the old gate to the fort.' },
  { id: 'dutchmuseum', name: 'Dutch Period Museum', match: /dutch (period |colonial )?museum/i, lat: 6.9375, lon: 79.8510,
    info: 'A 17th-century Dutch townhouse on Prince Street, Pettah.' },
  { id: 'floatingmarket', name: 'Pettah Floating Market', match: /floating market/i, lat: 6.9330, lon: 79.8545,
    info: 'Market stalls on walkways over Beira Lake beside the bus stand.' },
  { id: 'cinnamonlife', name: 'Cinnamon Life', match: /cinnamon life/i, lat: 6.9285, lon: 79.8478,
    info: 'Hotel, homes and shops on the lakefront in Slave Island, opened in 2024.' },
  { id: 'portcity', name: 'Port City Colombo', match: /(?!)/ /* no single OSM feature: centre of the reclaimed land */, lat: 6.9385, lon: 79.8335,
    info: 'New land reclaimed from the sea west of Fort and Galle Face.' },
  { id: 'premadasa', name: 'R. Premadasa Stadium', match: /premadasa (international )?(cricket )?stadium|khettarama/i, lat: 6.9395, lon: 79.8722,
    info: 'International cricket ground in Maligawatte, seating about 35,000.' },
  { id: 'sugathadasa', name: 'Sugathadasa Stadium', match: /sugathadasa/i, lat: 6.9556, lon: 79.8700,
    info: 'Athletics stadium near the Kelani river, built for the 1991 South Asian Games.' },
  { id: 'racecourse', name: 'Colombo Racecourse', match: /race ?course/i, lat: 6.9066, lon: 79.8613,
    info: 'Former horse racing track from the 1890s, now a rugby ground and shopping arcade.' },
  { id: 'nelumpokuna', name: 'Nelum Pokuna Theatre', match: /nelum pokuna/i, lat: 6.9110, lon: 79.8635,
    info: 'Performing arts theatre shaped like a lotus pond, opened in 2011.' },
  { id: 'bmich', name: 'BMICH', match: /bandaranaike memorial international|bmich/i, lat: 6.9020, lon: 79.8725,
    info: 'Bandaranaike Memorial International Conference Hall, opened in 1973.' },
  { id: 'unicolombo', name: 'University of Colombo', match: /^university of colombo$/i, lat: 6.9020, lon: 79.8605,
    info: 'The oldest university in Sri Lanka, in Cinnamon Gardens.' },
  { id: 'libertyplaza', name: 'Liberty Plaza', match: /liberty plaza/i, lat: 6.9115, lon: 79.8512,
    info: 'One of the first shopping malls in Colombo, in Kollupitiya.' },
  { id: 'majesticcity', name: 'Majestic City', match: /majestic city/i, lat: 6.8937, lon: 79.8553,
    info: 'Shopping mall on Galle Road, Bambalapitiya, opened in the 1980s.' },
  { id: 'kelanibridge', name: 'Kelani Bridge', match: /kelani.*bridge|kelaniya bridge/i, lat: 6.9585, lon: 79.8795,
    info: 'Road bridges over the Kelani river at the north edge of the city.' },
  { id: 'beiralake', name: 'Beira Lake', match: /(?!)/ /* lake centroid is misleading; use fallback */, lat: 6.9230, lon: 79.8530,
    info: 'Lake at the heart of the city, dating back to the Portuguese period.' },
];
