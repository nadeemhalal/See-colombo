import type { CityData } from '../types';
import { MAP_MPP, type RoadLabel } from './mapRender';

/** Rotating circular minimap: camera forward is always up. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private size = 210;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  zoom = 1.1; // screen px per map px

  constructor(el: HTMLCanvasElement, private map: HTMLCanvasElement, private labels: RoadLabel[], private city: CityData, private visited: Set<string>) {
    el.width = this.size * this.dpr;
    el.height = this.size * this.dpr;
    el.style.width = el.style.height = `${this.size}px`;
    this.ctx = el.getContext('2d')!;
  }

  draw(px: number, pz: number, camYaw: number, facing: number) {
    const ctx = this.ctx, S = this.size, R = S / 2;
    const { minX, minZ } = this.city.bounds;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#80b0c8';
    ctx.fillRect(0, 0, S, S);

    // keep the same metres-per-pixel on screen whatever resolution the map was drawn at
    const zm = (this.zoom * MAP_MPP) / 2;
    const mx = (px - minX) / MAP_MPP, mz = (pz - minZ) / MAP_MPP;
    ctx.translate(R, R);
    ctx.rotate(camYaw);
    ctx.scale(zm, zm);
    ctx.drawImage(this.map, -mx, -mz);

    // landmarks
    for (const l of this.city.landmarks) {
      const x = (l.x - px) / MAP_MPP, z = (l.z - pz) / MAP_MPP;
      if (Math.hypot(x, z) * zm > R) continue;
      ctx.beginPath();
      ctx.arc(x, z, 4.5 / zm, 0, Math.PI * 2);
      ctx.fillStyle = this.visited.has(l.id) ? '#3a9d5d' : '#d9534f';
      ctx.fill();
      ctx.lineWidth = 1.5 / zm;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.restore();

    // street names, upright
    ctx.save();
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cos = Math.cos(camYaw), sin = Math.sin(camYaw);
    for (const lb of this.labels) {
      const dx = ((lb.x - px) / MAP_MPP) * zm, dz = ((lb.z - pz) / MAP_MPP) * zm;
      const sx = dx * cos - dz * sin, sy = dx * sin + dz * cos;
      if (Math.hypot(sx, sy) > R - 18) continue;
      let a = lb.a + camYaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      ctx.save();
      ctx.translate(R + sx, R + sy);
      ctx.rotate(a);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = lb.major ? '#5a3d00' : '#333';
      ctx.strokeText(lb.n, 0, 0);
      ctx.fillText(lb.n, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // player arrow
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(Math.PI - facing + camYaw);
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fillStyle = '#1e6fd9';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // north marker
    const nx = R + Math.sin(camYaw) * (R - 11), ny = R - Math.cos(camYaw) * (R - 11);
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);

    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,20,20,0.75)';
    ctx.stroke();
  }
}
