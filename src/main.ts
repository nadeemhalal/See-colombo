import * as THREE from 'three';
import './style.css';
import type { CityData } from './types';
import { buildLandMask, isLand } from './world/landmask';
import { Collision } from './world/collision';
import { buildGround, buildSurfaces } from './world/ground';
import { buildWater } from './world/water';
import { buildBuildings } from './world/buildings';
import { cullByDistance } from './world/geom';
import { buildTrees } from './world/trees';
import { buildLandmarks } from './world/landmarks';
import { Environment } from './world/environment';
import { StreetLights } from './world/streetlights';
import { Planes } from './world/planes';
import { Post } from './world/post';
import { detectQuality, applyQuality, saveQuality } from './world/quality';
import { setVehicleNight, VEHICLE_TYPES } from './traffic/models';
import { StreetFurniture } from './world/streetFurniture';
import { Input } from './player/input';
import { Character } from './player/character';
import { PlayerController } from './player/controller';
import { FollowCamera } from './player/camera';
import { renderCityMap } from './ui/mapRender';
import { Minimap } from './ui/minimap';
import { BigMap } from './ui/bigmap';
import { Hud } from './ui/hud';
import { RoadGraph } from './traffic/roadGraph';
import { Traffic, type Agent, type Circle } from './traffic/traffic';
import { TukTuk, Vehicle } from './player/vehicle';
import { Pedestrians, streetDensity } from './people/pedestrians';
import { Trains, type Door } from './trains/trains';
import { Sound } from './audio';

const $ = (id: string) => document.getElementById(id)!;
const setLoading = (msg: string) => { $('loading-msg').textContent = msg; };
// yield so the loading text can paint (setTimeout, not rAF, so a hidden tab still loads)
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

const STORAGE_KEY = 'see-colombo:visited';
function loadVisited(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveVisited(v: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...v])); } catch { /* storage unavailable */ }
}

async function main() {
  setLoading('Downloading Colombo map data…');
  const res = await fetch(`${import.meta.env.BASE_URL}data/city.json`);
  if (!res.ok) throw new Error(`Could not load city data (${res.status}). Run "npm run data" first.`);
  const city = (await res.json()) as CityData;

  setLoading('Mapping the coastline and Beira Lake…');
  await nextFrame();
  // roads are always walkable and drivable: this paints bridges over Beira Lake and the canals back
  // as land (otherwise they are invisible walls) along with piers and breakwaters
  const mask = buildLandMask(city.bounds, 2.5, city.coast, city.water,
    city.piers.concat(city.roads.map((r) => ({ w: r.w + 1, p: r.p }))), city.land);

  const canvas = $('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 9000);

  setLoading(`Raising ${city.buildings.length.toLocaleString()} buildings…`);
  await nextFrame();
  const collision = new Collision();
  for (const b of city.buildings) collision.addPolygon(b.p, b.holes, b.h);
  const env = new Environment(scene, renderer);
  const water = buildWater();
  scene.add(water.mesh, buildGround(city, mask), buildSurfaces(city));
  const buildings = buildBuildings(city);
  scene.add(buildings.group);

  setLoading(`Planting ${(city.trees.length / 4).toLocaleString()} trees…`);
  await nextFrame();
  const trees = buildTrees(city, collision);
  scene.add(trees);
  const landmarks = buildLandmarks(city, collision);
  scene.add(landmarks.group);
  const lamps = new StreetLights(city, mask, collision);
  scene.add(lamps.group);
  const planes = new Planes();
  scene.add(planes.group);
  let quality = detectQuality(renderer);
  const post = new Post(renderer, scene, camera, quality === 'low' ? 0 : 4);
  applyQuality(quality, renderer, post, env.sun);
  // the player's tuk-tuk headlight
  const headlight = new THREE.SpotLight(0xfff0d0, 0, 40, 0.5, 0.7, 1.5);
  headlight.position.set(0, 1.05, 1.3);
  headlight.target.position.set(0, 0, 14);

  setLoading('Drawing the map…');
  await nextFrame();
  const visited = loadVisited();
  const cityMap = renderCityMap(city, mask);
  const minimap = new Minimap($('minimap') as HTMLCanvasElement, cityMap.canvas, cityMap.labels, city, visited);
  const bigmap = new BigMap($('bigmap-canvas') as HTMLCanvasElement, cityMap.canvas, city, visited);
  const hud = new Hud(city, visited, () => saveVisited(visited));

  // player
  const input = new Input(canvas);
  const character = new Character();
  scene.add(character.root);
  try { character.setOutfit(Number(localStorage.getItem('seeColombo.outfit') ?? 0) || 0); } catch { /* storage blocked */ }
  let outfitBannerT = 0;
  const player = new PlayerController(collision, mask);
  const follow = new FollowCamera(camera, collision);

  const spawnAt = () => {
    const gf = city.landmarks.find((l) => l.id === 'gallefacegreen');
    const sx = gf ? gf.x : 0, sz = gf ? gf.z : 0;
    player.teleport(sx, sz);
    player.facing = Math.PI; // face north toward Fort
    follow.yaw = 0;
  };

  // traffic and tuk-tuks
  setLoading('Starting the traffic and people…');
  await nextFrame();
  const graph = new RoadGraph(city);
  const gf = city.landmarks.find((l) => l.id === 'gallefacegreen');
  const traffic = new Traffic(graph, new THREE.Vector3(gf?.x ?? 0, 0, gf?.z ?? 0));
  scene.add(traffic.group);
  const peds = new Pedestrians(city, collision, new THREE.Vector3(gf?.x ?? 0, 0, gf?.z ?? 0));
  scene.add(peds.group);
  const trains = new Trains(city);
  scene.add(trains.group);
  const furniture = new StreetFurniture(city, graph, collision);
  scene.add(furniture.group);
  traffic.furniture = furniture;
  const sound = new Sound();

  const TUK_COLORS = [0xb3201e, 0x1f7a3a, 0x1b4f9c, 0xe0b400, 0x5a1a1a, 0x1c1c1c];
  const parked: Vehicle[] = [];
  const addParked = (x: number, z: number, heading: number) => {
    if (!isLand(mask, x, z) || collision.pointBlocked(x, 0.5, z)) return;
    const tk = new TukTuk(TUK_COLORS[parked.length % TUK_COLORS.length]);
    tk.place(x, z, heading);
    parked.push(tk);
    scene.add(tk.group);
  };
  // one right next to the spawn point on Galle Face Green, pointing somewhere with a clear run
  if (gf) {
    const clearAhead = (x: number, z: number, h: number) => {
      for (let d = 0; d <= 15; d += 1) {
        const p = { x: x + Math.sin(h) * d, z: z + Math.cos(h) * d };
        if (!isLand(mask, p.x, p.z)) return false;
        const p0x = p.x, p0z = p.z;
        collision.resolve(p, 0.9, 0.2);
        if (p.x !== p0x || p.z !== p0z) return false;
      }
      return true;
    };
    let spot: [number, number, number] = [gf.x + 3, gf.z - 1.5, Math.PI];
    search: for (const [ox, oz] of [[3, -1.5], [-3, -1.5], [3, 2], [-3, 2], [5, 0], [-5, 0]])
      for (const h of [Math.PI, 0, Math.PI / 2, -Math.PI / 2])
        if (clearAhead(gf.x + ox, gf.z + oz, h)) { spot = [gf.x + ox, gf.z + oz, h]; break search; }
    addParked(...spot);
  }
  // tuk-tuk stands on the kerb near landmarks
  for (const id of ['gallefacegreen', 'fortstation', 'khanclock', 'redmosque', 'wtc', 'lotus', 'gangaramaya', 'townhall', 'gallefacehotel']) {
    const l = city.landmarks.find((m) => m.id === id);
    if (!l) continue;
    let best = -1, bestD = 200, bestS = 0;
    for (const eid of graph.edgesNear(l.x, l.z, 220)) {
      const e = graph.edges[eid];
      if (e.len < 8) continue;
      const n = graph.nodes[e.a];
      const s = Math.max(3, Math.min(e.len - 3, (l.x - n.x) * e.dx + (l.z - n.z) * e.dz));
      const d = Math.hypot(n.x + e.dx * s - l.x, n.z + e.dz * s - l.z);
      if (d < bestD) { bestD = d; best = eid; bestS = s; }
    }
    if (best < 0) continue;
    const e = graph.edges[best], n = graph.nodes[e.a];
    const off = e.w / 2 + 1.3; // on the kerb, left side
    addParked(n.x + e.dx * bestS + e.dz * off, n.z + e.dz * bestS - e.dx * off, Math.atan2(e.dx, e.dz));
  }
  let driving: Vehicle | null = null;
  let riding: Door | null = null;
  const doorV = new THREE.Vector3();

  const leaveTrain = () => {
    if (!riding) return;
    const d = riding;
    // step down on the side we boarded, or the other side if that one is blocked
    let placed = false;
    for (const side of [d.side, -d.side as 1 | -1]) {
      trains.doorPos({ ...d, side }, doorV, 2.2);
      if (isLand(mask, doorV.x, doorV.z) && !collision.pointBlocked(doorV.x, 0.5, doorV.z)) { player.teleport(doorV.x, doorV.z, 0); placed = true; break; }
    }
    if (!placed) { trains.doorPos(d, doorV, 2.2); player.teleport(doorV.x, doorV.z, 0); }
    player.facing = d.train.pose[d.car].h + (Math.PI / 2) * d.side;
    riding = null;
    trains.riding = null;
  };
  const boardTrain = (d: Door) => {
    riding = d;
    trains.riding = d.train;
    player.vel.set(0, 0);
  };

  const getOut = () => {
    if (!driving) return;
    const v = driving;
    const hx = Math.sin(v.heading), hz = Math.cos(v.heading);
    // step out on the left (kerb side), or the right if the left is blocked, else behind
    let placed = false;
    const off = v.h.r + 0.65;
    for (const side of [1, -1]) {
      const x = v.pos.x + hz * off * side, z = v.pos.z - hx * off * side;
      if (isLand(mask, x, z) && !collision.pointBlocked(x, 0.5, z)) { player.teleport(x, z); placed = true; break; }
    }
    if (!placed) player.teleport(v.pos.x - hx * (v.h.half + v.h.r + 0.7), v.pos.z - hz * (v.h.half + v.h.r + 0.7));
    player.facing = v.heading;
    v.speed = 0;
    driving = null;
    character.seated = false;
  };
  const getIn = (v: Vehicle) => {
    driving = v;
    character.seated = !v.h.stand;
    player.vel.set(0, 0);
  };
  // take a vehicle out of traffic: the driver gets out and runs off, the vehicle is yours.
  // Vehicles you leave behind stay where you left them (the oldest far-away ones are cleared up).
  const MAX_TAKEN = 8;
  const takeFromTraffic = (a: Agent) => {
    const info = traffic.take(a);
    const v = new Vehicle(info.type, info.color);
    v.place(info.x, info.z, info.heading);
    v.taken = true;
    scene.add(v.group);
    parked.push(v);
    // the driver climbs out on the right (right-hand drive), riders hop off to the side
    const side = v.h.leans ? 0.8 : v.h.r + 0.6;
    const rx = -Math.cos(v.heading), rz = Math.sin(v.heading);
    peds.dropAt(v.pos.x + rx * side, v.pos.z + rz * side, player.pos.x, player.pos.z);
    const taken = parked.filter((p) => p.taken && p !== v);
    if (taken.length >= MAX_TAKEN) {
      const far = taken.sort((p, q) => q.pos.distanceTo(player.pos) - p.pos.distanceTo(player.pos))[0];
      scene.remove(far.group);
      (far.body.material as THREE.Material).dispose();
      parked.splice(parked.indexOf(far), 1);
    }
    getIn(v);
  };

  spawnAt();
  // full-detail buildings around the start point before the first frame
  buildings.update(player.pos.x, player.pos.z, 99);

  const travel = (x: number, z: number) => {
    if (!isLand(mask, x, z)) return;
    getOut();
    leaveTrain();
    player.teleport(x, z, 0);
    collision.resolve(player.pos, 0.4, 0);
    buildings.update(x, z, 99);
    bigmap.hide();
    input.free = input.wantLock = true;
    input.lock();
  };
  bigmap.onTravel = travel;

  // time of day: start late afternoon; a whole game day lasts 10 real minutes (T for 10x faster)
  const today = new Date();
  const dayOfYear = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(today.getFullYear(), 0, 0)) / 864e5);
  let minutes = 16 * 60 + 30;
  const DAY_RATE = 1440 / 600; // game minutes per real second
  let timeRate = DAY_RATE;

  // overlays
  const start = $('start');
  setLoading('');
  $('loading').classList.add('hidden');
  setTimeout(() => ($('loading').style.display = 'none'), 600);
  start.classList.add('show');
  // pause: Esc pauses and Esc resumes; any key (or a click) starts the game, so no clicking is needed
  let started = false;
  let paused = true;
  let pausedAt = 0;
  const setPaused = (p: boolean) => {
    paused = p;
    if (p) pausedAt = performance.now();
    start.classList.toggle('show', p);
    if (started) {
      $('start-title').textContent = 'Paused';
      $('start-sub').textContent = 'Press Esc to continue';
    }
    const playing = !p && !bigmap.open;
    input.free = playing;
    input.wantLock = playing;
    if (playing) { sound.unlock(); input.lock(); }
    else input.unlock();
  };
  let wasLocked = false;
  const resume = () => { started = true; setPaused(false); };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (!started || bigmap.open) return;
      if (paused) { if (performance.now() - pausedAt > 250) setPaused(false); }
      else setPaused(true);
      return;
    }
    if (!started && !e.repeat) resume();
  });
  trains.onHorn = (x, z, long) => sound.trainHorn(Math.max(0, 1 - Math.hypot(x - player.pos.x, z - player.pos.z) / 350), long);
  traffic.onHonk = (d) => sound.horn(Math.max(0, 1 - d / 40) * 0.7, 0.85 + Math.random() * 0.4);
  start.addEventListener('click', resume);
  // left mouse also punches (F on the keyboard)
  let punchQueued = false;
  // a click while the mouse isn't captured captures it (without the lock, turning stops when the
  // cursor reaches the edge of the screen); otherwise it punches
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !started || paused || bigmap.open) return;
    if (!input.locked) input.lock();
    else punchQueued = true;
  });
  // places of worship are exploration only (PRD section 9): no fighting in or around them
  const worship = ['redmosque', 'gangaramaya', 'seemamalaka', 'wolvendaal', 'stanthonys', 'stlucias', 'ponnambalavaneswaram', 'kathiresan', 'dewatagaha', 'sambodhi']
    .map((id) => city.landmarks.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l);
  const nearWorship = (x: number, z: number) => worship.some((l) => Math.hypot(l.x - x, l.z - z) < 120);
  let punchCd = 0;
  document.addEventListener('pointerlockchange', () => {
    // the browser releases the pointer itself when Esc is pressed: treat that as pausing
    const locked = document.pointerLockElement === canvas;
    if (!locked && started && !paused && !bigmap.open && wasLocked) setPaused(true);
    wasLocked = locked;
  });

  // keep the drawing buffer in sync with the canvas size (also covers a page loaded while hidden)
  const size = new THREE.Vector2();
  const fitCanvas = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.getSize(size);
    if (w > 0 && h > 0 && (size.x !== w || size.y !== h)) {
      renderer.setSize(w, h, false);
      post.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  };

  const timer = new THREE.Timer();
  timer.connect(document);
  let fpsT = 0, fpsN = 0;
  const skyTint = new THREE.Color();
  const camFwd = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    timer.update();
    // while paused the world stands still: no time passes and key presses are ignored
    if (paused) { input.clearFrame(); punchQueued = false; }
    const dt = paused ? 0 : Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    fitCanvas();

    if (input.wasPressed('KeyM')) {
      if (bigmap.open) { bigmap.hide(); input.free = input.wantLock = true; input.lock(); }
      else { bigmap.show(player.pos.x, player.pos.z, player.facing); input.free = input.wantLock = false; input.unlock(); }
    }
    if (input.wasPressed('KeyH')) $('help').classList.toggle('show');
    if (input.wasPressed('KeyO')) {
      const o = character.setOutfit(character.outfit + 1);
      try { localStorage.setItem('seeColombo.outfit', String(character.outfit)); } catch { /* storage blocked */ }
      $('banner').textContent = o.name;
      $('banner').classList.add('show');
      outfitBannerT = 2;
    }
    if (input.wasPressed('KeyG')) {
      quality = quality === 'high' ? 'low' : 'high';
      saveQuality(quality);
      applyQuality(quality, renderer, post, env.sun);
      $('banner').textContent = `Graphics: ${quality === 'high' ? 'High' : 'Low'}`;
      $('banner').classList.add('show');
      outfitBannerT = 2;
    }
    if (outfitBannerT > 0 && (outfitBannerT -= dt) <= 0) $('banner').classList.remove('show');
    if (input.wasPressed('KeyT')) { timeRate = timeRate === DAY_RATE ? DAY_RATE * 10 : DAY_RATE; $('clock').classList.toggle('fast', timeRate > DAY_RATE); }
    if (input.wasPressed('BracketRight')) minutes += 60;
    if (input.wasPressed('BracketLeft')) minutes -= 60;
    if (input.wasPressed('KeyR')) { getOut(); leaveTrain(); spawnAt(); }
    if (input.wasPressed('KeyN')) sound.setMuted(!sound.muted);
    minutes = ((minutes + dt * timeRate) % 1440 + 1440) % 1440;

    // get in / out of a tuk-tuk
    let nearTuk: Vehicle | null = null;
    let nearCar: Agent | null = null;
    if (!driving && !riding && player.pos.y < 1) {
      let bd = 1.8;
      for (const tk of parked) {
        const d = tk.distanceTo(player.pos.x, player.pos.z);
        if (d < bd) { bd = d; nearTuk = tk; }
      }
      if (!nearTuk && !nearWorship(player.pos.x, player.pos.z)) nearCar = traffic.nearest(player.pos.x, player.pos.z, 1.6);
    }
    const nearTrain = !driving && !riding && player.pos.y < 1 ? trains.nearDoor(player.pos.x, player.pos.z) : null;
    const trainStopped = !!riding && Math.abs(riding.train.speed) < 0.3;
    const enterKey = input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || input.wasPressed('KeyE');
    if (enterKey && !paused) {
      if (riding) { if (trainStopped) leaveTrain(); }
      else if (driving) { if (Math.abs(driving.speed) < (driving.h.leans ? 4 : 2.5)) getOut(); }
      else if (nearTrain) boardTrain(nearTrain);
      else if (nearTuk) getIn(nearTuk);
      else if (nearCar) takeFromTraffic(nearCar);
    }
    const carLabel = nearCar ? VEHICLE_TYPES[nearCar.type].label : '';
    const promptText = nearTrain ? 'Board the train' : nearTuk ? `Get on the ${nearTuk.type.label}`
      : nearCar ? `Take the ${carLabel}` : trainStopped ? 'Get off the train' : '';
    if (promptText && $('prompt').dataset.t !== promptText) { $('prompt').innerHTML = `<b>Enter</b> ${promptText}`; $('prompt').dataset.t = promptText; }
    $('prompt').classList.toggle('show', !!promptText && !bigmap.open);
    $('mousehint').classList.toggle('show', started && !paused && !bigmap.open && !input.locked);

    const others: Circle[] = trains.circles();
    const trainCount = others.length;
    for (const tk of parked) if (tk !== driving) tk.circles(others);
    const people = peds.circles();

    if (!bigmap.open && !paused) {
      if (driving) {
        // momentum: hitting traffic shoves it by mass, hitting people knocks them down
        const sp = driving.speed, hx = Math.sin(driving.heading), hz = Math.cos(driving.heading);
        const calm = nearWorship(driving.pos.x, driving.pos.z);
        let hit = 0;
        if (Math.abs(sp) > 2 && !calm) {
          const reach = driving.h.half + driving.h.r * 0.5, rr = driving.h.r * 1.1;
          const fx = driving.pos.x + hx * Math.sign(sp) * reach, fz = driving.pos.z + hz * Math.sign(sp) * reach;
          const ram = traffic.ram(fx, fz, rr, hx * sp, hz * sp, driving.mass + 0.08);
          if (ram.impact > 0) { driving.speed *= 1 - ram.loss * 0.8; hit = Math.max(hit, ram.impact); }
          const n = peds.hitAt(fx, fz, rr + 0.1, driving.pos.x, driving.pos.z, Math.abs(sp) * 0.9);
          if (n) { driving.speed *= Math.pow(driving.mass > 1 ? 0.97 : driving.mass < 0.3 ? 0.6 : 0.88, n); hit = Math.max(hit, 3); }
        }
        // slow or near a place of worship: people and cars are solid as before
        const solid = Math.abs(sp) > 2 && !calm ? others.slice() : others.concat(people);
        const impact = driving.drive(dt, input, collision, mask, traffic.circles(solid));
        if (Math.max(impact, hit) > 2) sound.bump(Math.max(impact, hit));
        if (input.wasPressed('KeyQ')) sound.horn(1);
        player.pos.set(driving.pos.x, 0, driving.pos.z);
      } else if (!riding) {
        player.update(dt, input, follow.yaw, traffic.circles(others.concat(people)));
        punchCd = Math.max(0, punchCd - dt);
        if ((input.wasPressed('KeyF') || punchQueued) && punchCd <= 0 && player.onGround && character.punch()) {
          punchCd = 0.45;
          if (!nearWorship(player.pos.x, player.pos.z)) {
            const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
            const n = peds.hitAt(player.pos.x + fx * 0.9, player.pos.z + fz * 0.9, 0.55, player.pos.x, player.pos.z, 3);
            if (n) sound.bump(2.5);
          }
        }
      }
    }
    if (riding) {
      trains.doorPos(riding, doorV);
      player.pos.set(doorV.x, 0, doorV.z);
    }
    const ridePose = riding?.train.pose[riding.car];
    const drivingState = driving ? { heading: driving.heading, speed: driving.speed, size: Math.max(0, driving.h.half - 0.75) }
      : riding && ridePose ? { heading: ridePose.h, speed: riding.train.speed } : undefined;
    if (!bigmap.open) follow.update(dt, input, driving ? driving.pos : riding ? doorV : player.pos, drivingState);
    sound.engine(!!driving && driving.h.engine, driving?.speed ?? 0, driving && input.axis().f > 0 ? 1 : 0);

    if (driving) {
      character.root.position.copy(driving.seat());
      character.root.rotation.y = driving.heading;
    } else if (riding && ridePose) {
      // standing in the open doorway, looking out
      character.root.position.copy(doorV);
      character.root.rotation.y = ridePose.h + (Math.PI / 2) * riding.side;
    } else {
      character.root.position.copy(player.pos);
      character.root.rotation.y = player.facing;
    }
    character.animate(dt, riding ? 0 : player.vel.length(), riding ? true : player.onGround, player.velY, player.sprinting);
    $('speed').classList.toggle('show', !!driving || !!riding);
    if (driving) $('speed-val').textContent = String(Math.round(Math.abs(driving.speed) * 3.6));
    if (riding) {
      $('speed-val').textContent = String(Math.round(Math.abs(riding.train.speed) * 3.6));
      const tr = riding.train;
      const info = tr.state === 'dwell' || tr.stopName === 'End of the map'
        ? `${tr.stopName} · E get off` : `Next: ${trains.nextStopName(tr)} · stops at every station`;
      $('drive-keys').textContent = info;
    } else if (driving) $('drive-keys').textContent = 'W/S throttle · A/D steer · Space brake · Q horn · Enter get out';

    camFwd.set(-Math.sin(follow.yaw), 0, -Math.cos(follow.yaw));
    // the vehicle you're in is solid to traffic and people along its whole length (a bus is 11 m)
    const mine = driving ? driving.circles() : [];
    const myR = driving ? Math.min(driving.reach, 1.6) : 0.45;
    furniture.update(dt, env.night);
    traffic.update(dt, driving ? driving.pos : player.pos, myR, camFwd, others.concat(people, mine));
    peds.update(dt, driving ? driving.pos : player.pos, myR, camFwd, driving && { x: driving.pos.x, z: driving.pos.z, heading: driving.heading, speed: driving.speed }, streetDensity(minutes / 60), others.slice(0, trainCount).concat(mine));
    // the trains watch for the player and cars on the line
    const onLine: Circle[] = riding ? [] : driving ? driving.circles() : [{ x: player.pos.x, z: player.pos.z, r: 0.45 }];
    traffic.circles(onLine);
    for (let i = trainCount; i < others.length; i++) onLine.push(others[i]);
    trains.update(dt, onLine);

    env.update(minutes, dayOfYear, player.pos, camera.position);
    buildings.setNight(env.night);
    // stream building detail around you (more per frame when you're moving fast), cull far trees and lamps
    const focus = driving ? driving.pos : player.pos;
    buildings.update(focus.x, focus.z, driving && Math.abs(driving.speed) > 15 ? 2 : 1);
    cullByDistance(trees, focus.x, focus.z, 650);
    cullByDistance(lamps.group, focus.x, focus.z, 700);
    lamps.update(dt, env.night, player.pos);
    planes.update(dt, player.pos, env.night);
    setVehicleNight(THREE.MathUtils.smoothstep(env.night, 0.3, 0.8));
    post.update(env.night);
    if (driving && headlight.parent !== driving.group) {
      const front = driving.h.half + driving.h.r;
      headlight.position.set(0, driving.h.leans ? 0.95 : 0.85, front);
      headlight.target.position.set(0, 0, front + 14);
      driving.group.add(headlight, headlight.target);
    }
    if (!driving && headlight.parent) { headlight.parent.remove(headlight, headlight.target); }
    // a soft beam: enough to see the road ahead without washing out whatever is next to you
    headlight.intensity = driving ? THREE.MathUtils.smoothstep(env.night, 0.3, 0.8) * (driving.h.leans ? 5 : driving.h.half > 2 ? 16 : 12) : 0;
    landmarks.update(t, env.night);
    water.uniforms.uTime.value = t;
    water.uniforms.uSunDir.value.copy(env.sunDir);
    water.uniforms.uSunColor.value.copy(env.sunColor);
    skyTint.copy(env.horizon).lerp(new THREE.Color(0.55, 0.7, 0.85), 0.4 * (1 - env.night));
    water.uniforms.uSkyColor.value.copy(skyTint);
    water.uniforms.uFogColor.value.copy(env.horizon);
    water.uniforms.uFogDensity.value = env.fog.density;

    hud.update(dt, player.pos.x, player.pos.z, minutes);
    minimap.draw(player.pos.x, player.pos.z, follow.yaw, driving ? driving.heading : player.facing);

    post.render();
    input.endFrame();
    punchQueued = false;

    fpsN++; fpsT += dt;
    if (fpsT > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsT)} fps`; fpsN = 0; fpsT = 0; }
  });

  // debug hook for testing in the console
  (window as unknown as Record<string, unknown>).seeColombo = { player, follow, input, travel, traffic, peds, trains, furniture, boardTrain, leaveTrain, get riding() { return riding; }, parked, collision, mask, character, getIn, getOut, takeFromTraffic, get driving() { return driving; }, city, renderer, scene, camera, post, lamps, env, planes, getQuality: () => quality, setTime: (h: number) => (minutes = h * 60) };
}

main().catch((e) => {
  console.error(e);
  setLoading(`Something went wrong: ${e instanceof Error ? e.message : e}`);
});
