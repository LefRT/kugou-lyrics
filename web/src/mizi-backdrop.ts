import { makeStroke, seededRandom, strokeLines, type InkLine } from './ink-strokes';

const day = {
  graphite: '#3f4645', blueInk: '#304a57', coat: '#ece8da', hill: '#d9ded8',
};
const night: typeof day = {
  graphite: '#a0a8a6', blueInk: '#95b0bd', coat: '#262d30', hill: '#242f36',
};

// 每条书写线同时给出笔迹的位置和作品行的落点。
const writingLines: readonly InkLine[] = [
  [.111, .076, .765, .50], [.197, .076, .765, .48], [.283, .076, .765, .51],
  [.531, .440, .954, .51], [.619, .440, .954, .49],
  [.706, .110, .580, .51], [.793, .110, .580, .49], [.880, .110, .580, .50],
];
const landscapeLines: readonly InkLine[] = [
  [.091, .807, .963, .36], [.156, .829, .986, .41], [.239, .797, .946, .38],
  [.307, .009, .246, .39], [.321, .727, .987, .37], [.361, .791, .941, .32],
  [.417, .448, .580, .35], [.419, .701, .996, .41], [.456, .011, .886, .40],
  [.487, .098, .397, .43], [.516, .038, .341, .32], [.551, .149, .373, .37],
  [.582, .072, .375, .41], [.625, .161, .384, .33], [.652, .633, .973, .37],
  [.681, .786, .935, .34], [.725, .790, .982, .40], [.761, .818, .984, .35],
  [.783, .004, .075, .32], [.813, .799, .961, .37], [.854, .808, .988, .38],
  [.886, .641, .973, .41], [.916, .619, .836, .32],
];
const rippleLines: readonly InkLine[] = [
  [.471, .290, .733, .29], [.530, .154, .310, .28], [.600, .214, .372, .31],
  [.677, .683, .772, .24], [.782, .832, .963, .29], [.899, .719, .914, .26],
];

const workRowHeight = 32;
const workRuleInset = 4;
const continuationSpans = [
  [.11, .643, .49], [.11, .735, .48], [.11, .798, .51], [.11, .771, .47],
  [.11, .824, .49], [.11, .792, .51], [.11, .838, .47], [.11, .780, .50],
] as const;
const continuationTileHeight = continuationSpans.length * workRowHeight;

function makeSketch(canvasWidth: number, canvasHeight: number) {
  const inset = Math.min(8, canvasWidth * .018, canvasHeight * .06);
  const width = canvasWidth - inset * 2;
  const height = canvasHeight - inset * 2;
  const random = seededRandom(4081);
  const stroke = (line: InkLine) => makeStroke(line, width, height, random);
  return {
    inset, width, height,
    lines: landscapeLines.map(stroke),
    rules: writingLines.map(stroke),
    ripples: rippleLines.map(stroke),
  };
}

type Sketch = ReturnType<typeof makeSketch>;

function layoutWorkRows(list: HTMLUListElement, { inset, width, height }: Sketch) {
  const needsContinuation = list.childElementCount > writingLines.length;
  let bottom = 0;
  list.style.removeProperty('--continuation-top');
  for (const [index, row] of Array.from(list.children as HTMLCollectionOf<HTMLElement>).entries()) {
    const line = writingLines[index];
    const extra = index - writingLines.length;
    const [left, right] = line ? [line[1], line[2]] : continuationSpans[extra % continuationSpans.length];
    const top = line ? inset + line[0] * height - workRowHeight + workRuleInset : bottom;
    if (extra === 0) list.style.setProperty('--continuation-top', `${top}px`);
    row.style.setProperty('--work-gap', `${top - bottom}px`);
    row.style.setProperty('--work-left', `${inset + left * width}px`);
    row.style.setProperty('--work-right', `${inset + (1 - right) * width}px`);
    bottom = top + workRowHeight;
  }
  return needsContinuation;
}

// 续行共用一小块透明线稿，滚得再长也无需加大动画画布。
function makeContinuationInk({ inset, width }: Sketch, ratio: number, color: string) {
  const tile = document.createElement('canvas');
  tile.width = Math.round((width + inset * 2) * ratio);
  tile.height = Math.round(continuationTileHeight * ratio);
  const ctx = tile.getContext('2d');
  if (!ctx) return 'none';
  ctx.setTransform(ratio, 0, 0, ratio, inset * ratio, 0);
  const random = seededRandom(9457);
  const lines = continuationSpans.map(([start, end, opacity], index) => {
    const y = ((index + 1) * workRowHeight - workRuleInset) / continuationTileHeight;
    return makeStroke([y, start, end, opacity], width, continuationTileHeight, random);
  });
  strokeLines(ctx, lines, color);
  return `url("${tile.toDataURL()}")`;
}

function paintHills(ctx: CanvasRenderingContext2D, { width, height }: Sketch, ink: typeof day) {
  ctx.save();
  ctx.translate(0, height * .300);
  ctx.scale(width * .39 / 330, height * .173 / 100);
  const random = seededRandom(9581);
  const farHill = new Path2D('M93 79 105 64 118 49 125 36 137 31 145 22 156 21 166 25 177 31 190 34 205 32 212 28 223 32 235 41 247 48 257 59 271 66 281 76 295 80 312 85 328 89 298 89 268 87 243 91 207 88 175 90 147 89 111 92Z');
  const nearHill = new Path2D('M0 1 12 5 23 9 35 11 50 21 62 25 70 31 88 35 104 44 112 51 128 57 141 71 150 74 156 81 173 84 184 91 163 93 152 89 130 93 110 95 93 92 73 94 57 88 37 91 16 86 0 88Z');

  for (const [index, hill] of [farHill, nearHill].entries()) {
    ctx.fillStyle = ink.hill;
    ctx.fill(hill);
    ctx.save();
    ctx.clip(hill);
    const hatch = new Path2D();
    for (let x = 1; x < 330; x += 2.2 + random() * 3.8) {
      const drift = (random() - .5) * 5;
      const breakAt = 19 + random() * 60;
      hatch.moveTo(x - 1, 0);
      hatch.lineTo(x + drift * .45, breakAt);
      hatch.moveTo(x + drift * .58, breakAt + random() * 9);
      hatch.lineTo(x + drift, 91 + random() * 9);
    }
    ctx.globalAlpha = index ? .72 : .54;
    ctx.lineWidth = index ? 1.1 : .9;
    ctx.strokeStyle = ink.blueInk;
    ctx.stroke(hatch);
    ctx.restore();
    ctx.globalAlpha = index ? .86 : .66;
    ctx.lineWidth = 1.32;
    ctx.strokeStyle = ink.blueInk;
    ctx.stroke(hill);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = ink.blueInk;
  ctx.globalAlpha = .77;
  ctx.fill(new Path2D('M0 2 13 5 27 12 23 18 13 16 9 26 3 30 0 23Z M33 16 52 22 55 30 48 28 41 37 40 28 34 27Z M112 54 128 58 143 71 137 70 130 76 117 64Z M60 83 79 79 91 83 109 77 121 80 132 73 142 75 153 85 170 85 177 92 158 96 138 92 124 98 106 94 89 97 76 94Z M200 84 218 79 231 83 248 84 257 90 230 91 215 88 197 90Z'));
  ctx.restore();
}

const birdMarks = [
  [.328, .335, .28, .14], [.378, .363, .38, -.21], [.441, .339, .72, -.27],
  [.541, .379, .88, -.18], [.601, .345, .62, .04], [.684, .369, 1.04, -.26],
  [.660, .413, .56, .19],
] as const;

function paintDistantBirds(ctx: CanvasRenderingContext2D, { width, height }: Sketch, ink: typeof day) {
  const shape = new Path2D('M-9-4Q-6-5 -1-.4Q4-3 10-5Q8-1 3 1L1 4Q-2 5 -5 .3Z');
  const scale = Math.min(height / 295, width / 520);
  ctx.fillStyle = ink.blueInk;
  for (const [x, y, size, tilt] of birdMarks) {
    ctx.save();
    ctx.translate(x * width, y * height);
    ctx.rotate(tilt);
    ctx.scale(scale * size, scale * size);
    ctx.globalAlpha = .82;
    ctx.fill(shape);
    ctx.restore();
  }
}

// 两个人的衣摆和落脚各有自己的笔迹。
const walkers = [
  {
    head: 'M-4-64 -5-69 -1-75 4-76 8-71 6-66 2-62 -2-63Z',
    legs: 'M-7-32 1-30 -1-19 -6-8 -5-4 -11-2 -14-3 -11-9 -8-20Z M2-31 9-33 8-21 3-15 5-11 1-9 -3-13 -2-17 2-23Z',
    coat: 'M-3-62Q-9-60 -12-51L-15-42 -12-36 -9-38 -10-45 -7-50 -8-38 -7-30Q1-25 9-31L9-45 11-42 14-44 12-51 6-58 4-63Z',
    seams: 'M-2-61 0-58 4-60 M6-52 7-41 5-34 M-6-34 -2-31',
  },
  {
    head: 'M-4-64 -4-70 0-75 5-74 8-70 6-65 3-61 -2-62Z',
    legs: 'M-8-32 -1-30 -3-21 1-16 -1-11 -7-16 -10-20Z M1-31 9-34 8-23 4-12 2-5 6-2 3 0 -6-.9 -5-5 -2-14 -1-24Z',
    coat: 'M-3-61Q-10-56 -13-48L-16-42 -15-37 -11-40 -11-44 -7-49 -9-37 -9-29Q1-25 10-33L9-46 13-39 16-40 13-48 9-56 3-62Z',
    seams: 'M0-60 2-57 6-56 M-5-47 -7-35 -2-31 M7-42 8-37',
  },
] as const;

function paintWalkers(ctx: CanvasRenderingContext2D, { width, height }: Sketch, ink: typeof day) {
  const scale = Math.min(height / 462, width / 415);
  for (const [index, figure] of walkers.entries()) {
    ctx.save();
    ctx.translate(width * .696 + (index ? 28 : -25) * scale, height * (index ? .857 : .819));
    ctx.scale(scale * (index ? 1 : .92), scale * (index ? 1 : .95));
    ctx.fillStyle = ink.blueInk;
    ctx.globalAlpha = .28;
    ctx.fill(new Path2D('M-17-1 -8-3 5-2 12-.6 4 1 -9 1.2Z'));
    ctx.globalAlpha = .94;
    ctx.fill(new Path2D(figure.legs));
    ctx.fill(new Path2D(figure.head));
    const coat = new Path2D(figure.coat);
    ctx.fillStyle = ink.coat;
    ctx.fill(coat);
    ctx.strokeStyle = ink.blueInk;
    ctx.lineWidth = 1.84;
    ctx.stroke(coat);
    ctx.globalAlpha = .65;
    ctx.lineWidth = 1.08;
    ctx.stroke(new Path2D(figure.seams));
    ctx.restore();
  }
}

function paintSketch(ctx: CanvasRenderingContext2D, sketch: Sketch, ink: typeof day) {
  ctx.save();
  ctx.translate(sketch.inset, sketch.inset);
  strokeLines(ctx, sketch.lines, ink.graphite);
  strokeLines(ctx, sketch.rules, ink.graphite);
  paintHills(ctx, sketch, ink);
  paintDistantBirds(ctx, sketch, ink);
  paintWalkers(ctx, sketch, ink);
  ctx.restore();
}

function paintRipples(ctx: CanvasRenderingContext2D, sketch: Sketch, ink: typeof day, time: number) {
  ctx.save();
  ctx.translate(sketch.inset, sketch.inset);
  ctx.strokeStyle = ink.graphite;
  ctx.lineCap = 'round';
  const distance = Math.min(7, sketch.width * .013);
  for (const { path, phase, weight, opacity } of sketch.ripples) {
    const tide = time * .64 + phase;
    ctx.save();
    ctx.translate(Math.sin(tide) * distance, Math.sin(tide + 1.1) * .76);
    ctx.globalAlpha = opacity + Math.sin(tide + .5) * .12;
    ctx.lineWidth = weight;
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.restore();
}

export function mountMiziBackdrop(scene: HTMLElement, list: HTMLUListElement) {
  const canvas = scene.querySelector('canvas');
  const ctx = canvas?.getContext('2d');
  const still = document.createElement('canvas');
  const stillCtx = still.getContext('2d');
  if (!canvas || !ctx || !stillCtx) return () => {};

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, ratio = 1;
  let sketch: Sketch | undefined;
  let ink = day;
  let needsContinuation = false, continuationColor = '';
  let visible = false, frame = 0, previous = 0, time = 0;

  list.style.setProperty('--work-row-height', `${workRowHeight}px`);
  list.style.setProperty('--continuation-tile-height', `${continuationTileHeight}px`);
  const layout = () => {
    if (sketch && scene.isConnected) needsContinuation = layoutWorkRows(list, sketch);
  };
  const paintContinuation = () => {
    if (!sketch || !needsContinuation || continuationColor === ink.graphite) return;
    continuationColor = ink.graphite;
    list.style.setProperty('--continuation-ink', makeContinuationInk(sketch, ratio, continuationColor));
  };
  const draw = () => {
    if (!sketch || !scene.isConnected) return;
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(still, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintRipples(ctx, sketch, ink, motion.matches ? 0 : time);
  };
  const repaint = () => {
    if (!sketch || !scene.isConnected) return;
    ink = document.documentElement.dataset.theme === 'night' ? night : day;
    stillCtx.resetTransform();
    stillCtx.clearRect(0, 0, still.width, still.height);
    stillCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintSketch(stillCtx, sketch, ink);
    paintContinuation();
    draw();
  };
  const playing = () => visible && !document.hidden && !motion.matches && scene.isConnected;
  const tick = (now: number) => {
    frame = 0;
    if (!playing()) { previous = 0; return; }
    if (!previous || now - previous >= 30) {
      if (previous) time += Math.min((now - previous) / 1000, .07);
      previous = now;
      draw();
    }
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
    const { clientWidth: nextWidth, clientHeight: nextHeight } = scene;
    const nextRatio = Math.min(devicePixelRatio || 1, 1.5);
    if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight && ratio === nextRatio)) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    canvas.width = still.width = Math.round(width * ratio);
    canvas.height = still.height = Math.round(height * ratio);
    sketch = makeSketch(width, height);
    continuationColor = '';
    layout();
    repaint();
  };

  const bounds = new ResizeObserver(resize);
  bounds.observe(scene);
  const viewport = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updatePlayback();
  });
  viewport.observe(scene);
  const theme = new MutationObserver(repaint);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const works = new MutationObserver(() => { layout(); paintContinuation(); });
  works.observe(list, { childList: true });
  const onMotionChange = () => { draw(); updatePlayback(); };
  motion.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', updatePlayback);
  resize();

  return () => {
    cancelAnimationFrame(frame);
    bounds.disconnect();
    viewport.disconnect();
    theme.disconnect();
    works.disconnect();
    motion.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', updatePlayback);
  };
}
