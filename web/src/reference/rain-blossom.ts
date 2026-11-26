// Ported from /rain-blossom/index.html: the original blue paper, halo,
// luminous flowers, falling petals and rain. Only scene coordinates are adapted.
const TAU = Math.PI * 2;
function randomSource(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

let texture: HTMLCanvasElement | undefined, halo: HTMLCanvasElement | undefined;
function sprites() {
  if (texture && halo) return { texture, halo };
  const rand = randomSource(183927), between = (a: number, b: number) => a + rand() * (b - a);
  texture = document.createElement('canvas'); texture.width = 360; texture.height = 480;
  const tx = texture.getContext('2d')!, pixels = tx.createImageData(360, 480);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = between(0, 255);
    pixels.data[i] = n * .64; pixels.data[i + 1] = n * .74; pixels.data[i + 2] = n;
    pixels.data[i + 3] = between(7, 32);
  }
  tx.putImageData(pixels, 0, 0);
  for (let i = 0; i < 2600; i++) {
    const x = between(0, 360), y = between(0, 480);
    tx.strokeStyle = rand() > .5 ? 'rgba(3,12,63,.14)' : 'rgba(168,184,238,.06)';
    tx.lineWidth = between(.3, 2);
    tx.beginPath(); tx.moveTo(x, y); tx.lineTo(x + between(-1, 1), y + between(2, 30)); tx.stroke();
  }
  halo = document.createElement('canvas'); halo.width = halo.height = 96;
  const hc = halo.getContext('2d')!, hg = hc.createRadialGradient(48, 48, 0, 48, 48, 48);
  hg.addColorStop(0, 'rgba(255,230,255,.65)'); hg.addColorStop(.16, 'rgba(244,206,255,.35)');
  hg.addColorStop(.4, 'rgba(174,175,255,.10)'); hg.addColorStop(1, 'rgba(126,155,255,0)');
  hc.fillStyle = hg; hc.fillRect(0, 0, 96, 96);
  return { texture, halo };
}

export const rainWaterLine = (height: number) => height * 1030 / 1336;

/** Call in stage coordinates so the two opaque background canvases join exactly. */
export function paintRainBackdrop(c: CanvasRenderingContext2D, width: number, height: number) {
  const { texture } = sprites(); c.save();
  const base = c.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, '#132e8c'); base.addColorStop(.5, '#193896'); base.addColorStop(1, '#102b82');
  c.fillStyle = base; c.fillRect(0, 0, width, height);
  const glow = c.createRadialGradient(width * .42, height * .34, 0, width * .42, height * .34, Math.max(width, height) * .73);
  glow.addColorStop(0, '#4760ba33'); glow.addColorStop(1, '#020c3d40');
  c.fillStyle = glow; c.fillRect(0, 0, width, height);
  const line = rainWaterLine(height), water = c.createLinearGradient(0, line, 0, height);
  water.addColorStop(0, '#040c455a'); water.addColorStop(.1, '#152c7930'); water.addColorStop(1, '#09236d30');
  c.fillStyle = water; c.fillRect(0, line, width, height - line);
  c.globalAlpha = .65; c.fillStyle = c.createPattern(texture, 'repeat')!; c.fillRect(0, 0, width, height);
  c.globalAlpha = .22; c.drawImage(texture, 0, 0, width, height); c.globalAlpha = 1;
  const vignette = c.createRadialGradient(width * .5, height * .45, Math.min(width, height) * .15, width * .5, height * .45, Math.max(width, height) * .75);
  vignette.addColorStop(0, '#00000000'); vignette.addColorStop(1, '#020b3b55');
  c.fillStyle = vignette; c.fillRect(0, 0, width, height); c.restore();
}

type Bloom = { x: number; y: number; size: number; pink: boolean; phase: number; speed: number; rotation: number; shape: number };
export function drawRainBlossom(c: CanvasRenderingContext2D, f: Bloom, t: number) {
  const pulse = .66 + .34 * Math.sin(t * f.speed + f.phase);
  const size = f.size * (1 + .055 * Math.sin(t * .8 + f.phase));
  c.save(); c.globalAlpha = .37 + pulse * .38;
  const glowSize = size * 9;
  c.drawImage(sprites().halo, f.x - glowSize / 2, f.y - glowSize / 2, glowSize, glowSize);
  c.translate(f.x, f.y); c.rotate(f.rotation + Math.sin(t * .55 + f.phase) * .05);
  c.globalAlpha = .78 + pulse * .22; c.fillStyle = f.pink ? '#f9b4e0' : '#fff3ff';
  const petals = f.shape === 3 ? 4 : 5;
  for (let k = 0; k < petals; k++) {
    const a = k * TAU / petals;
    c.beginPath(); c.ellipse(Math.cos(a) * size * .48, Math.sin(a) * size * .48, size * .64, size * .43, a, 0, TAU); c.fill();
  }
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 0, size * .34, 0, TAU); c.fill(); c.restore();
}

type Drop = { x: number; y: number; endY: number; velocity: number; length: number; alpha: number; drift: number };
type Petal = { x: number; y: number; velocity: number; size: number; phase: number; drift: number; pink: boolean };
type Splash = { x: number; y: number; life: number; size: number };

export class RainAtmosphere {
  private rand = randomSource(731839);
  private drops: Drop[] = [];
  private petals: Petal[] = [];
  private width = 0;
  private height = 0;
  private scale = 1;
  private time = 0;
  private credit = 0;
  private between(a: number, b: number) { return a + this.rand() * (b - a); }
  resize(width: number, height: number) {
    this.width = width; this.height = height; this.scale = Math.min(width / 1000, height / 1336);
    this.drops = Array.from({ length: 70 }, () => this.makeDrop(true));
    this.petals = Array.from({ length: 38 }, () => this.makePetal(true));
  }
  private makeDrop(initial = false): Drop {
    const s = this.scale, start = this.between(this.height * .08, this.height * .67), endY = this.between(rainWaterLine(this.height) + 10 * s, this.height - 15 * s);
    return { x: this.between(this.width * .05, this.width * .95), y: initial ? this.between(start, endY) : start, endY,
      velocity: this.between(135, 245) * s, length: this.between(18, 110) * s, alpha: this.between(.16, .55), drift: this.between(3, 14) * s };
  }
  private makePetal(initial = false): Petal {
    const s = this.scale, start = this.between(this.height * .12, this.height * .65);
    return { x: this.between(this.width * .05, this.width * .95), y: initial ? this.between(start, this.height) : start,
      velocity: this.between(19, 43) * s, size: this.between(1.2, 3.5) * s, phase: this.between(0, TAU), drift: this.between(-9, 16) * s, pink: this.rand() < .3 };
  }
  draw(c: CanvasRenderingContext2D, dt: number, playing: boolean, splash: (point: Splash) => void) {
    if (!this.width || !this.height) return;
    if (playing) {
      this.time += dt;
      const shower = Math.pow(.5 + .5 * Math.sin(this.time * .46 - .8), 2);
      this.credit += dt * (9 + shower * 30);
      while (this.credit >= 1) { this.credit--; if (this.drops.length < 130) this.drops.push(this.makeDrop()); }
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i]; d.y += d.velocity * dt; d.x += d.drift * dt;
        if (d.y >= d.endY) { splash({ x: d.x, y: d.endY, life: this.between(1.5, 3), size: this.between(12, 30) * this.scale }); this.drops.splice(i, 1); }
      }
      for (let i = 0; i < this.petals.length; i++) {
        const p = this.petals[i]; p.y += p.velocity * dt; p.x += (p.drift + Math.sin(this.time * 1.1 + p.phase) * 13 * this.scale) * dt;
        if (p.y > this.height + 10) this.petals[i] = this.makePetal();
      }
    }
    const { halo } = sprites(), s = this.scale, t = this.time;
    c.save(); c.globalCompositeOperation = 'screen'; c.lineWidth = .65 * s;
    for (const d of this.drops) {
      const length = Math.min(d.length, d.y * .35), gradient = c.createLinearGradient(d.x - length * .055, d.y - length, d.x, d.y);
      gradient.addColorStop(0, 'rgba(194,206,255,0)'); gradient.addColorStop(1, `rgba(211,219,255,${d.alpha})`);
      c.strokeStyle = gradient; c.beginPath(); c.moveTo(d.x - length * .055, d.y - length); c.lineTo(d.x, d.y); c.stroke();
      c.globalAlpha = d.alpha * 1.4; c.drawImage(halo, d.x - 7 * s, d.y - 7 * s, 14 * s, 14 * s); c.globalAlpha = 1;
      c.fillStyle = '#f5eaff'; c.beginPath(); c.ellipse(d.x, d.y, 1.15 * s, 1.8 * s, -.12, 0, TAU); c.fill();
    }
    c.restore();
    for (const p of this.petals) {
      c.save(); c.translate(p.x, p.y); c.rotate(t * .7 + p.phase);
      c.globalAlpha = .35 + .45 * Math.abs(Math.sin(t + p.phase));
      c.drawImage(halo, -p.size * 4, -p.size * 4, p.size * 8, p.size * 8);
      c.fillStyle = p.pink ? '#f4a7db' : '#e8ebff';
      c.beginPath(); c.ellipse(0, 0, p.size, Math.max(.35 * s, p.size * .55 * Math.abs(Math.sin(t * 1.2 + p.phase))), .4, 0, TAU); c.fill(); c.restore();
    }
  }
}
