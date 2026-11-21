# PRD: See Colombo (working title)

**A third-person, open-world walking and driving simulator set in a geographically accurate Colombo, Sri Lanka.**

| | |
|---|---|
| Status | Engine decided: Web (Option A). v0.1 "Walk Colombo" first playable built 20 Nov 2026. See README.md. |
| Date | 20 Nov 2026 |
| Owner | Nadeem |
| Genre reference | Open-world third-person (GTA-style controls and camera). Original game: no GTA names, art, UI, logos or music. |

---

## 1. Summary

The player is one character dropped into Colombo. They can walk, run, jump, climb small ledges, and later ride or drive a tuk-tuk through the real street layout. The city is built from real map data, so Galle Road runs where Galle Road runs, Beira Lake has the right shape, and the Lotus Tower is where you'd expect it when you look up from Fort.

The first version is about **exploration and recognition**: "that's the road to my office", "that's the Red Mosque", "I can walk from Galle Face to Pettah". Missions, traffic and crowds come after the city itself feels right.

## 2. Goals and non-goals

**Goals**
1. Colombo's layout is correct: roads, coastline, lake, rail lines, landmarks within a few metres of real positions.
2. Smooth third-person movement that feels good (walk, sprint, jump, fall, land, ledge climb).
3. Recognisable atmosphere: tropical light, ocean, three-wheelers, red buses, trilingual signboards, monsoon rain.
4. Runs on a normal laptop.

**Non-goals for v1**
- Crime, weapons, police chases or combat.
- Multiplayer.
- Interiors (except maybe one or two showcase buildings).
- Photogrammetry-level realism (see section 7 for the path to that).
- Mobile.

## 3. Target players

- Sri Lankans at home and abroad who want to "walk" Colombo.
- Tourists planning a trip.
- People who like open-world exploration games and want a South Asian setting they rarely see.

## 4. Colombo geography to model

The game uses real-world coordinates, converted to metres from a fixed origin (1 game unit = 1 metre). Proposed origin: **Old Colombo Lighthouse clock tower, Chatham Street, Fort (approx. 6.9346 N, 79.8430 E)**. All coordinates below are approximate and get replaced by OpenStreetMap values in the data pipeline.

### 4.1 Physical shape
- **Coastline:** Indian Ocean along the entire west edge, running roughly north–south.
- **Port of Colombo:** north of Fort, breakwaters and container terminals (background, no access).
- **Port City Colombo:** reclaimed land west of Fort and Galle Face. Partly built; modelled as roads, park and a few towers.
- **Beira Lake:** the irregular lake between Fort, Slave Island and Kollupitiya. Seema Malaka sits on it near Gangaramaya.
- **Kelani River:** northern edge of the city, meeting the sea at Mutwal/Modara.
- **Canals:** Wellawatte canal, Dehiwala canal and the canal network inland (St Sebastian's, etc.).
- **Terrain:** almost flat, 0 to about 10 m above sea level, with a slight rise around Hulftsdorp/Wolvendaal. Use a real elevation model so small slopes are still correct.

### 4.2 Districts (postal zones)
| Zone | Area | Character in game |
|---|---|---|
| Colombo 1 | Fort | Colonial buildings, WTC, Bank of Ceylon tower, Dutch Hospital, Fort station, security zones |
| Colombo 2 | Slave Island / Union Place | Beira Lake edge, Cinnamon Life, mixed old and new |
| Colombo 3 | Kollupitiya | Galle Road commercial strip, Galle Face, Liberty Plaza |
| Colombo 4 | Bambalapitiya | Galle Road, Majestic City, coastal rail line |
| Colombo 5 | Havelock Town / Kirulapone | Residential, Havelock Road |
| Colombo 6 | Wellawatte | Dense, busy, coastal, canal |
| Colombo 7 | Cinnamon Gardens | Wide leafy roads, Independence Square, Viharamahadevi Park, Town Hall, museum |
| Colombo 8 | Borella | Junction traffic, Kanatte cemetery, hospitals |
| Colombo 9 & 10 | Dematagoda, Maradana | Rail yards, Maradana station, dense housing |
| Colombo 11 | Pettah | Markets, tightly packed shops, Red Mosque, Khan Clock Tower, bus stands, floating market |
| Colombo 12 | Hulftsdorp | Courts, Wolvendaal Church |
| Colombo 13 | Kotahena | St Lucia's Cathedral, St Anthony's Shrine |
| Colombo 14 & 15 | Grandpass, Mutwal, Modara, Mattakkuliya | Port edge, Kelani River |

### 4.3 Roads the player must recognise
- **Galle Road (A2):** the coastal spine, from Fort south through Kollupitiya, Bambalapitiya, Wellawatte.
- **Marine Drive:** along the sea, west of the rail line, Kollupitiya to Wellawatte.
- **Duplication Road (R. A. de Mel Mawatha):** parallel to Galle Road, inland.
- **Baseline Road:** the eastern ring, Kelaniya bridge area down to Borella and beyond.
- **D. R. Wijewardena Mawatha, Olcott Mawatha, Main Street (Pettah), York Street, Chatham Street.**
- **Union Place, Sir James Peiris Mawatha, Dharmapala Mawatha, Bauddhaloka Mawatha, Ward Place, Horton Place, Independence Avenue.**
- **High Level Road (A4), Havelock Road.**
- Left-hand traffic everywhere.

### 4.4 Rail
- **Coastal line:** Fort → Kollupitiya → Bambalapitiya → Wellawatte, running right next to the sea. Trains on this line are a strong visual and should come early.
- **Main line:** Fort → Maradana → north-east.
- **Kelani Valley line** from Maradana eastwards (later).

### 4.5 Landmarks (hand-tuned models or improved procedural versions)
Tier 1 (v0.1):
1. Lotus Tower (about 350 m, Beira Lake area)
2. Galle Face Green and promenade
3. Old Parliament / Presidential Secretariat (exterior only, see section 9)
4. Galle Face Hotel
5. World Trade Center twin towers and Bank of Ceylon tower
6. Old Colombo Lighthouse clock tower
7. Dutch Hospital
8. Fort railway station
9. Jami Ul-Alfar (Red Mosque), Pettah
10. Gangaramaya Temple and Seema Malaka on Beira Lake
11. Altair (leaning tower) and Cinnamon Life
12. One Galle Face / Shangri-La / ITC Ratnadipa skyline

Tier 2 (later): Independence Memorial Hall, Town Hall, Viharamahadevi Park, National Museum, Khan Clock Tower, Wolvendaal Church, St Lucia's Cathedral, Majestic City, R. Premadasa Stadium, Port City, Kelani bridge.

### 4.6 Map phases
| Phase | Area | Approx. size |
|---|---|---|
| v0.1 | Fort, Pettah, Galle Face, Slave Island, Beira Lake, north Kollupitiya | about 5 km² |
| v0.3 | + Kollupitiya, Bambalapitiya, Cinnamon Gardens, Borella | about 15 km² |
| v1.0 | Whole Colombo Municipal Council area (Colombo 1–15) | about 37 km² |
| Later | Dehiwala-Mount Lavinia, Rajagiriya, Kotte | |

## 5. Gameplay features

### 5.1 Movement (v0.1)
| Action | Default key (PC) | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Look / camera | Mouse or arrow keys | Right stick |
| Punch | F / left mouse | X / Square |
| Sprint | Shift | L3 / hold |
| Jump | Space | A / Cross |
| Crouch / walk slow | C / Ctrl | B / Circle |
| Interact / enter vehicle | E | Y / Triangle |
| Map | M | Back / Touchpad |
| Pause / resume | Esc (any key starts; no click needed) | Start |

Requirements:
- Third-person camera behind the shoulder, collides with walls, zooms in tight spaces (Pettah lanes).
- Walk ~1.4 m/s, jog ~3.5 m/s, sprint ~6 m/s. Jump ~1 m high. Can step up kerbs and stairs without jumping; can climb ledges up to ~1.5 m.
- Falling, landing and stumble animations. No fall death in v0.1 (respawn on the ground).
- Swimming in the sea and Beira Lake: v0.3. Before that, invisible barriers at the water's edge.

### 5.2 Vehicles (v0.2)
- **Tuk-tuk** first: enter, drive, exit, horn, simple arcade handling.
- Then motorbike, car, and riding (not driving) a red bus or the coastal train.

### 5.3 World life (v0.2 to v0.4)
- Pedestrians walking on pavements, waiting at bus stops, crossing at junctions.
- Traffic following lanes on real roads: tuk-tuks, buses, vans, cars, bikes.
- Street dogs and crows.
- Day/night cycle tied to real Colombo sun position (with time-of-day override). One game day lasts 10 real minutes. Street lights and lit windows at night.
- Weather: clear, humid haze, afternoon monsoon downpour with wet roads.
- Ambient sound: traffic, horns, sea, rail, call to prayer and temple bells at appropriate places and times, kept respectful.

### 5.4 Discovery and progression (v0.3)
- **"See Colombo" landmark checklist:** visit landmarks to unlock a short fact card about each one.
- Fast travel between discovered landmarks.
- Teleport-to-coordinate debug tool (enter lat/long, land there).
- Optional light tasks later: deliver a parcel by tuk-tuk, catch the train to Wellawatte, find a food stall.

### 5.5 UI
- Minimap (bottom left) drawn from the same road data, with real street names in English (Sinhala/Tamil labels later).
- Full-screen map with zoom and waypoint.
- Location banner when entering a district ("Pettah, Colombo 11").
- Settings: graphics quality, mouse sensitivity, invert Y, key rebinding, volume.

## 6. Building the city from real data

### 6.1 Sources
| Data | Source | License / note |
|---|---|---|
| Roads, buildings, water, rail, parks, POIs, names | OpenStreetMap (Geofabrik Sri Lanka extract) | ODbL. Must show "© OpenStreetMap contributors" in the game credits and loading screen. |
| Elevation | Copernicus GLO-30 DEM (or SRTM) | Free with attribution |
| Sky / lighting | Poly Haven HDRIs | CC0 |
| Textures | Poly Haven, ambientCG | CC0 |
| Generic props, vehicles, people | Quaternius, Kenney (CC0); Mixamo for character animation | Check each license; Mixamo needs an Adobe account |
| Reference photos for landmarks | Own photos, Mapillary (CC-BY-SA), Street View for visual reference only (not copied into the game) | |

### 6.2 Pipeline (offline build step, not at runtime)
1. Download Sri Lanka OSM extract, clip to the phase boundary.
2. Convert lat/long to local metres around the origin.
3. Roads: build road meshes from centrelines and lane counts, add pavements, kerbs, junctions, road markings.
4. Buildings: extrude footprints. Height from `height` or `building:levels` tags, otherwise estimate from building type and district (Pettah shophouses 2–4 floors, Galle Road 3–8, residential 1–2). Roof and facade style picked per district so Fort looks colonial and Wellawatte looks dense.
5. Water, parks, rail: from OSM polygons and lines.
6. Ground height: sample the DEM.
7. Cut into 250 m × 250 m tiles with 3 levels of detail, compressed (glTF + Draco/Meshopt, KTX2 textures).
8. Landmarks: swap the procedural box for a hand-built model at the same position.

### 6.3 Known data gaps
- Building heights in Colombo OSM are often missing, so many will be estimates.
- Pettah and other dense areas have merged or missing footprints; may need manual fixes or filler buildings.
- Recently finished towers and Port City change often; pick a data snapshot date and stick to it.

## 7. Technology choice

**Decided 20 Nov 2026: Option A (web).** The data pipeline stays engine-neutral (`public/data/city.json`) so the city can move to Option B later. v0.1 uses Vite + TypeScript + Three.js with custom collision; Rapier physics is deferred to v0.2 for vehicles.

### Option A (recommended start): Web game
- TypeScript, Vite, Three.js (or React Three Fiber), Rapier physics (character controller and vehicles).
- Runs in a browser, nothing to install, easy to share a link.
- Looks "stylised-realistic": good light, shadows, water, fog and rain, but not GTA V-level detail.
- Fastest to build and iterate. Claude can write almost all of it.
- Hosting: company Vercel team account.

### Option B (higher realism): Unreal Engine 5
- UE5 with Lumen lighting, Nanite, MetaHuman characters, Chaos vehicles.
- Option to stream **Google Photorealistic 3D Tiles** through Cesium for Unreal for a photographic city. Need to check: (1) whether Colombo has 3D mesh coverage, (2) Google Maps Platform terms for use in a game, (3) per-request cost. Photogrammetry also looks melted at street level and has no collision, so OSM geometry is still needed underneath.
- Downloadable PC game (several GB), needs a decent GPU, slower to build, more manual work in the editor.

| | Web (A) | Unreal 5 (B) |
|---|---|---|
| Visual realism | Medium | High |
| Time to first playable | 2–3 weeks | 6–10 weeks |
| Runs on | Any modern laptop browser | Gaming PC |
| Distribution | Link | Download / Steam |
| Cost | Low | Asset and possibly tile costs |

## 8. Performance targets (Option A)
- 60 fps at 1080p on a mid-range laptop (e.g. GTX 1650 / Apple M1); 30 fps minimum on integrated graphics at low settings.
- First playable load under 15 seconds on a 50 Mbps connection; first download under 60 MB, the rest streamed in tiles.
- No visible pop-in closer than 150 m; tiles load before the player reaches them at sprint or tuk-tuk speed.

## 9. Sensitivity, legal and reputational risks

Because this is a real city with real communities, these need care before anything is shared publicly:

- **Places of worship** (Gangaramaya, Red Mosque, St Anthony's Shrine, St Lucia's, Hindu kovils): exploration only. No violence, damage or disrespectful interaction possible in or around them. St Anthony's Shrine and other churches were targets of the 2019 Easter Sunday attacks, so treat these with extra care.
- **Government and security sites** (Presidential Secretariat, President's House, Navy HQ, port, military areas): exterior only, no interiors, no layout detail beyond what's publicly visible.
- **Galle Face** was the centre of the 2022 Aragalaya protests. Keep the game neutral; no political content.
- **No combat or crime in v1.** If GTA-style crime is ever added, it is a separate decision with its own review.
- **Branding:** real shops and companies (Keells, Cargills, Dialog, banks, hotels) should get made-up names unless we have permission. Landmark buildings are fine as architecture.
- **GTA:** take the control feel and camera style, nothing else. No names, logos, fonts, HUD layout, radio parody or art style copied.
- **Map license:** ODbL attribution must be visible. If the derived city database is published, ODbL share-alike may apply to it.
- **No real personal data:** the game doesn't need any. If accounts or leaderboards come later, hosting must be on the company Vercel / Supabase accounts.

## 10. Milestones

| Version | Contents | Done when |
|---|---|---|
| v0.0 Pipeline spike | OSM → tiles for Fort only, viewed with a free-fly camera | Fort streets visibly match a map overlay |
| **v0.1 Walk Colombo** | Phase 1 map (about 5 km²), third-person character with walk/sprint/jump/climb, Tier 1 landmarks, minimap, day/night, ocean and lake | Can walk Galle Face → Fort → Pettah → Beira Lake at 60 fps and recognise each place |
| v0.2 Ride | Tuk-tuk driving, simple traffic and pedestrians, coastal train visible | Can drive Galle Road with traffic around |
| v0.3 Explore | Phase 2 map, rain/monsoon, swimming, landmark checklist, fast travel, sound | Landmark checklist completable |
| v1.0 | Whole CMC area, Tier 2 landmarks, settings, polish, optimisation | Public test |

## 11. How we'll check accuracy
- Debug overlay: OSM map drawn on top of the game ground plane; road centrelines must line up within **5 m**.
- Landmark positions within **10 m** of their OSM/real coordinates.
- Walking-distance check: e.g. Fort station to Galle Face Hotel in game ≈ real distance (about 1.5 km).
- Street names on the minimap match OSM.
- Recognition test: 5 people who know Colombo walk the v0.1 map and say where they are without the minimap.

### 10.1 v0.1 build notes (20 Nov 2026)
- OSM has about 5,400 building footprints in the Phase 1 area, so roughly 9,200 filler buildings are generated along streets (PRD 6.3).
- Ground is flat in v0.1; elevation model moved to v0.3.
- The protagonist is a placeholder made from primitives with procedural animation; a rigged model is still to do.
- Update (v0.2): the character was rebuilt as a jointed procedural figure (face, hair, collared or t-shirt, belt, slippers) with a full gait (hip, knee and ankle phases, arm counter-swing, pelvis sway, turn lean, landing squash, idle look-around) and four selectable outfits including a sarong. Still no external assets; a rigged glTF character remains an option.
- Phase 1 area is about 5.3 × 4.5 km, larger than the 5 km² planned, to include Beira Lake, Town Hall and Viharamahadevi Park.

### 10.2 v0.2 progress (20 Nov 2026)
- Done: drivable tuk-tuk (get in/out, arcade handling, horn, collision with buildings, trees, sea and other vehicles); parked tuk-tuks at the spawn point and near landmarks.
- Done: traffic on a directed road graph built from OSM, with left-hand driving, one-way streets, car-following, junction slowing and honking. About 110 vehicles kept within roughly 300 m of the player. Buses only use primary and trunk roads.
- Done: synthesised engine, horn and impact sounds (WebAudio, no audio files).
- Done: about 180 pedestrians within roughly 170 m of the player, on pavements and footways from OSM. Local clothing (sarong, saree, school uniform), idle stops, side-street crossings, dodging the player's tuk-tuk; traffic stops for them; fewer at night. Drawn as three instanced meshes with the walk cycle in the vertex shader.
- Done: coastal line trains. The data build finds the route over main-line tracks from Maradana to the south map edge (Dijkstra, preferring ways named Coast Line), clips it at the map edge, and splits the shared single-mapped track into two left-hand tracks. Two 4-car maroon DMUs run opposite ways, stop 25 s at each station (45 s at Maradana), brake for the player and cars on the line, and can be boarded and ridden from the doorway.
- Done: look and lighting pass, aiming for a stylised, warm and colourful look with a Sri Lankan feel (no assets copied from other games). Post-processing: bloom and a colour grade (saturation, warm highlights, cool night shadows, vignette). Brighter, readable nights: stronger moon and sky fill, a twilight lift around sunset, about 4,500 sodium street lamps (instanced, with 6 real point lights following the player), vehicle head and tail light glow, and a tuk-tuk headlight. The daytime sky is dimmed and saturated so it reads blue instead of white. Buildings: pastel and colonial palettes, plaster noise, clay tile hip roofs, parapets, ledges, water tanks, shutters, grilles and signboards. Ground: world-space shader detail for asphalt, slabs, grass and soil, plus kerbs and edge lines.
- Done: graphics quality setting (G). Low is picked automatically for integrated and mobile GPUs: pixel ratio 1, FXAA instead of 4x MSAA, 1024 shadow map. Bloom is skipped by day on both settings.
- Done: Esc pauses and resumes; any key starts; arrow keys turn the camera while moving.
- Done: street lamps light the world through a light map instead of screen glow; bloom reduced.
- Done: Lotus Tower rebuilt (podium sized clear of the roads, ribbed shaft, petals, deck). Roads count as walkable land, so bridges and causeways connect Galle Face to the Lotus Tower.
- Done: bicycles, electric scooters, aircraft overhead.
- Done: punching and knockdowns, tuk-tuk hits on people, mass-based crashes with traffic. Disabled near places of worship (section 9).
- Done: protagonist matched to the owner's reference sheet: their portrait projected onto the head (public/textures/player-face.jpg, faded to skin at the edges), curly hair, navy palm-print camp shirt (canvas texture), khaki cargos, white trainers and a watch, as the default outfit.
- Not done yet: zebra crossings, traffic lights, motorbike and car driving, riding a bus, passengers visible on trains, Main Line and Kelani Valley trains.
- Simplification: vehicles stuck in a gridlock for 7 s pass through each other rather than reversing out.

## 12. Open questions
1. ~~Engine~~ Decided: web.
2. **Audience:** personal project, public free game, or commercial? This affects asset licences and the Google tiles question.
3. **Platform:** browser only, desktop download, or mobile later?
4. **Tone:** pure exploration, or should light missions or GTA-style action come in later (with the review in section 9)?
5. **Character:** one fixed protagonist, or pick from a few local-looking characters (gender, clothing)?
6. **Budget:** any money for paid 3D assets (e.g. a proper tuk-tuk and bus model), or CC0 and hand-built only?
7. **Starting point in the game:** Galle Face Green (proposed) or somewhere else?
