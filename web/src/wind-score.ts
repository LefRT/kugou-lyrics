export const FLIGHT_ARTWORK_WIDTH = 1031;
export const FLIGHT_ARTWORK_HEIGHT = 1525;

type FlightSource = { x: number; y: number; w: number };
type Layer = 'back' | 'front';
type Flight = {
  art: number;
  layer: Layer;
  born: number;
  duration: number;
  departureBend: number;
  approachBend: number;
  destinationX: number;
  fadeEnd: number;
  lift: number;
  phase: number;
  swaySpeed: number;
  size: number;
};

const TAU = Math.PI * 2;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const smooth = (n: number) => { n = clamp(n); return n * n * (3 - 2 * n); };

// Trace only complete balloon bodies in the original illustration. The strings sway separately.
const BALLOONS = [
  { x: 726, y: 125, w: 130, h: 144, knotX: 803, knotY: 267, string: '#244a5a',
    outline: 'M 803 268 C 778 267 727 226 728 190 C 727 154 765 128 795 127 C 836 125 854 151 854 187 C 855 232 832 266 803 268 Z' },
  { x: 472, y: 158, w: 65, h: 71, knotX: 501, knotY: 228, string: '#355667',
    outline: 'M 501 228 C 484 228 473 212 473 194 C 473 177 486 159 505 159 C 524 159 537 175 536 195 C 535 212 521 229 501 228 Z' },
  { x: 434, y: 319, w: 84, h: 86, knotX: 453, knotY: 402, string: '#3f4d62',
    outline: 'M 453 402 C 432 394 431 371 438 353 C 444 336 449 326 466 322 C 485 317 502 320 512 334 C 521 346 516 363 510 376 C 501 394 477 406 453 402 Z' },
];

export class StageFlight {
  private readonly layers: Record<Layer, CanvasRenderingContext2D>;
  private source: FlightSource = { x: 0, y: 0, w: 0 };
  private width = 0;
  private height = 0;
  private fadeY = 0;
  private dpr = 1;
  private compact = false;
  private time = 0;
  private flights: Flight[] = [];
  private sprites: HTMLCanvasElement[] = [];
  private nextGroup = .55;

  constructor(
    back: HTMLCanvasElement,
    front: HTMLCanvasElement,
    private readonly illustration: HTMLImageElement,
    private readonly random: () => number = Math.random,
  ) {
    this.layers = { back: back.getContext('2d')!, front: front.getContext('2d')! };
  }

  setLayout(source: FlightSource, stageHeight: number, compact: boolean) {
    this.source = source;
    this.fadeY = stageHeight / 6;
    if (this.compact !== compact) {
      this.flights = [];
      this.nextGroup = this.time + .55;
    }
    this.compact = compact;

    const box = this.layers.front.canvas.getBoundingClientRect();
    this.width = box.width;
    this.height = box.height;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(this.width * this.dpr);
    const pixelHeight = Math.round(this.height * this.dpr);
    for (const { canvas } of Object.values(this.layers)) {
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }
  }

  draw(dt: number, night: boolean) {
    if (!this.width || !this.height) return;
    for (const c of Object.values(this.layers)) {
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.width, this.height);
    }
    if (!this.source.w || !this.illustration.naturalWidth) return;
    if (!this.sprites.length) this.prepareBalloons();
    this.time += dt;
    this.flights = this.flights.filter(flight => this.time - flight.born < flight.duration);
    if (this.time >= this.nextGroup) this.launchGroup();
    for (const flight of this.flights) {
      if (flight.born <= this.time) this.drawFlight(flight, night);
    }
  }

  private range(min: number, max: number) { return min + this.random() * (max - min); }

  private prepareBalloons() {
    this.sprites = BALLOONS.map(art => {
      const canvas = document.createElement('canvas');
      canvas.width = art.w;
      canvas.height = art.h;
      const c = canvas.getContext('2d')!;
      c.translate(-art.x, -art.y);
      c.clip(new Path2D(art.outline));
      c.drawImage(this.illustration, 0, 0);
      return canvas;
    });
  }

  private launchGroup() {
    const available = (this.compact ? 4 : 5) - this.flights.length;
    if (!available) return;
    const roll = this.random();
    const count = Math.min(available, roll < .24 ? 1 : roll < .85 ? 2 : 3);
    const firstArt = Math.floor(this.random() * BALLOONS.length);
    let lastLaunch = this.time;
    for (let i = 0; i < count; i++) {
      if (i > 0) lastLaunch += this.range(.24, .70);
      this.flights.push({
        art: (firstArt + i) % BALLOONS.length,
        layer: i === 0 || this.random() < .34 ? 'front' : 'back',
        born: lastLaunch,
        duration: this.compact ? this.range(5.7, 8.6) : this.range(8.5, 12.5),
        departureBend: this.range(-.29, .35),
        approachBend: this.range(-.34, .31),
        destinationX: this.random() < .16 ? this.range(.64, .99) : this.range(.04, .60),
        fadeEnd: this.range(.44, .65),
        lift: this.range(-.24, .37),
        phase: this.range(0, TAU),
        swaySpeed: this.range(.9, 1.8),
        size: this.range(.9, 1.10),
      });
    }
    this.nextGroup = lastLaunch + this.range(2.9, 4.3);
  }

  private drawFlight(flight: Flight, night: boolean) {
    const c = this.layers[flight.layer], art = BALLOONS[flight.art];
    const age = this.time - flight.born, progress = age / flight.duration, remaining = 1 - progress;
    const fit = this.source.w / FLIGHT_ARTWORK_WIDTH;
    const startX = this.source.x + (art.x + art.w / 2) * fit;
    const startY = this.source.y + (art.y + art.h / 2) * fit;
    const scale = flight.size * clamp(fit * art.w, this.compact ? 10 : 15, 35) / art.w;
    // Keep the whole curve within the left side without flattening it at a screen edge.
    const margin = Math.max(16, art.w * scale * .75);
    const right = this.width * (this.compact ? .70 : .85);
    const span = Math.max(0, right - margin);
    const endX = margin + span * flight.destinationX;
    const controlX1 = clamp(startX + span * flight.departureBend, margin, right);
    const controlX2 = clamp(endX + span * flight.approachBend, margin, right);
    const x = remaining ** 3 * startX + 3 * remaining ** 2 * progress * controlX1
      + 3 * remaining * progress ** 2 * controlX2 + progress ** 3 * endX;
    const drift = remaining ** 2 * (controlX1 - startX) + 2 * remaining * progress * (controlX2 - controlX1)
      + progress ** 2 * (endX - controlX2);
    const fadeStart = Math.min(this.fadeY, startY - 8);
    const endY = fadeStart * flight.fadeEnd;
    const y = startY + (endY - startY) * (progress + flight.lift * progress * remaining);
    const sway = Math.sin(age * flight.swaySpeed + flight.phase);
    c.save();
    c.translate(x, y);
    c.rotate(sway * .105 + clamp(drift / 260, -.7, .7) * .17);
    c.scale(scale, scale);
    c.globalAlpha = (flight.layer === 'back' ? .88 : .96)
      * smooth(age / .38) * (1 - smooth((fadeStart - y) / (fadeStart - endY)));
    this.drawBalloon(c, flight.art, sway, scale, night);
    c.restore();
  }

  private drawBalloon(c: CanvasRenderingContext2D, index: number, sway: number, scale: number, night: boolean) {
    const art = BALLOONS[index];
    const x = art.knotX - art.x - art.w / 2, y = art.knotY - art.y - art.h / 2;
    const length = art.h * .48, swing = sway * art.w * .25;
    c.strokeStyle = night ? '#a0bfd1' : art.string;
    c.lineWidth = Math.max(art.w * .035, 1.05 / scale);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y - 1);
    c.bezierCurveTo(x + swing * .8, y + length * .31, x - swing * .45, y + length * .62,
      x + swing * .6 - art.w * .16, y + length);
    c.stroke();
    c.drawImage(this.sprites[index], -art.w / 2, -art.h / 2);
  }
}
