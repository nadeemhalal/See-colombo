import type { CityData, Landmark } from '../types';
import { ROAD_TYPES } from '../types';

const $ = (id: string) => document.getElementById(id)!;

/** Location readout, district banner, landmark cards, clock. */
export class Hud {
  private district = '';
  private bannerTimer = 0;
  private cardFor = '';
  private roadSegs: { ax: number; az: number; bx: number; bz: number; n: string; half: number }[] = [];
  private roadGrid = new Map<number, number[]>();
  private lastLookup = 0;

  constructor(private city: CityData, private visited: Set<string>, private onVisit: () => void) {
    for (const r of city.roads) {
      if (!r.n || ROAD_TYPES[r.t] === 'footway') continue;
      for (let i = 0; i < r.p.length / 2 - 1; i++) {
        const s = { ax: r.p[i * 2], az: r.p[i * 2 + 1], bx: r.p[i * 2 + 2], bz: r.p[i * 2 + 3], n: r.n, half: r.w / 2 };
        const idx = this.roadSegs.push(s) - 1;
        for (let cx = Math.floor(Math.min(s.ax, s.bx) / 50) - 1; cx <= Math.floor(Math.max(s.ax, s.bx) / 50) + 1; cx++)
          for (let cz = Math.floor(Math.min(s.az, s.bz) / 50) - 1; cz <= Math.floor(Math.max(s.az, s.bz) / 50) + 1; cz++) {
            const k = (cx + 1000) * 2000 + cz + 1000;
            let a = this.roadGrid.get(k);
            if (!a) this.roadGrid.set(k, (a = []));
            a.push(idx);
          }
      }
    }
    this.updateCount();
  }

  private nearestRoad(x: number, z: number) {
    const ids = this.roadGrid.get((Math.floor(x / 50) + 1000) * 2000 + Math.floor(z / 50) + 1000) ?? [];
    let best = 30, name = '';
    for (const i of ids) {
      const s = this.roadSegs[i];
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, l2 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0));
      const d = Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz)) - s.half;
      if (d < best) { best = d; name = s.n; }
    }
    return name;
  }

  private nearestPlace(x: number, z: number) {
    let best = 1800, name = 'Colombo';
    for (const p of this.city.places) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best) { best = d; name = p.n; }
    }
    return name;
  }

  private updateCount() {
    $('found').textContent = `Landmarks found: ${this.visited.size} / ${this.city.landmarks.length}`;
  }

  private showCard(l: Landmark | null) {
    const el = $('card');
    if (!l) { el.classList.remove('show'); this.cardFor = ''; return; }
    if (this.cardFor === l.id) return;
    this.cardFor = l.id;
    $('card-title').textContent = l.n;
    $('card-info').textContent = l.info;
    el.classList.add('show');
  }

  update(dt: number, x: number, z: number, minutes: number) {
    const now = performance.now();
    if (now - this.lastLookup > 250) {
      this.lastLookup = now;
      const place = this.nearestPlace(x, z);
      const road = this.nearestRoad(x, z);
      $('loc-road').textContent = road || ' ';
      $('loc-area').textContent = place;
      if (place !== this.district) {
        if (this.district) {
          $('banner').textContent = place;
          $('banner').classList.add('show');
          this.bannerTimer = 3;
        }
        this.district = place;
      }

      let near: Landmark | null = null;
      let bestD = Infinity;
      for (const l of this.city.landmarks) {
        const radius = ['lotus', 'beiralake', 'gallefacegreen', 'viharamahadevi'].includes(l.id) ? 120 : 60;
        const d = Math.hypot(l.x - x, l.z - z);
        if (d < radius && d < bestD) { bestD = d; near = l; }
      }
      this.showCard(near);
      if (near && !this.visited.has(near.id)) {
        this.visited.add(near.id);
        this.updateCount();
        this.onVisit();
      }
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) $('banner').classList.remove('show');
    }
    const hh = Math.floor(minutes / 60) % 24, mm = Math.floor(minutes % 60);
    $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
