import { seededRandom } from './ink-strokes';

const FULL_W = 1800;
const FULL_H = 1024;
const FULL_ASPECT = FULL_W / FULL_H;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface TreeBackdropConfig {
  src: string;
  nightSrc?: string;
  coreWidth: number;
  coreOffsetX: number;
  splitNy: number;
  strips: number;
  swayAmp: number;
  windDirection: 1 | -1;
  palette: readonly string[];
  nightPalette?: readonly string[];
  spawnXRange: readonly [number, number];
  spawnYRange: readonly [number, number];
  seed: number;
}

interface SceneMetrics {
  width: number;
  height: number;
  artX: number;
  artY: number;
  artW: number;
  artH: number;
  scale: number;
}

interface DotParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  phase: number;
  twinkle: number;
  life: number;
  maxLife: number;
}

function computeMetrics(width: number, height: number, coreWidth: number): SceneMetrics {
  const coreAspect = coreWidth / FULL_H;
  const topPad = height >= 640
    ? Math.min(182, Math.max(152, height * 0.18))
    : Math.max(96, height * 0.14);
  let artH = Math.max(360, height - topPad);
  const maxCoreW = width * 0.94;
  if (artH * coreAspect > maxCoreW) {
    artH = maxCoreW / coreAspect;
  }
  const artW = artH * FULL_ASPECT;
  const artX = (width - artW) * 0.5;
  const artY = height - artH;
  return { width, height, artX, artY, artW, artH, scale: artH / FULL_H };
}

/** 仅在超宽视口下把左右最外侧平缓地面继续无缝延展到屏幕边缘。 */
function paintUltraWideGround(ctx: CanvasRenderingContext2D, img: HTMLImageElement, m: SceneMetrics) {
  if (m.artX > 0) {
    const srcW = 64;
    ctx.drawImage(img, 0, 0, srcW, FULL_H, 0, m.artY, Math.ceil(m.artX) + 4, m.artH);
  }
  const rightStart = m.artX + m.artW;
  if (rightStart < m.width) {
    const srcW = 64;
    ctx.drawImage(img, FULL_W - srcW, 0, srcW, FULL_H, rightStart - 2, m.artY, Math.ceil(m.width - rightStart) + 4, m.artH);
  }
}

/** 保留 100% 原画质感，仅对树冠以上做轻微水平风浪切片摆动，地面与风带底座保持稳固。 */
function paintSwayingArtwork(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  m: SceneMetrics,
  cfg: TreeBackdropConfig,
  time: number,
  breezeBias: number,
) {
  paintUltraWideGround(ctx, img, m);

  if (time === 0 && Math.abs(breezeBias) < 0.001) {
    ctx.drawImage(img, m.artX, m.artY, m.artW, m.artH);
    return;
  }

  const splitSy = Math.round(FULL_H * cfg.splitNy);
  const splitDy = m.artY + m.artH * cfg.splitNy;
  ctx.drawImage(
    img,
    0, splitSy - 1, FULL_W, FULL_H - splitSy + 1,
    m.artX, splitDy - 0.8, m.artW, m.artH - (splitDy - m.artY) + 0.8,
  );

  const amp = cfg.swayAmp * m.scale;
  const phaseSign = -cfg.windDirection;
  for (let i = 0; i < cfg.strips; i++) {
    const ny0 = (i / cfg.strips) * cfg.splitNy;
    const ny1 = ((i + 1) / cfg.strips) * cfg.splitNy;
    const nyMid = (ny0 + ny1) * 0.5;
    const sy = ny0 * FULL_H;
    const sh = (ny1 - ny0) * FULL_H;
    const dy = m.artY + ny0 * m.artH;
    const dh = (ny1 - ny0) * m.artH;

    const bend = smoothstep(cfg.splitNy, 0.06, nyMid);
    const wave = Math.sin(time * 0.72 + phaseSign * nyMid * 3.0) * 0.65
      + Math.sin(time * 1.30 - phaseSign * nyMid * 1.8) * 0.35
      + breezeBias * 0.55;
    const dx = wave * bend * amp;
    const dyBob = Math.cos(time * 0.86 - nyMid * 2.1) * bend * 0.8 * m.scale;

    ctx.drawImage(
      img,
      0, Math.max(0, sy - 1), FULL_W, sh + 2,
      m.artX + dx, dy + dyBob - 0.6, m.artW, dh + 1.2,
    );
  }
}

class DotParticles {
  private rand: () => number;
  private dots: DotParticle[] = [];
  private activePalette: readonly string[];

  constructor(private cfg: TreeBackdropConfig) {
    this.rand = seededRandom(cfg.seed);
    this.activePalette = cfg.palette;
  }

  setNight(night: boolean) {
    const next = (night && this.cfg.nightPalette?.length) ? this.cfg.nightPalette : this.cfg.palette;
    if (next === this.activePalette) return;
    this.activePalette = next;
    for (let i = 0; i < this.dots.length; i++) {
      this.dots[i].color = this.pick(this.activePalette);
    }
  }

  private between(a: number, b: number) { return a + this.rand() * (b - a); }
  private pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.rand() * arr.length)]; }

  reset(m: SceneMetrics) {
    this.dots = Array.from({ length: 110 }, () => this.spawn(m, true));
  }

  private spawn(m: SceneMetrics, initial = false): DotParticle {
    const maxLife = this.between(5.5, 11.0);
    const life = initial ? this.between(0, maxLife) : 0;
    const s = Math.max(0.75, m.scale);
    const vx = this.cfg.windDirection * this.between(18, 42) * s;
    const vy = this.between(-11, 5.5) * s;
    const nx = this.between(this.cfg.spawnXRange[0], this.cfg.spawnXRange[1]);
    const ny = this.between(this.cfg.spawnYRange[0], this.cfg.spawnYRange[1]);
    const ox = m.artX + ((this.cfg.coreOffsetX + nx * this.cfg.coreWidth) / FULL_W) * m.artW;
    const oy = m.artY + ny * m.artH;
    return {
      x: ox + (initial ? vx * life * 0.72 : 0),
      y: oy + (initial ? vy * life * 0.72 : 0),
      vx,
      vy,
      color: this.pick(this.activePalette),
      alpha: this.between(0.42, 0.84),
      phase: this.between(0, TAU),
      twinkle: this.between(1.4, 3.0),
      life,
      maxLife,
    };
  }

  updateAndDraw(
    ctx: CanvasRenderingContext2D,
    m: SceneMetrics,
    dt: number,
    time: number,
    breezeBias: number,
  ) {
    const r = Math.max(1.8, 2.2 * m.scale);
    ctx.save();
    for (let i = 0; i < this.dots.length; i++) {
      const p = this.dots[i];
      if (dt > 0) {
        p.life += dt;
        p.x += (p.vx + breezeBias * 20 + Math.sin(time * 0.9 + p.phase) * 7) * dt;
        p.y += (p.vy + Math.cos(time * 1.15 + p.phase) * 5) * dt;
        if (p.life >= p.maxLife || p.x < -16 || p.x > m.width + 16 || p.y < m.height * 0.12 || p.y > m.height + 12) {
          this.dots[i] = this.spawn(m, false);
          continue;
        }
      }
      const progress = p.life / p.maxLife;
      const env = smoothstep(0, 0.16, progress) * (1 - smoothstep(0.76, 1, progress));
      if (env <= 0.01) continue;
      const pulse = 0.62 + 0.38 * Math.sin(time * p.twinkle + p.phase);
      ctx.globalAlpha = p.alpha * env * pulse;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function mountTreeBackdrop(scene: HTMLElement, cfg: TreeBackdropConfig): () => void {
  const canvas = scene.querySelector('canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return () => {};

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const particles = new DotParticles(cfg);

  let width = 0;
  let height = 0;
  let ratio = 1;
  let metrics: SceneMetrics | undefined;
  let disposed = false;
  let frame = 0;
  let previous = 0;
  let time = 0;
  let breezeBias = 0;
  let targetBias = 0;
  let lastPointerX = -1;

  let isNight = document.documentElement.dataset.theme === 'night';
  particles.setNight(isNight);

  const img = new Image();
  img.decoding = 'async';
  const nightImg = cfg.nightSrc ? new Image() : null;
  if (nightImg) nightImg.decoding = 'async';

  const activeImage = () => (isNight && nightImg && nightImg.complete && nightImg.naturalWidth > 0 ? nightImg : img);

  const drawFrame = (dt: number) => {
    if (disposed || !metrics || !scene.isConnected) return;
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const curImg = activeImage();
    if (!curImg.complete || curImg.naturalWidth === 0) return;

    const activeTime = motion.matches ? 0 : time;
    if (!motion.matches && dt > 0) {
      breezeBias += (targetBias - breezeBias) * Math.min(1, dt * 4.0);
      targetBias *= Math.pow(0.16, dt);
    } else {
      breezeBias = 0;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintSwayingArtwork(ctx, curImg, metrics, cfg, activeTime, breezeBias);
    particles.updateAndDraw(ctx, metrics, motion.matches ? 0 : dt, activeTime, breezeBias);
  };

  const playing = () => !document.hidden && !motion.matches && !disposed && scene.isConnected;

  const tick = (now: number) => {
    frame = 0;
    if (!playing()) {
      previous = 0;
      return;
    }
    // 装饰背景与光标分频，大画布最多每秒重绘约 30 次。
    if (previous && now - previous < 1000 / 30 - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
    if (previous) time += dt;
    previous = now;
    drawFrame(dt);
    frame = requestAnimationFrame(tick);
  };

  const updatePlayback = () => {
    if (playing()) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      frame = previous = 0;
    }
  };

  const resize = () => {
    const nextW = scene.clientWidth;
    const nextH = scene.clientHeight;
    if (!nextW || !nextH) return;
    const nextRatio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(1_800_000 / (nextW * nextH)));
    if (width === nextW && height === nextH && ratio === nextRatio) return;
    width = nextW;
    height = nextH;
    ratio = nextRatio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    metrics = computeMetrics(width, height, cfg.coreWidth);
    particles.reset(metrics);
    drawFrame(0);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (motion.matches || e.pointerType !== 'mouse') return;
    if (lastPointerX >= 0) {
      const vx = e.clientX - lastPointerX;
      targetBias = clamp(targetBias + vx * 0.012, -1.0, 1.0);
    }
    lastPointerX = e.clientX;
  };

  const onMotionChange = () => {
    drawFrame(0);
    updatePlayback();
  };

  const onImgLoad = () => {
    drawFrame(0);
    updatePlayback();
  };

  img.addEventListener('load', onImgLoad);
  img.src = cfg.src;
  if (nightImg && cfg.nightSrc) {
    nightImg.addEventListener('load', onImgLoad);
    nightImg.src = cfg.nightSrc;
  }

  const themeObserver = new MutationObserver(() => {
    const nextNight = document.documentElement.dataset.theme === 'night';
    if (nextNight === isNight) return;
    isNight = nextNight;
    particles.setNight(isNight);
    drawFrame(0);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const observer = new ResizeObserver(resize);
  observer.observe(scene);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  motion.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', updatePlayback);

  resize();
  updatePlayback();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    img.removeEventListener('load', onImgLoad);
    nightImg?.removeEventListener('load', onImgLoad);
    themeObserver.disconnect();
    observer.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    motion.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', updatePlayback);
  };
}
