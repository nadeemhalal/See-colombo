# See Colombo

A third-person, open-world walking simulator set in Colombo, Sri Lanka, built from real map data. See [PRD.md](PRD.md) for the full product plan.

**Status: v0.2 "Ride" (tuk-tuk, traffic, pedestrians and the coastal line train).** Phase 1 map: Fort, Pettah, Galle Face, Slave Island, Beira Lake, Kollupitiya and the Town Hall area (about 5.3 × 4.5 km).

## What works

- Real street layout, coastline, Beira Lake, rail lines, parks and trees from OpenStreetMap
- ~5,400 real building footprints, with heights from OSM where tagged (e.g. Altair 240 m, One Galle Face 194 m)
- ~9,200 generated "filler" buildings along streets where OSM has no footprints, so blocks aren't empty
- Procedural Lotus Tower (with its night light show)
- Third-person character: jog, sprint, walk, jump, climb low ledges, collides with buildings and trees, can't walk into the sea or lake
- Over-the-shoulder camera that pulls in when a wall is in the way
- Real sun position for Colombo, day/night cycle, lit windows and shop signboards at night
- Rotating minimap with street names, full-screen map with click-to-fast-travel
- Drivable tuk-tuks: one beside the spawn point and one parked on the kerb near most landmarks. Arcade handling, reverse, brake, body lean, horn
- Traffic on the real road network: tuk-tuks, cars, vans, red buses (main roads only) and motorbikes. Drives on the left, follows one-way streets, keeps a gap to the vehicle ahead, slows at junctions and honks if you block it
- Pedestrians on the pavements: men in trousers or sarongs, women in sarees, school children in white uniforms. They walk, stop and stand by the road, cross side streets, step around you, and jump out of the way of your tuk-tuk. Traffic stops for them. Fewer people are out late at night
- Coastal line trains between Maradana and the south edge of the map, through Colombo Fort, Secretariat Halt, Kompannavidiya and Kollupitiya. Two trains, one each way, on the left-hand track. They stop at every station for 25 seconds, sound the horn when leaving, and stop and sound the horn if you or a car are on the line. Board at any stopped train's door (E), ride standing in the doorway, and get off at any stop
- Synthesised sound: tuk-tuk engine, horns, train horn, bumps (N to mute)
- Road and district readout, district banner, landmark cards and a 17-landmark checklist (saved in the browser)

## Setup

Requires Node.js 20+ and npm.

```powershell
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173) and click to play.

The generated map file `public/data/city.json` is committed, so you don't need to download map data to run the game.

### Rebuilding the map data

```powershell
npm run data
```

This runs two steps:

1. `npm run data:fetch` downloads the Phase 1 area from the OpenStreetMap Overpass API into `data/raw/` (ignored by git).
2. `npm run data:build` converts it to local metres, generates filler buildings and trees, and writes `public/data/city.json`.

Map area, origin and landmark list are in [scripts/config.ts](scripts/config.ts).

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Look |
| Shift | Sprint |
| C or Ctrl | Walk |
| Space | Jump (hold into a low wall to climb it) |
| Mouse wheel | Camera distance |
| M | Map (drag, zoom, click to fast travel) |
| T | Toggle fast time |
| [ / ] | Back / forward one hour |
| E | Get in / out of a tuk-tuk (when nearly stopped); board or leave a train when it is stopped |
| W / S | Throttle / brake and reverse (driving) |
| A / D | Steer (driving) |
| Space | Brake (driving) |
| Q | Horn |
| N | Mute sound |
| R | Back to Galle Face Green |
| H | Show controls |
| Esc | Pause |

## Project layout

```
scripts/            map data pipeline (Node, run with tsx)
  config.ts         map area, origin, landmark list
  fetch-osm.ts      Overpass download
  build-city.ts     OSM -> city.json, filler buildings, trees, landmarks
src/
  types.ts          city.json format (shared by scripts and game)
  main.ts           game setup and main loop
  world/            ground, water, roads, buildings, trees, Lotus Tower, sky/sun, collision, land mask
  player/           input, character model and animation, movement, camera
  traffic/          road graph, vehicle models, traffic simulation
  people/           pedestrian models (shader-animated) and simulation
  trains/           coastal line trains: timetable, station stops, boarding
  audio.ts          synthesised engine, horn and bump sounds
  ui/               minimap, full map, HUD
public/data/city.json   generated map (about 2 MB)
```

## Coordinates

1 unit = 1 metre. Origin (0, 0, 0) is the Old Colombo Lighthouse clock tower on Chatham Street, Fort. +x is east, +z is south (north is -z).

A debug handle is available in the browser console: `seeColombo.travel(x, z)`, `seeColombo.setTime(hour)`, `seeColombo.player.pos`, `seeColombo.traffic.agents`, `seeColombo.peds.peds`, `seeColombo.trains.trains`.

## Known limitations

- The character is built from simple shapes with code-driven animation. A rigged, animated model is the next visual upgrade.
- Filler buildings are guesses. They follow streets but won't match real buildings.
- Building heights without OSM tags are estimated from footprint size and area.
- Ground is flat (Colombo is mostly 0 to 10 m). Elevation data is planned for v0.3.
- No swimming yet (v0.3).
- Train routes come from OSM. Where OSM maps the double track as one line, the build step draws a second track 3.8 m away so trains in each direction have their own. Trains leave the map at the south edge and come back about a minute later.
- Only the coastal line runs. The Main Line and Kelani Valley Line tracks are drawn but have no trains.
- Pedestrians use simple shapes and cross wherever their path takes them (no zebra crossings yet). They walk through trees and lamp posts.
- No traffic lights. Vehicles stuck in a gridlock for 7 seconds pass through each other to clear it.
- Traffic only exists within about 300 m of you; it spawns out of view and despawns behind you.
- Only tuk-tuks can be driven. Traffic vehicles can't be entered.
- Only Phase 1 of the map. Areas south of Kollupitiya and east of Town Hall are not included yet.

## Deployment

The game is a static site (`npm run build` outputs `dist/`). Host it only on the company Vercel team account. It uses no user data and needs no environment variables; see [.env.example](.env.example).

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL). The attribution is shown in-game and must stay visible.
