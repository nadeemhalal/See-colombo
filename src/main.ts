import * as THREE from 'three';
import './style.css';
import type { CityData } from './types';
import { buildLandMask, isLand } from './world/landmask';
import { Collision } from './world/collision';
import { buildGround, buildSurfaces } from './world/ground';
import { buildWater } from './world/water';
import { buildBuildings } from './world/buildings';
import { buildTrees } from './world/trees';
import { buildLandmarks } from './world/landmarks';
import { Environment } from './world/environment';
import { Input } from './player/input';
import { Character } from './player/character';
import { PlayerController } from './player/controller';
import { FollowCamera } from './player/camera';
import { renderCityMap } from './ui/mapRender';
import { Minimap } from './ui/minimap';
import { BigMap } from './ui/bigmap';
import { Hud } from './ui/hud';
import { RoadGraph } from './traffic/roadGraph';
import { Traffic, type Circle } from './traffic/traffic';
import { TukTuk } from './player/vehicle';
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
  const mask = buildLandMask(city.bounds, 2.5, city.coast, city.water, city.piers, city.land);

  const canvas = $('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 30000);

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
  scene.add(buildTrees(city, collision));
  const landmarks = buildLandmarks(city, collision);
  scene.add(landmarks.group);

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
  const sound = new Sound();

  const TUK_COLORS = [0xb3201e, 0x1f7a3a, 0x1b4f9c, 0xe0b400, 0x5a1a1a, 0x1c1c1c];
  const parked: TukTuk[] = [];
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
  let driving: TukTuk | null = null;
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
    for (const side of [1, -1]) {
      const x = v.pos.x + hz * 1.3 * side, z = v.pos.z - hx * 1.3 * side;
      if (isLand(mask, x, z) && !collision.pointBlocked(x, 0.5, z)) { player.teleport(x, z); placed = true; break; }
    }
    if (!placed) player.teleport(v.pos.x - hx * 2.2, v.pos.z - hz * 2.2);
    player.facing = v.heading;
    v.speed = 0;
    driving = null;
    character.seated = false;
  };
  const getIn = (v: TukTuk) => {
    driving = v;
    character.seated = true;
    player.vel.set(0, 0);
  };

  spawnAt();

  const travel = (x: number, z: number) => {
    if (!isLand(mask, x, z)) return;
    getOut();
    leaveTrain();
    player.teleport(x, z, 0);
    collision.resolve(player.pos, 0.4, 0);
    bigmap.hide();
    input.lock();
  };
  bigmap.onTravel = travel;

  // time of day: start late afternoon, 1 real second = 1 game minute
  const today = new Date();
  const dayOfYear = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(today.getFullYear(), 0, 0)) / 864e5);
  let minutes = 16 * 60 + 30;
  let timeRate = 1;

  // overlays
  const start = $('start');
  setLoading('');
  $('loading').classList.add('hidden');
  setTimeout(() => ($('loading').style.display = 'none'), 600);
  start.classList.add('show');
  const resume = () => { sound.unlock(); if (!bigmap.open) input.lock(); };
  trains.onHorn = (x, z, long) => sound.trainHorn(Math.max(0, 1 - Math.hypot(x - player.pos.x, z - player.pos.z) / 350), long);
  traffic.onHonk = (d) => sound.horn(Math.max(0, 1 - d / 40) * 0.7, 0.85 + Math.random() * 0.4);
  start.addEventListener('click', resume);
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    start.classList.toggle('show', !locked && !bigmap.open);
    $('start-title').textContent = 'Paused';
    $('start-sub').textContent = 'Click to continue';
  });

  // keep the drawing buffer in sync with the canvas size (also covers a page loaded while hidden)
  const size = new THREE.Vector2();
  const fitCanvas = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.getSize(size);
    if (w > 0 && h > 0 && (size.x !== w || size.y !== h)) {
      renderer.setSize(w, h, false);
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
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    fitCanvas();

    if (input.wasPressed('KeyM')) {
      if (bigmap.open) { bigmap.hide(); input.lock(); }
      else { bigmap.show(player.pos.x, player.pos.z, player.facing); input.unlock(); }
    }
    if (input.wasPressed('KeyH')) $('help').classList.toggle('show');
    if (input.wasPressed('KeyO')) {
      const o = character.setOutfit(character.outfit + 1);
      try { localStorage.setItem('seeColombo.outfit', String(character.outfit)); } catch { /* storage blocked */ }
      $('banner').textContent = o.name;
      $('banner').classList.add('show');
      outfitBannerT = 2;
    }
    if (outfitBannerT > 0 && (outfitBannerT -= dt) <= 0) $('banner').classList.remove('show');
    if (input.wasPressed('KeyT')) { timeRate = timeRate === 1 ? 20 : 1; $('clock').classList.toggle('fast', timeRate > 1); }
    if (input.wasPressed('BracketRight')) minutes += 60;
    if (input.wasPressed('BracketLeft')) minutes -= 60;
    if (input.wasPressed('KeyR')) { getOut(); leaveTrain(); spawnAt(); }
    if (input.wasPressed('KeyN')) sound.setMuted(!sound.muted);
    minutes = ((minutes + dt * timeRate) % 1440 + 1440) % 1440;

    // get in / out of a tuk-tuk
    let nearTuk: TukTuk | null = null;
    if (!driving && !riding) {
      let bd = 4.2;
      for (const tk of parked) {
        const d = Math.hypot(tk.pos.x - player.pos.x, tk.pos.z - player.pos.z);
        if (d < bd && player.pos.y < 1) { bd = d; nearTuk = tk; }
      }
    }
    const nearTrain = !driving && !riding && player.pos.y < 1 ? trains.nearDoor(player.pos.x, player.pos.z) : null;
    const trainStopped = !!riding && Math.abs(riding.train.speed) < 0.3;
    if (input.wasPressed('KeyE') && input.locked) {
      if (riding) { if (trainStopped) leaveTrain(); }
      else if (driving) { if (Math.abs(driving.speed) < 2.5) getOut(); }
      else if (nearTrain) boardTrain(nearTrain);
      else if (nearTuk) getIn(nearTuk);
    }
    const promptText = nearTrain ? 'Board the train' : nearTuk ? 'Ride the tuk-tuk' : trainStopped ? 'Get off the train' : '';
    if (promptText && $('prompt').dataset.t !== promptText) { $('prompt').innerHTML = `<b>E</b> ${promptText}`; $('prompt').dataset.t = promptText; }
    $('prompt').classList.toggle('show', !!promptText && !bigmap.open);

    const others: Circle[] = trains.circles();
    const trainCount = others.length;
    for (const tk of parked) if (tk !== driving) tk.circles(others);
    const people = peds.circles();

    if (!bigmap.open && input.locked) {
      if (driving) {
        const impact = driving.drive(dt, input, collision, mask, traffic.circles(others.concat(people)));
        if (impact > 2) sound.bump(impact);
        if (input.wasPressed('KeyQ')) sound.horn(1);
        player.pos.set(driving.pos.x, 0, driving.pos.z);
      } else if (!riding) {
        player.update(dt, input, follow.yaw, traffic.circles(others.concat(people)));
      }
    }
    if (riding) {
      trains.doorPos(riding, doorV);
      player.pos.set(doorV.x, 0, doorV.z);
    }
    const ridePose = riding?.train.pose[riding.car];
    const drivingState = driving ? { heading: driving.heading, speed: driving.speed }
      : riding && ridePose ? { heading: ridePose.h, speed: riding.train.speed } : undefined;
    if (!bigmap.open) follow.update(dt, input, driving ? driving.pos : riding ? doorV : player.pos, drivingState);
    sound.engine(!!driving, driving?.speed ?? 0, driving && input.axis().f > 0 ? 1 : 0);

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
    } else if (driving) $('drive-keys').textContent = 'W/S throttle · A/D steer · Space brake · Q horn · E get out';

    camFwd.set(-Math.sin(follow.yaw), 0, -Math.cos(follow.yaw));
    traffic.update(dt, driving ? driving.pos : player.pos, driving ? 1.3 : 0.45, camFwd, others.concat(people));
    peds.update(dt, driving ? driving.pos : player.pos, driving ? 1.3 : 0.45, camFwd, driving && { x: driving.pos.x, z: driving.pos.z, heading: driving.heading, speed: driving.speed }, streetDensity(minutes / 60), others.slice(0, trainCount));
    // the trains watch for the player and cars on the line
    const onLine: Circle[] = riding ? [] : [{ x: player.pos.x, z: player.pos.z, r: driving ? 1.3 : 0.45 }];
    traffic.circles(onLine);
    for (let i = trainCount; i < others.length; i++) onLine.push(others[i]);
    trains.update(dt, onLine);

    env.update(minutes, dayOfYear, player.pos);
    buildings.setNight(env.night);
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

    renderer.render(scene, camera);
    input.endFrame();

    fpsN++; fpsT += dt;
    if (fpsT > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsT)} fps`; fpsN = 0; fpsT = 0; }
  });

  // debug hook for testing in the console
  (window as unknown as Record<string, unknown>).seeColombo = { player, follow, input, travel, traffic, peds, trains, boardTrain, leaveTrain, get riding() { return riding; }, parked, collision, mask, character, getIn, getOut, get driving() { return driving; }, city, renderer, scene, camera, setTime: (h: number) => (minutes = h * 60) };
}

main().catch((e) => {
  console.error(e);
  setLoading(`Something went wrong: ${e instanceof Error ? e.message : e}`);
});
