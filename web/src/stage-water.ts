import type { StageTheme } from './stage-theme';
import { RainAtmosphere, rainWaterLine } from './reference/rain-blossom';
import { dayLandscapeBounds, maskDayLandscape, STAGE_STACKED_QUERY } from './stage-sky';

type Ring = { x: number; y: number; age: number; life: number; size: number };
const TAU = Math.PI * 2;

/** Water shimmer and rain ripples adapted from rain-blossom/index.html. */
export class StageWater {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private time = 0;
  private rings: Ring[] = [];
  private night = false;
  private rain = new RainAtmosphere();
  private dayScene = dayLandscapeBounds(0, 0, false);
  private observer: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas); this.resize();
  }

  private resize() {
    const box = this.canvas.getBoundingClientRect();
    this.width = box.width; this.height = box.height; this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.dayScene = dayLandscapeBounds(this.width, this.height, matchMedia(STAGE_STACKED_QUERY).matches);
    this.rings = [];
    this.rain.resize(this.width, this.height);
  }

  setTheme(theme: StageTheme) {
    this.night = theme === 'night';
    this.rings = [];
  }

  draw(dt: number, playing: boolean, paperClearing?: HTMLCanvasElement) {
    if (!this.width || !this.height) return;
    const top = this.night ? rainWaterLine(this.height) : this.dayScene.horizon;
    const bottom = this.night ? this.height : this.dayScene.height;
    const surfaceWidth = this.night ? this.width : this.dayScene.width;
    const depth = bottom - top;
    if (playing) {
      this.time += dt;
      for (const r of this.rings) r.age += dt;
      this.rings = this.rings.filter(r => r.age < r.life);
    }
    const c = this.ctx, t = this.time;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, this.width, this.height);
    c.save();
    c.beginPath();
    if (this.night) {
      c.moveTo(0, top);
      for (let x = 0; x <= this.width + 16; x += 16) c.lineTo(x, top + Math.sin(x * .009 + t * .35) * 2.4 + Math.sin(x * .021 - t * .2));
      c.lineTo(this.width, bottom); c.lineTo(0, bottom); c.closePath();
    } else {
      c.rect(0, top, surfaceWidth, depth);
    }
    c.clip();
    if (this.night) {
      const wash = c.createLinearGradient(0, top, 0, bottom);
      wash.addColorStop(0, 'rgba(130,168,182,0)');
      wash.addColorStop(.22, 'rgba(21,44,121,.04)');
      wash.addColorStop(.68, 'rgba(9,35,109,.06)');
      wash.addColorStop(1, 'rgba(9,35,109,.09)');
      c.fillStyle = wash; c.fillRect(0, top - 5, surfaceWidth, depth + 5);
    }

    // 波纹由远及近逐渐拉开、加粗，笔触两端自然收尖。
    for (let row = 0; row < (this.night ? 0 : 13); row++) {
      const near = row / 12;
      const y = top + 8 + Math.pow(near, 1.75) * (depth - 17);
      c.fillStyle = row % 3 === 1
        ? `rgba(72,121,126,${.09 + near * .19})`
        : `rgba(255,255,245,${.15 + near * .45})`;
      for (let j = 0; j < 6; j++) {
        const phase = row * .9 + j * 1.7;
        const x = (j / 6 * surfaceWidth + row * 71 + Math.sin(t * .28 + phase) * 14 + surfaceWidth) % surfaceWidth;
        const length = (28 + (row * 43 + j * 67) % 122) * (.20 + near) * Math.min(1, surfaceWidth / 800 + .22);
        const shift = Math.sin(t * .5 + phase) * (1 + near * 2.3);
        const thickness = (.6 + near * 2.3) * (.65 + j % 3 * .16);
        c.beginPath();
        c.moveTo(x, y + shift);
        c.bezierCurveTo(x + length * .3, y - shift, x + length * .73, y + shift, x + length, y);
        c.bezierCurveTo(x + length * .73, y + shift + thickness, x + length * .3, y - shift + thickness, x, y + shift);
        c.fill();
      }
    }

    // Reused rain-blossom shimmer and two open arcs, with a quieter daylight palette.
    if (this.night) c.globalCompositeOperation = 'screen';
    for (let i = 0; i < (this.night ? 45 : 38); i++) {
      const x = i * 131.37 % surfaceWidth, y = top + 14 + i * 47.79 % Math.max(1, depth - 20);
      const shimmer = .5 + .5 * Math.sin(t * .7 + i * 2.7);
      c.fillStyle = this.night ? `rgba(106,151,238,${.018 + shimmer * .025})` : `rgba(246,252,240,${.08 + shimmer * .15})`;
      c.beginPath(); c.ellipse(x + Math.sin(t * .2 + i) * 6, y, (this.night ? 20 : 12) + i % 6 * 5, this.night ? 1.5 + i % 3 * .7 : .5 + i % 3 * .3, 0, 0, TAU); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    if (!this.night) {
      c.restore();
      maskDayLandscape(c, this.width, this.height, this.dayScene, paperClearing);
      return;
    }
    for (const r of this.rings) {
      const progress = r.age / r.life, radius = 1 + progress * r.size;
      c.strokeStyle = `rgba(208,219,255,${(1 - progress) * .34})`;
      c.lineWidth = .7;
      c.beginPath(); c.ellipse(r.x, r.y, radius, radius * .21, 0, .12, Math.PI * 1.15); c.stroke();
      c.beginPath(); c.ellipse(r.x, r.y, radius * .8, radius * .17, 0, Math.PI * 1.22, TAU); c.stroke();
    }
    c.restore();
    this.rain.draw(c, dt, playing, point => {
      if (this.rings.length < 90) this.rings.push({ ...point, age: 0 });
    });
  }

  destroy() { this.observer.disconnect(); this.rings = []; }
}
