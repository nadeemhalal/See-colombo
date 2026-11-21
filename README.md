# See Colombo

A third-person, open-world walking simulator set in Colombo, Sri Lanka, built from real map data. See [PRD.md](PRD.md) for the full product plan.

**Status: v0.2 "Ride" (tuk-tuk, traffic, pedestrians and the coastal line train).** Phase 1 map: Fort, Pettah, Galle Face, Slave Island, Beira Lake, Kollupitiya and the Town Hall area (about 5.3 × 4.5 km).

## What works

- Real street layout, coastline, Beira Lake, rail lines, parks and trees from OpenStreetMap
- ~5,400 real building footprints, with heights from OSM where tagged (e.g. Altair 240 m, One Galle Face 194 m)
- ~9,200 generated "filler" buildings along streets where OSM has no footprints, so blocks aren't empty
- Procedural Lotus Tower: stepped podium sized to sit clear of the surrounding roads, ribbed green shaft, two layers of lotus petals and an observation deck, with its night light show
- Third-person character: jog, sprint, walk, jump, climb low ledges, collides with buildings and trees, can't walk into the sea or lake. Jointed figure with the player's own face (a portrait texture projected onto the head), short curly hair, a navy palm-print shirt, khaki cargo trousers, white trainers and a wristwatch. Walk and run cycles with knee and ankle motion, hip sway, arm swing, leaning into turns, landing squash, and looking around when idle
- Five outfits (O to switch, remembered in the browser): palm shirt and cargos (default), office shirt and trousers, sarong and white shirt, t-shirt and jeans, batik shirt
- Over-the-shoulder camera that pulls in when a wall is in the way
- Real sun position for Colombo, a full day every 10 real minutes (T for 10x faster), lit windows and shop signboards at night
- Sri Lankan street look: faded pastel and colonial plaster walls with weather stains, clay tile hip roofs on houses and low buildings, roof parapets, floor ledges, blue and black rooftop water tanks, green shutters on colonial buildings, painted shop signboards and window grilles
- Ground detail: patched asphalt, concrete pavement slabs, raised kerbs, white edge lines on main roads, sunburnt grass and red laterite soil
- Lighting: about 4,500 orange sodium street lamps along the roads, lighting the road, pavement, walls, cars and people beneath them through a city-wide light map (light in the world, not glare on the screen); tuk-tuk headlight and glowing head and tail lights on traffic at night; a starry night sky with city glow; a lifted dusk so the street stays readable; soft bloom and a warm colour grade
- Rotating minimap with street names, full-screen map with click-to-fast-travel
- Drivable tuk-tuks: one beside the spawn point and one parked on the kerb near most landmarks. Arcade handling, reverse, brake, body lean, horn
- Traffic on the real road network: tuk-tuks, cars, vans, red buses (main roads only), motorbikes, bicycles and electric scooters. Drives on the left, follows one-way streets, keeps a gap to the vehicle ahead, slows at junctions and honks if you block it
- Pedestrians on the pavements: men in trousers or sarongs, women in sarees, school children in white uniforms. They walk, stop and stand by the road, cross side streets, step around you, and jump out of the way of your tuk-tuk. Traffic stops for them. Fewer people are out late at night
- Coastal line trains between Maradana and the south edge of the map, through Colombo Fort, Secretariat Halt, Kompannavidiya and Kollupitiya. Two trains, one each way, on the left-hand track. They stop at every station for 25 seconds, sound the horn when leaving, and stop and sound the horn if you or a car are on the line. Board at any stopped train's door (E), ride standing in the doorway, and get off at any stop
- Fighting and crashes: punch with F or the left mouse button and people are knocked down, lie there, then get up and run off. Hit people with the tuk-tuk at speed and they go down too. Ramming traffic shares momentum by mass: a bicycle or scooter is thrown aside and falls over, a car is shoved and spun, a bus barely moves and stops you dead. Crashed vehicles slide to a halt and then rejoin traffic. None of this works within 120 m of the Red Mosque, Gangaramaya Temple or Seema Malaka (places of worship are exploration only)
- Aircraft overhead: airliners crossing high on the Bandaranaike approach and departure routes, and a lower turboprop, with navigation lights and strobes at night
- Roads, bridges and causeways are walkable everywhere, so you can walk from Galle Face to the Lotus Tower
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
| WASD | Move |
| Mouse or arrow keys | Look (arrows let you turn the camera while moving on a touchpad) |
| F or left mouse | Punch |
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
| O | Change outfit |
| G | Graphics quality: High or Low (Low is picked automatically on integrated graphics) |
| H | Show controls |
| Esc | Pause and resume. Any key starts the game; no clicking needed |

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

- The character is still made from simple shapes. The face is a photo projected from the front, so it looks right from the front and fades to plain skin at the sides; it does not move (no blinking or talking). A rigged, sculpted model would look more realistic but needs a licensed or commissioned asset.
- Filler buildings are guesses. They follow streets but won't match real buildings.
- Building heights without OSM tags are estimated from footprint size and area.
- Ground is flat (Colombo is mostly 0 to 10 m). Elevation data is planned for v0.3.
- No swimming yet (v0.3).
- Train routes come from OSM. Where OSM maps the double track as one line, the build step draws a second track 3.8 m away so trains in each direction have their own. Trains leave the map at the south edge and come back about a minute later.
- Only the coastal line runs. The Main Line and Kelani Valley Line tracks are drawn but have no trains.
- Crashes are arcade physics: no damage, no injuries shown, and traffic vehicles don't crash into each other on their own. St Anthony's Shrine and the Hindu kovils have no landmark entry yet, so the no-fighting zone only covers the Red Mosque, Gangaramaya and Seema Malaka.
- Pedestrians use simple shapes and cross wherever their path takes them (no zebra crossings yet). They walk through trees and lamp posts.
- No traffic lights. Vehicles stuck in a gridlock for 7 seconds pass through each other to clear it.
- Traffic only exists within about 300 m of you; it spawns out of view and despawns behind you.
- Only tuk-tuks can be driven. Traffic vehicles can't be entered.
- On integrated graphics (e.g. Intel Iris Xe) the game starts on Low quality: 1x resolution, FXAA instead of multisampling, smaller shadow map. Expect roughly 30 fps there; press G for High on a stronger GPU.
- Lamp light is painted at about 2.5 m per pixel, so pools are soft rather than sharp-edged.
- Buildings are still extruded footprints with shader detail. There are no balconies, verandah pillars or modelled shopfronts yet.
- Only Phase 1 of the map. Areas south of Kollupitiya and east of Town Hall are not included yet.

## Deployment

The game is a static site (`npm run build` outputs `dist/`). Host it only on the company Vercel team account. It uses no user data and needs no environment variables; see [.env.example](.env.example).

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL). The attribution is shown in-game and must stay visible.
