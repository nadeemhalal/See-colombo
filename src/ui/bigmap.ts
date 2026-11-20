import type { CityData } from '../types';
import { MAP_MPP } from './mapRender';

/** Full-screen north-up map. Drag to pan, wheel to zoom, click a spot to fast-travel there. */
export class BigMap {
  open = false;
  private ctx: CanvasRenderingContext2D;
  private scale = 0.5; // screen px per map px
  private cx = 0; // map px at screen centre
  private cz = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private player = { x: 0, z: 0, facing: 0 };
  onTravel: (x: number, z: number) => void = () => {};

  constructor(private el: HTMLCanvasElement, private map: HTMLCanvasElement, private city: CityData, private visited: Set<string>) {
    this.ctx = el.getContext('2d')!;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.min(4, Math.max(0.15, this.scale * (e.deltaY > 0 ? 0.85 : 1.18)));
      this.draw();
    }, { passive: false });
    el.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY, moved: false }; });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag || !this.open) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      this.cx -= dx / this.scale; this.cz -= dy / this.scale;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.draw();
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.drag || !this.open) return;
      const wasClick = !this.drag.moved;
      this.drag = null;
      if (wasClick && e.target === el) {
        const r = el.getBoundingClientRect();
        const mx = this.cx + (e.clientX - r.left - r.width / 2) / this.scale;
        const mz = this.cz + (e.clientY - r.top - r.height / 2) / this.scale;
        this.onTravel(mx * MAP_MPP + city.bounds.minX, mz * MAP_MPP + city.bounds.minZ);
      }
    });
    window.addEventListener('resize', () => this.open && this.draw());
  }

  show(px: number, pz: number, facing: number) {
    this.open = true;
    this.player = { x: px, z: pz, facing };
    this.cx = (px - this.city.bounds.minX) / MAP_MPP;
    this.cz = (pz - this.city.bounds.minZ) / MAP_MPP;
    this.el.parentElement!.classList.add('open');
    this.draw();
  }
  hide() {
    this.open = false;
    this.el.parentElement!.classList.remove('open');
  }

  draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.el.width = w * dpr; this.el.height = h * dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#80b0c8';
    ctx.fillRect(0, 0, w, h);
    const toScreen = (x: number, z: number) => [
      w / 2 + ((x - this.city.bounds.minX) / MAP_MPP - this.cx) * this.scale,
      h / 2 + ((z - this.city.bounds.minZ) / MAP_MPP - this.cz) * this.scale,
    ];
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.map, w / 2 - this.cx * this.scale, h / 2 - this.cz * this.scale, this.map.width * this.scale, this.map.height * this.scale);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // district names
    ctx.font = '600 13px system-ui, sans-serif';
    for (const p of this.city.places) {
      const [sx, sy] = toScreen(p.x, p.z);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.fillStyle = '#444';
      ctx.strokeText(p.n.toUpperCase(), sx, sy); ctx.fillText(p.n.toUpperCase(), sx, sy);
    }
    // landmarks
    ctx.font = '600 12px system-ui, sans-serif';
    for (const l of this.city.landmarks) {
      const [sx, sy] = toScreen(l.x, l.z);
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = this.visited.has(l.id) ? '#3a9d5d' : '#d9534f';
      ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = '#222';
      ctx.strokeText(l.n, sx, sy - 14); ctx.fillText(l.n, sx, sy - 14);
    }
    // player
    const [px, py] = toScreen(this.player.x, this.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - this.player.facing);
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath();
    ctx.fillStyle = '#1e6fd9'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
