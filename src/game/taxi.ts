import * as THREE from 'three';
import type { CityData, Landmark } from '../types';
import type { Pedestrians } from '../people/pedestrians';
import type { RoadGraph } from '../traffic/roadGraph';

const $ = (id: string) => document.getElementById(id)!;
const MONEY_KEY = 'seeColombo.rupees';
const JOBS_KEY = 'seeColombo.taxiJobs';

/** metered fare, roughly what a Colombo tuk-tuk charges: Rs 100 for the first km, then Rs 85 a km */
export function fareFor(metres: number) {
  const km = metres / 1000;
  return Math.round((100 + Math.max(0, km - 1) * 85) / 10) * 10;
}

type State =
  | { kind: 'off' }
  | { kind: 'idle'; wait: number }
  | { kind: 'pickup'; ped: number; away: number }
  | { kind: 'ride'; ped: number; to: Landmark; x: number; z: number; dist: number; par: number; t: number; knocks: number; worst: number };

export interface TaxiContext {
  /** the player's tuk-tuk, if they're driving one */
  tuk: { x: number; z: number; heading: number; speed: number } | null;
  /** the player's position (on foot or driving) */
  px: number; pz: number;
}

/**
 * Tuk-tuk taxi jobs. While you drive a tuk-tuk, someone nearby waves you down. Stop next to them to
 * pick them up, drive them to the landmark they ask for, and stop there to get paid: the metered fare,
 * plus a tip for being quick and not knocking them about.
 */
export class Taxi {
  group = new THREE.Group();
  money = 0;
  enabled = true;
  private state: State = { kind: 'idle', wait: 2 };
  private pin: THREE.Group;
  private beam: THREE.Mesh;
  private toastT = 0;
  private time = 0;

  constructor(private city: CityData, private peds: Pedestrians, private roads: RoadGraph, private onPaid: () => void = () => {}) {
    try {
      this.money = Number(localStorage.getItem(MONEY_KEY) ?? 0) || 0;
      this.enabled = localStorage.getItem(JOBS_KEY) !== 'off';
    } catch { /* storage blocked */ }
    if (!this.enabled) this.state = { kind: 'off' };

    // a bobbing yellow marker over the person waving
    this.pin = new THREE.Group();
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xffc928, toneMapped: false, fog: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 14).rotateX(Math.PI), pinMat);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), pinMat);
    ball.position.y = 0.45;
    this.pin.add(cone, ball);
    this.pin.visible = false;
    // a tall see-through column of light at the drop-off, visible over the rooftops
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 160, 24, 1, true).translate(0, 80, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc928, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: false }),
    );
    this.beam.visible = false;
    this.group.add(this.pin, this.beam);
    this.showMoney();
  }

  /** J: start or stop taking fares */
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(JOBS_KEY, this.enabled ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (!this.enabled) {
      this.cancel(this.state.kind === 'ride' ? 'You stopped taking fares. Your passenger got out without paying.' : 'Taxi jobs off. Press J to start again.');
      this.state = { kind: 'off' };
    } else {
      this.state = { kind: 'idle', wait: 1 };
      this.toast('Taxi jobs on. Drive a tuk-tuk and look for someone waving.');
    }
  }

  /** a bump while driving (impact strength as the vehicle reports it) */
  bump(strength: number) {
    if (this.state.kind !== 'ride' || strength < 2) return;
    this.state.knocks++;
    this.state.worst = Math.max(this.state.worst, strength);
  }

  /** the player got out of the tuk-tuk */
  leftVehicle() {
    if (this.state.kind === 'ride') this.cancel('Your passenger got out. No fare.');
  }

  /** markers for the minimap: where to go next */
  markers(): { x: number; z: number; color: string }[] {
    const s = this.state;
    if (s.kind === 'pickup') { const f = this.peds.fareAt(s.ped); return [{ x: f.x, z: f.z, color: '#ffc928' }]; }
    if (s.kind === 'ride') return [{ x: s.x, z: s.z, color: '#ffc928' }];
    return [];
  }

  update(dt: number, ctx: TaxiContext) {
    this.time += dt;
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('job-toast').classList.remove('show');
    }
    const s = this.state;
    const tuk = ctx.tuk;
    this.pin.visible = s.kind === 'pickup';
    this.beam.visible = s.kind === 'ride';

    if (s.kind === 'idle') {
      if (tuk) {
        s.wait -= dt;
        if (s.wait <= 0) {
          const ped = this.peds.hail(tuk.x, tuk.z, tuk.heading);
          if (ped >= 0) {
            this.state = { kind: 'pickup', ped, away: 0 };
            this.toast('Someone is waving you down. Follow the yellow marker and stop next to them.');
          } else s.wait = 3;
        }
      }
    } else if (s.kind === 'pickup') {
      const f = this.peds.fareAt(s.ped);
      if (!f.waiting) { this.cancel('Your fare ran off.'); return; }
      this.pin.position.set(f.x, 2.35 + Math.sin(this.time * 3) * 0.12, f.z);
      this.pin.rotation.y = this.time * 1.5;
      const d = Math.hypot(f.x - ctx.px, f.z - ctx.pz);
      // walked off or drove far away: they give up
      s.away = d > 450 || !tuk ? s.away + dt : 0;
      if (s.away > 40 || d > 700) { this.cancel(''); return; }
      if (tuk && d < 6 && Math.abs(tuk.speed) < 1.5) this.board(s.ped, tuk);
    } else if (s.kind === 'ride') {
      s.t += dt;
      if (tuk && Math.hypot(s.x - tuk.x, s.z - tuk.z) < 14 && Math.abs(tuk.speed) < 1.5) { this.arrive(s, tuk); return; }
    }
    this.panel(ctx);
  }

  // ----------------------------------------------------------------

  private board(ped: number, tuk: { x: number; z: number }) {
    // somewhere 0.8-4 km away, so a fare is a few minutes' drive
    const options = this.city.landmarks.filter((l) => {
      const d = Math.hypot(l.x - tuk.x, l.z - tuk.z);
      return d > 800 && d < 4000;
    });
    const pool = options.length ? options : this.city.landmarks;
    const to = pool[Math.floor(Math.random() * pool.length)];
    const stop = this.kerbNear(to.x, to.z);
    const dist = Math.hypot(stop.x - tuk.x, stop.z - tuk.z);
    this.peds.boardFare(ped);
    // par time: the roads wind (x1.35) and traffic averages about 7 m/s, plus a little slack
    const par = (dist * 1.35) / 7 + 25;
    this.state = { kind: 'ride', ped, to, x: stop.x, z: stop.z, dist, par, t: 0, knocks: 0, worst: 0 };
    this.beam.position.set(stop.x, 0, stop.z);
    this.toast(`"${to.n}, please." Follow the yellow beam. Fare about Rs ${fareFor(dist * 1.35).toLocaleString()}.`);
  }

  private arrive(s: Extract<State, { kind: 'ride' }>, tuk: { x: number; z: number; heading: number }) {
    const fare = fareFor(s.dist * 1.35);
    // tip: up to 30% for beating the par time, less for every knock, nothing after a bad crash
    const quick = THREE.MathUtils.clamp((s.par - s.t) / (s.par * 0.4), 0, 1);
    const care = s.worst > 7 ? 0 : Math.max(0, 1 - s.knocks * 0.25);
    const tip = Math.round((fare * 0.3 * quick * care) / 10) * 10;
    this.money += fare + tip;
    try { localStorage.setItem(MONEY_KEY, String(this.money)); } catch { /* storage blocked */ }
    // they step out on the kerb side (left)
    const hx = Math.sin(tuk.heading), hz = Math.cos(tuk.heading);
    this.peds.dropFare(s.ped, tuk.x + hz * 1.4, tuk.z - hx * 1.4, tuk.x, tuk.z);
    const verdict = s.worst > 7 ? 'That crash scared them: no tip.'
      : s.knocks === 0 && quick > 0 ? 'Smooth and quick. Thank you!'
      : s.knocks > 2 ? 'A bumpy ride.'
      : quick <= 0 ? 'Took a while, but you got there.' : 'Nice driving.';
    this.toast(`${s.to.n}: fare Rs ${fare.toLocaleString()}${tip ? ` + tip Rs ${tip.toLocaleString()}` : ''}. ${verdict}`, 6);
    this.showMoney(true);
    this.onPaid();
    this.state = { kind: 'idle', wait: 6 };
  }

  private cancel(msg: string) {
    const s = this.state;
    if (s.kind === 'pickup' || s.kind === 'ride') this.peds.releaseFare(s.ped);
    if (s.kind !== 'off') this.state = { kind: 'idle', wait: 8 };
    if (msg) this.toast(msg);
    $('job').classList.remove('show');
  }

  /** a point at the kerb of the nearest drivable road to (x, z) */
  private kerbNear(x: number, z: number) {
    const g = this.roads;
    for (const r of [80, 200, 500]) {
      let best = -1, bs = 0, bd = Infinity;
      for (const id of g.edgesNear(x, z, r)) {
        const e = g.edges[id], n = g.nodes[e.a];
        if (e.cls === 0) continue; // not on the expressway
        const s = THREE.MathUtils.clamp((x - n.x) * e.dx + (z - n.z) * e.dz, 0, e.len);
        const d = Math.hypot(n.x + e.dx * s - x, n.z + e.dz * s - z);
        if (d < bd) { bd = d; best = id; bs = s; }
      }
      if (best >= 0) {
        const e = g.edges[best], n = g.nodes[e.a];
        return { x: n.x + e.dx * bs, z: n.z + e.dz * bs };
      }
    }
    return { x, z };
  }

  private panel(ctx: TaxiContext) {
    const s = this.state, el = $('job');
    if (s.kind !== 'pickup' && s.kind !== 'ride') { el.classList.remove('show'); return; }
    el.classList.add('show');
    const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
    if (s.kind === 'pickup') {
      const f = this.peds.fareAt(s.ped);
      $('job-title').textContent = 'Pick up your fare';
      $('job-info').textContent = `${km(Math.hypot(f.x - ctx.px, f.z - ctx.pz))} away · stop beside them`;
    } else {
      const left = Math.max(0, s.par - s.t);
      const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
      $('job-title').textContent = `To ${s.to.n}`;
      $('job-info').textContent = `${km(Math.hypot(s.x - ctx.px, s.z - ctx.pz))} · tip time ${mm}:${String(ss).padStart(2, '0')}${s.knocks ? ` · ${s.knocks} bump${s.knocks > 1 ? 's' : ''}` : ''}`;
    }
  }

  private toast(msg: string, secs = 4.5) {
    $('job-toast').textContent = msg;
    $('job-toast').classList.add('show');
    this.toastT = secs;
  }

  private showMoney(flash = false) {
    const el = $('money');
    el.textContent = `Rs ${this.money.toLocaleString()}`;
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
}
