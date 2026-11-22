# See Colombo

A third-person, open-world walking simulator set in Colombo, Sri Lanka, built from real map data. See [PRD.md](PRD.md) for the full product plan.

**Status: v0.2 "Ride" (tuk-tuk, traffic, pedestrians and the coastal line train).** Map: the whole Colombo Municipal Council area, Colombo 1 to 15, from Mattakkuliya and the Kelani river in the north to Wellawatte in the south, plus the port and Port City (about 8 × 14 km, 88,000 buildings).

## What works

- Real street layout, coastline, Beira Lake, rail lines, parks and trees from OpenStreetMap
- ~5,400 real building footprints, with heights from OSM where tagged (e.g. Altair 240 m, One Galle Face 194 m)
- ~9,200 generated "filler" buildings along streets where OSM has no footprints, so blocks aren't empty
- Procedural Lotus Tower: stepped podium sized to sit clear of the surrounding roads, ribbed green shaft, two layers of lotus petals and an observation deck, with its night light show
- Third-person character: jog, sprint, walk, jump, climb low ledges, collides with buildings and trees, can't walk into the sea or lake. A rigged, skinned 3D body (one smooth mesh with a face, hands and hair; CC0 model by Quaternius) played with real animation clips: idle, walk, jog and sprint blended by speed with the feet matched to your pace, jump take-off and mid-air, jab and cross punches on the upper body only (so you can punch while walking), and a seated driving pose. If `public/models/player.glb` is missing, the game falls back to the older built-from-shapes figure with the player's own face
- Five outfits (O to switch, remembered in the browser): palm shirt and cargos (default), office shirt and trousers, sarong and white shirt, t-shirt and jeans, batik shirt. On the rigged body the clothes are painted on by which bones each part of the skin follows (torso and upper arms = short-sleeved shirt, hips and legs = trousers, feet = shoes), so outfits change colour and print but not shape
- Over-the-shoulder camera that pulls in when a wall is in the way
- Real sun position for Colombo, a full day every 10 real minutes (T for 10x faster), lit windows and shop signboards at night
- Colombo street fronts: low commercial blocks are split into narrow shophouse plots facing the street, each with its own paint colour, a false-front parapet of its own height and often a corrugated sheet or tarp awning over the pavement (deep ones on thin posts). Apartment blocks get balconies with solid or steel-railing fronts on their street sides. Colonial buildings in Fort and Pettah get a columned verandah with a balustrade along the pavement. Buildings over 40 m are modern towers with curtain walls or ribbon windows and a plant-room crown. Flat roofs carry the stairwell head-room box, and split AC units hang under some windows
- Sri Lankan street look: faded pastel and colonial plaster walls with weather stains, clay tile hip roofs on houses and low buildings, roof parapets, floor ledges, blue and black rooftop water tanks, green shutters on colonial buildings, painted shop signboards and window grilles
- Ground detail: patched asphalt, concrete pavement slabs, raised kerbs, white edge lines on main roads, sunburnt grass and red laterite soil
- Lighting: about 4,500 orange sodium street lamps along the roads, lighting the road, pavement, walls, cars and people beneath them through a city-wide light map (light in the world, not glare on the screen); tuk-tuk headlight and glowing head and tail lights on traffic at night; a starry night sky with city glow; a lifted dusk so the street stays readable; soft bloom and a warm colour grade
- Rotating minimap with street names, full-screen map with click-to-fast-travel
- Drive anything: tuk-tuks are parked beside the spawn point and near most landmarks, and you can take any vehicle in traffic (saloon, hatchback, SUV, van, bus, metro bus, motorbike, bicycle, e-scooter). The driver climbs out and runs off; vehicles you leave stay where you left them. Each type has its own speed, acceleration, braking, turning circle and weight: a car does about 110 km/h, a bus is slow to start and wide in the turns, two-wheelers lean into corners, the bicycle has no engine noise, and you stand on the e-scooter. Taking vehicles is off near places of worship
- Traffic on the real road network: tuk-tuks, saloons, Wagon R-style hatchbacks, SUVs, vans, red route buses and white-and-red metro buses (main roads only), motorbikes, bicycles and electric scooters, with riders on the two-wheelers. Vehicles are shaped from side profiles with rounded edges, wheel arches, separate windows, rims, bumpers, mirrors and number plates. Drives on the left, follows one-way streets, keeps a gap to the vehicle ahead, slows at junctions, stops at red traffic lights and honks if you block it. Buses pull in at bus stops
- Street furniture from OpenStreetMap: about 170 bus shelters (and signs where there's no room for one), canopies at bus stations, traffic lights at about 75 signalled junctions and crossings (green, amber, red cycles), and raised platforms with canopies, benches and name boards at the railway stations
- Pedestrians on the pavements, with jointed bodies (knees, elbows, hips) and faces: office workers, men in sarongs, women in sarees, dresses or hijabs, Gen Z groups in hoodies and caps, tourists with sun hats, cameras and backpacks, older people walking slower with a stoop, and school children in white uniforms. Some carry umbrellas, phones or shopping bags. Families, tourist couples, friends and school kids walk together, and scatter together if one of them is hit. They walk, stop and stand by the road, cross side streets, step around you, and jump out of the way of your tuk-tuk. Traffic stops for them. Fewer people are out late at night
- Coastal line trains between Maradana and the south edge of the map, through Colombo Fort, Secretariat Halt, Kompannavidiya, Kollupitiya and Bambalapitiya. Two trains, one each way, on the left-hand track. They stop at every station for 25 seconds, sound the horn when leaving, and stop and sound the horn if you or a car are on the line. Board at any stopped train's door (E), ride standing in the doorway, and get off at any stop
- Fighting and crashes: punch with F or the left mouse button and people are knocked down, lie there, then get up and run off. Hit people with the tuk-tuk at speed and they go down too. Ramming traffic shares momentum by mass: a bicycle or scooter is thrown aside and falls over, a car is shoved and spun, a bus barely moves and stops you dead. Crashed vehicles slide to a halt and then rejoin traffic. None of this works within 120 m of the Red Mosque, Gangaramaya Temple or Seema Malaka (places of worship are exploration only)
- Aircraft overhead: airliners crossing high on the Bandaranaike approach and departure routes, and a lower turboprop, with navigation lights and strobes at night
- Tuk-tuk taxi jobs: while you drive a tuk-tuk, someone nearby steps to the kerb and waves you down (yellow marker, also on the minimap). Stop beside them to pick them up (they sit on the back bench), then drive to the landmark they ask for (a tall yellow beam marks the drop-off) and stop there. You're paid a metered fare (Rs 100 for the first km, then Rs 85 a km) plus a tip of up to 30% for beating the tip time without bumps. Money is saved in the browser. Tap J to skip a fare (a passenger on board gets out unpaid); hold J to turn jobs on or off
- Roads, bridges and causeways are walkable everywhere, so you can walk from Galle Face to the Lotus Tower
- Synthesised sound: tuk-tuk engine, horns, train horn, bumps (N to mute)
- Road and district readout, district banner, landmark cards and a 40-landmark checklist (saved in the browser): Fort and Pettah, Independence Square, the Racecourse, Nelum Pokuna, BMICH, Kotahena's churches and kovils, Wolvendaal Church, the stadiums, the malls on Galle Road, Port City and the Kelani bridge

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

This runs three steps:

1. `npm run data:fetch` downloads the map area (about 40 MB) from the OpenStreetMap Overpass API into `data/raw/` (ignored by git).
2. `npm run data:extras` downloads the bus stops and traffic signals (small) into `data/raw/`.
3. `npm run data:build` converts it to local metres, generates filler buildings and trees, and writes `public/data/city.json`.

Map area, origin and landmark list are in [scripts/config.ts](scripts/config.ts).

### Player model

`public/models/player.glb` (about 1.1 MB) is committed: one rigged body, a hairstyle and the 11 animation clips the game uses. It is built by [scripts/build-player.ts](scripts/build-player.ts) from two free CC0 packs by Quaternius, which aren't in the repo: [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) (the free "Standard" downloads).

```powershell
npm run model -- --anims "<path>\AnimationLibrary_Godot_Standard.glb" --body "<path>\Superhero_Male_FullBody.gltf" --part "<path>\Hair_SimpleParted.gltf"
```

The script keeps only the needed clips, maps the animation bones (Rigify `DEF-` names) onto the body's Unreal-style names (`pelvis`, `upperarm_l`, ...), merges the hair onto the body's skeleton, and shrinks textures to 1K WebP. To use your own character, rig it to either bone naming scheme and pass it as `--body`. Clip names the game looks for are listed in [src/player/riggedCharacter.ts](src/player/riggedCharacter.ts). Credits are in [public/models/CREDITS.txt](public/models/CREDITS.txt).

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Z | Auto-run or cruise: keep moving forward without holding W, so a laptop touchpad keeps working for looking around. S stops it |
| Mouse or arrow keys | Look (arrows let you turn the camera while moving on a touchpad) |
| F or left mouse | Punch |
| Shift | Sprint |
| C or Ctrl | Walk |
| Space | Jump (hold into a low wall to climb it) |
| Mouse wheel | Camera distance |
| M | Map (drag, zoom, click to fast travel) |
| T | Toggle fast time |
| [ / ] | Back / forward one hour |
| Enter (or E) | Get in or out of a vehicle (when nearly stopped), take one from traffic; board or leave a train when it is stopped |
| W / S | Throttle / brake and reverse (driving) |
| A / D | Steer (driving) |
| Space | Brake (driving) |
| Q | Horn |
| J | Tap: skip the current taxi fare. Hold: taxi jobs on or off |
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
  build-player.ts   rigged body + hair + animation clips -> public/models/player.glb
src/
  types.ts          city.json format (shared by scripts and game)
  main.ts           game setup and main loop
  world/            ground, water, roads, buildings, trees, Lotus Tower, sky/sun, collision, land mask
  player/           input, rigged character (riggedCharacter.ts) and the fallback shape figure, movement, camera
  game/             tuk-tuk taxi jobs
  traffic/          road graph, vehicle models, traffic simulation
  people/           pedestrian models (shader-animated) and simulation
  trains/           coastal line trains: timetable, station stops, boarding
  audio.ts          synthesised engine, horn and bump sounds
  ui/               minimap, full map, HUD
public/data/city.json   generated map (about 9.6 MB)
public/models/player.glb  rigged player body, hair and animations (about 1.1 MB, CC0)
```

## Coordinates

1 unit = 1 metre. Origin (0, 0, 0) is the Old Colombo Lighthouse clock tower on Chatham Street, Fort. +x is east, +z is south (north is -z).

A debug handle is available in the browser console: `seeColombo.travel(x, z)`, `seeColombo.setTime(hour)`, `seeColombo.player.pos`, `seeColombo.traffic.agents`, `seeColombo.peds.peds`, `seeColombo.trains.trains`, `seeColombo.furniture.stats`.

## Known limitations

- The player model is a placeholder: the free Quaternius "Superhero" base body (athletic build, stylised face), not a likeness of the player. Clothes are painted onto the skin, so a sarong has the same shape as trousers and shirts are skin-tight. A model of your own can replace it (see "Player model" above).
- The rigged body has no facial animation (no blinking or talking) and no separate pose for handlebars or a car seat; every vehicle uses the same driving pose.
- Filler buildings are guesses. They follow streets but won't match real buildings.
- Building heights without OSM tags are estimated from footprint size and area.
- Ground is flat (Colombo is mostly 0 to 10 m). Elevation data is planned for v0.3.
- No swimming yet (v0.3).
- Train routes come from OSM. Where OSM maps the double track as one line, the build step draws a second track 3.8 m away so trains in each direction have their own. Trains leave the map at the south edge and come back about a minute later.
- Only the coastal line runs. The Main Line and Kelani Valley Line tracks are drawn but have no trains.
- Crashes are arcade physics: no damage, no injuries shown, and traffic vehicles don't crash into each other on their own. The no-fighting zone covers the places of worship in the landmark list (mosques, temples, churches and kovils); smaller ones elsewhere in the city are not covered yet.
- Pedestrians are built from simple shapes in code (no downloaded models) and cross wherever their path takes them (no zebra crossings yet). They walk through trees and lamp posts.
- Traffic lights are placed from OSM signal nodes; junctions OSM doesn't tag have none. Pedestrians don't wait for the lights yet. Vehicles stuck in a gridlock for 7 seconds (not at a red light) pass through each other to clear it.
- The metro bus copies the colours of the Lanka Metro Transit buses but not their logo.
- Traffic only exists within about 300 m of you; it spawns out of view and despawns behind you.
- The character sits the same way in every vehicle (no separate pose for a car seat or handlebars), and there are no doors opening or exit animations.
- On integrated graphics (e.g. Intel Iris Xe) the game starts on Low quality: 1x resolution, FXAA instead of multisampling, smaller shadow map. Distant people, trees and street furniture are drawn simpler and without shadows, which keeps a typical frame around 300 draw calls and 2.2M triangles. Expect 30 to 60 fps there; press G for High on a stronger GPU.
- The map file (public/data/city.json, 9 MB, about 3 MB compressed) is loaded in one go at start; it is not streamed yet.
- Lamp light is painted at about 2.5 m per pixel, so pools are soft rather than sharp-edged.
- Buildings are still built from OSM footprints, so a whole block mapped as one footprint is split into shop plots only along its street side. Awnings, verandah columns and balconies are visual only (you walk through the posts). Building shapes come from OSM alone; better footprints and heights (Overture, Google Open Buildings) would need a data download.
- Dewatagaha Mosque and Kayman's Gate are not mapped in OSM by name, so their landmark points are placed by hand and are approximate. Port City is mostly unbuilt in OSM.
- Independence Memorial Hall and the other new landmarks are OSM footprints with the usual procedural styling, not hand-made models.
- Buildings are built in full detail within about 500 m of you; further away each one is a plain box with a window pattern, so detail pops in as you move. Fast travel builds the nearest blocks first.

## Deployment

The game is a static site (`npm run build` outputs `dist/`). Any static host works (Vercel, Netlify, GitHub Pages, Cloudflare Pages). It uses no user data and needs no environment variables; see [.env.example](.env.example).

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL). The attribution is shown in-game and must stay visible.
