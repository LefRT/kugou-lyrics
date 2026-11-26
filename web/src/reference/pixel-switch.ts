// @ts-nocheck
// Shorekeeper day/night illustration switch with spring physics and glass lens refraction.
import './pixel-switch.css';
import switchDayUrl from '../assets/switch-shorekeeper-day.webp';
import switchNightUrl from '../assets/switch-shorekeeper-night.webp';

export const pixelSwitchMarkup = `<span class="cavity" aria-hidden="true">
        <canvas class="pixel-room" width="300" height="152"></canvas>
        <span class="room-shade"></span>
        <span class="lens"><canvas class="pixel-refraction" width="176" height="176"></canvas><span class="lens-rim"></span></span>
      </span>
      <span class="bezel" aria-hidden="true"></span>`;

export function createPixelSwitch(button: HTMLButtonElement, initialNight: boolean, onChange: (night: boolean) => void, onProgress?: (p: number) => void) {
  const roomCanvas = button.querySelector('.pixel-room');
  const roomCtx = roomCanvas.getContext('2d', { alpha: false });
  const lensCanvas = button.querySelector('.pixel-refraction');
  const lensCtx = lensCanvas.getContext('2d');
  const root = button;
  const controller = new AbortController();
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: controller.signal });
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const W = 300, H = 152, L = 176;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const mix = (a, b, t) => a + (b - a) * t;
  let progress = initialNight ? 1 : 0, target = progress, velocity = 0, previous = 0, raf = 0, lastStyle = -1;
  let pointerDown = false, dragging = false, startX = 0, startProgress = 0, ignoreClick = false, activePointer = null;
  let livePreview = false;
  if (!roomCtx || !lensCtx) throw new Error('Canvas unavailable');

  function makeFallback(r, g, b) {
    const data = roomCtx.createImageData(W, H);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    return data;
  }

  let day = makeFallback(231, 236, 245);
  let night = makeFallback(29, 34, 54);

  function loadScene(url, assign) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (controller.signal.aborted) return;
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      const c = off.getContext('2d', { alpha: false });
      if (!c) return;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, W, H);
      assign(c.getImageData(0, 0, W, H));
      draw();
    };
    img.src = url;
  }

  loadScene(switchDayUrl, data => { day = data; });
  loadScene(switchNightUrl, data => { night = data; });

  const output = roomCtx.createImageData(W, H), glass = lensCtx.createImageData(L, L);
  const lensMap = [];
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    const nx = (x + .5) / L * 2 - 1, ny = (y + .5) / L * 2 - 1, r2 = nx * nx + ny * ny;
    if (r2 > 1) { lensMap.push(null); continue; }
    const r = Math.sqrt(r2), magnification = 1.18 + .40 * (1 - r2);
    lensMap.push({ x: nx * 71 / magnification, y: ny * 71 / magnification, r, edge: Math.pow(r, 9), shade: 1 - .27 * Math.pow(r, 12) });
  }

  const rgb = (a, b, t) => 'rgb(' + a.map((n, i) => Math.round(mix(n, b[i], t))).join(',') + ')';
  function updateStyle() {
    const t = clamp(progress);
    if (Math.abs(lastStyle - t) < .0004) return;
    lastStyle = t;
    root.style.setProperty('--night', t.toFixed(4));
    root.style.setProperty('--rim-top', rgb([255, 255, 255], [35, 34, 66], t));
    root.style.setProperty('--rim-bottom', rgb([198, 199, 203], [26, 25, 48], t));
    root.style.setProperty('--cavity-top', rgb([118, 119, 123], [8, 12, 34], t));
    root.style.setProperty('--cavity-bottom', rgb([251, 252, 255], [52, 44, 61], t));
    root.style.setProperty('--rim-highlight', `rgba(${Math.round(mix(255, 121, t))},${Math.round(mix(255, 125, t))},${Math.round(mix(255, 158, t))},${mix(.91, .15, t).toFixed(3)})`);
    root.style.setProperty('--glass-light', mix(.72, .25, t).toFixed(3));
    root.style.setProperty('--lens-left', (2.4 + t * 48.2).toFixed(3) + '%');
  }

  function draw() {
    const t = clamp(progress), pixels = output.data;
    if (t < .0001) pixels.set(day.data);
    else if (t > .9999) pixels.set(night.data);
    else {
      const dd = day.data, nd = night.data;
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = dd[i] + (nd[i] - dd[i]) * t;
        pixels[i + 1] = dd[i + 1] + (nd[i + 1] - dd[i + 1]) * t;
        pixels[i + 2] = dd[i + 2] + (nd[i + 2] - dd[i + 2]) * t;
        pixels[i + 3] = 255;
      }
    }
    roomCtx.putImageData(output, 0, 0);
    const cx = 76 + t * 145, cy = 76, gd = glass.data;
    for (let n = 0; n < lensMap.length; n++) {
      const map = lensMap[n], i = n * 4;
      if (!map) { gd[i + 3] = 0; continue; }
      const sx = clamp(Math.floor(cx + map.x), 0, W - 1), sy = clamp(Math.floor(cy + map.y), 0, H - 1);
      const sample = (sy * W + sx) * 4;
      const red = (sy * W + clamp(Math.round(sx + map.edge * 1.1), 0, W - 1)) * 4;
      const blue = (sy * W + clamp(Math.round(sx - map.edge * .8), 0, W - 1)) * 4;
      gd[i] = pixels[red] * map.shade;
      gd[i + 1] = pixels[sample + 1] * map.shade;
      gd[i + 2] = pixels[blue + 2] * map.shade;
      gd[i + 3] = 255;
    }
    lensCtx.putImageData(glass, 0, 0);
    updateStyle();
  }

  function frame(timestamp) {
    raf = 0;
    if (document.hidden) return;
    const dt = previous ? Math.min((timestamp - previous) / 1000, .033) : 0;
    previous = timestamp;
    let settled = false;
    if (!pointerDown) {
      const force = (target - progress) * 95 - velocity * 17;
      velocity += force * dt;
      progress += velocity * dt;
      if (Math.abs(target - progress) < .0002 && Math.abs(velocity) < .002) {
        progress = target; velocity = 0; settled = true;
        if (livePreview) { livePreview = false; onProgress?.(target); }
      } else if (livePreview) onProgress?.(clamp(progress));
    }
    draw();
    if (!settled && !pointerDown && !preference.matches) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf && !document.hidden && !preference.matches) {
      previous = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function setNight(value, immediate = false) {
    const next = value ? 1 : 0, changed = target !== next;
    target = next;
    button.setAttribute('aria-checked', String(Boolean(value)));
    if (changed) { livePreview = false; onChange(Boolean(value)); }
    else if (livePreview && (immediate || preference.matches)) { livePreview = false; onProgress?.(next); }
    if (immediate || preference.matches) { progress = target; velocity = 0; draw(); }
    else start();
  }

  listen(button, 'click', () => { if (ignoreClick) { ignoreClick = false; return; } setNight(!target); });
  listen(button, 'pointerdown', event => {
    if (event.button !== 0) return;
    pointerDown = true; dragging = false; activePointer = event.pointerId;
    startX = event.clientX; startProgress = clamp(progress); velocity = 0; ignoreClick = false;
    try { button.setPointerCapture(event.pointerId); } catch {}
  });
  listen(button, 'pointermove', event => {
    if (!pointerDown || event.pointerId !== activePointer) return;
    const dx = event.clientX - startX;
    if (Math.abs(dx) > 5) dragging = true;
    if (!dragging) return;
    button.dataset.dragging = 'true';
    const travel = button.getBoundingClientRect().width * .94 * .482;
    progress = clamp(startProgress + dx / travel);
    draw();
    if (onProgress) { livePreview = true; onProgress(clamp(progress)); }
  });
  function endPointer(event, cancelled = false) {
    if (!pointerDown || event.pointerId !== activePointer) return;
    pointerDown = false; activePointer = null; delete button.dataset.dragging;
    if (dragging && cancelled) { ignoreClick = true; setNight(Boolean(target)); }
    else if (dragging && Math.abs(progress - startProgress) > .28) { ignoreClick = true; setNight(progress > .5); }
    else ignoreClick = false;
    dragging = false; start();
  }
  listen(button, 'pointerup', event => endPointer(event));
  listen(button, 'pointercancel', event => endPointer(event, true));
  listen(button, 'lostpointercapture', event => { if (pointerDown) endPointer(event, true); });
  listen(button, 'keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'End') { event.preventDefault(); setNight(true); }
    if (event.key === 'ArrowLeft' || event.key === 'Home') { event.preventDefault(); setNight(false); }
  });
  listen(document, 'visibilitychange', () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; previous = 0; } else start(); });
  listen(preference, 'change', () => { if (preference.matches) { if (raf) cancelAnimationFrame(raf); raf = 0; progress = target; velocity = 0; draw(); } else start(); });
  button.setAttribute('aria-checked', String(initialNight));
  draw();
  return { setNight, destroy() { controller.abort(); if (raf) cancelAnimationFrame(raf); raf = 0; } };
}
