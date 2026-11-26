(() => {
  'use strict';

  const noteSheet = document.querySelector('.note-sheet');
  const data = window.MusicNoteRingData;
  if (!noteSheet || !data || !Array.isArray(data.track) || !data.track.length) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const sunCanvas = document.createElement('canvas');
  sunCanvas.className = 'ring-sunlight';
  sunCanvas.width = 754;
  sunCanvas.height = 522;
  sunCanvas.setAttribute('aria-hidden', 'true');

  // Insert sunlight behind the staff & song list, and flowing notes right above the staff
  const staffImg = noteSheet.querySelector('.music-note-ring');
  const canvasH = Number(staffImg?.getAttribute('height')) || data.height;
  const flowCanvas = document.createElement('canvas');
  flowCanvas.className = 'music-note-flow';
  flowCanvas.width = Math.ceil(data.width * .6);
  flowCanvas.height = Math.ceil(canvasH * .6);
  flowCanvas.setAttribute('aria-hidden', 'true');

  noteSheet.prepend(sunCanvas);
  if (staffImg) {
    staffImg.after(flowCanvas);
  } else {
    noteSheet.append(flowCanvas);
  }

  const sunCtx = sunCanvas.getContext('2d');
  const flowCtx = flowCanvas.getContext('2d');
  flowCtx.scale(flowCanvas.width / data.width, flowCanvas.height / canvasH);

  const atlasImg = new Image();
  atlasImg.decoding = 'async';
  let atlasReady = false;
  atlasImg.addEventListener('load', () => {
    atlasReady = true;
    renderNotes(0);
  });
  atlasImg.src = './music-notes-atlas.webp';

  // Deterministic floating golden dust motes inside the note ring
  const motes = (() => {
    let seed = 314159;
    const rand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const arr = [];
    for (let i = 0; i < 20; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.72;
      arr.push({
        x: 0.5 + Math.cos(a) * 0.28 * r,
        y: 0.5 + Math.sin(a) * 0.24 * r,
        r: 1.5 + rand() * 3.0,
        speed: 0.25 + rand() * 0.35,
        phase: rand() * Math.PI * 2,
        alpha: 0.22 + rand() * 0.32,
      });
    }
    return arr;
  })();

  function sampleTrack(s) {
    const track = data.track;
    const n = track.length;
    const wrapped = ((s % 1) + 1) % 1;
    const pos = wrapped * n;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const iPrev = (i0 - 1 + n) % n;
    const iNext = (i1 + 1) % n;
    const f = pos - Math.floor(pos);

    const p0 = track[i0];
    const p1 = track[i1];
    const x = p0[0] * (1 - f) + p1[0] * f;
    const y = p0[1] * (1 - f) + p1[1] * f;

    // Smooth tangent vector along the wavy centerline
    const tx = (track[iNext][0] - track[iPrev][0]) * 0.5;
    const ty = (track[iNext][1] - track[iPrev][1]) * 0.5;
    return { x, y, tx, ty };
  }

  function renderSunlight(t) {
    const w = sunCanvas.width;
    const h = sunCanvas.height;
    sunCtx.clearRect(0, 0, w, h);

    const cx = w * 0.50;
    const cy = h * 0.49;
    const breath = 1 + Math.sin(t * 0.65) * 0.025;

    // 1) Pure, shadowless warm golden afternoon sunlight filling the interior of the note ring
    sunCtx.save();
    sunCtx.translate(cx, cy);
    sunCtx.scale(1.38 * breath, 0.96 * breath);

    const outerGlow = sunCtx.createRadialGradient(-w * 0.04, -h * 0.06, 6, 0, 0, h * 0.44);
    outerGlow.addColorStop(0.00, 'rgba(255, 251, 224, 0.72)');
    outerGlow.addColorStop(0.32, 'rgba(255, 240, 186, 0.44)');
    outerGlow.addColorStop(0.62, 'rgba(255, 226, 174, 0.20)');
    outerGlow.addColorStop(0.84, 'rgba(220, 236, 255, 0.09)');
    outerGlow.addColorStop(1.00, 'rgba(255, 246, 224, 0)');
    sunCtx.fillStyle = outerGlow;
    sunCtx.beginPath();
    sunCtx.arc(0, 0, h * 0.44, 0, Math.PI * 2);
    sunCtx.fill();
    sunCtx.restore();

    // 2) Ethereal diagonal sunbeams drifting softly across the ring interior
    sunCtx.save();
    sunCtx.translate(cx, cy);
    for (let i = 0; i < 6; i++) {
      const rayAngle = -0.62 + i * 0.16 + Math.sin(t * 0.35 + i) * 0.025;
      const offsetX = (i - 2.5) * 34;
      sunCtx.save();
      sunCtx.translate(offsetX, 0);
      sunCtx.rotate(rayAngle);
      const rayGrad = sunCtx.createLinearGradient(0, -h * 0.35, 0, h * 0.35);
      rayGrad.addColorStop(0.0, 'rgba(255, 251, 224, 0)');
      rayGrad.addColorStop(0.30, 'rgba(255, 246, 198, 0.16)');
      rayGrad.addColorStop(0.62, 'rgba(255, 239, 190, 0.10)');
      rayGrad.addColorStop(1.0, 'rgba(255, 244, 198, 0)');
      sunCtx.fillStyle = rayGrad;
      sunCtx.beginPath();
      sunCtx.moveTo(-16, -h * 0.35);
      sunCtx.lineTo(16, -h * 0.35);
      sunCtx.lineTo(38, h * 0.35);
      sunCtx.lineTo(-38, h * 0.35);
      sunCtx.closePath();
      sunCtx.fill();
      sunCtx.restore();
    }
    sunCtx.restore();

    // 3) Twinkling golden dust motes floating inside the sunlit ring
    for (const m of motes) {
      const mx = (m.x + Math.sin(t * m.speed + m.phase) * 0.018) * w;
      const my = (m.y + Math.cos(t * m.speed * 0.9 + m.phase) * 0.020) * h;
      const shimmer = 0.55 + 0.45 * Math.sin(t * 1.6 + m.phase);
      const g = sunCtx.createRadialGradient(mx, my, 0, mx, my, m.r * 2.5);
      g.addColorStop(0, `rgba(255, 253, 232, ${(m.alpha * 1.25 * shimmer).toFixed(3)})`);
      g.addColorStop(0.45, `rgba(255, 244, 196, ${(m.alpha * 0.45 * shimmer).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255, 244, 195, 0)');
      sunCtx.fillStyle = g;
      sunCtx.beginPath();
      sunCtx.arc(mx, my, m.r * 2.5, 0, Math.PI * 2);
      sunCtx.fill();
    }
  }

  function renderNotes(t) {
    flowCtx.clearRect(0, 0, data.width, canvasH);
    if (!atlasReady) return;

    // Gentle clockwise flow along the wavy staff (~56 seconds per full lap)
    const speed = 1 / 56;
    const progress = reducedMotion.matches ? 0 : (t * speed) % 1;

    for (let i = 0; i < data.notes.length; i++) {
      const note = data.notes[i];
      const { x, y, tx, ty } = sampleTrack(note.s + progress);

      // Keep notes upright & readable while gently riding the wave slope
      const waveTilt = Math.atan2(ty, Math.abs(tx) + 60) * 0.28;
      const bob = Math.sin(t * 1.1 + i * 0.9) * 2.2;

      // Outward normal for subtle radial placement relative to centerline
      const dx = x - data.cx;
      const dy = y - data.cy;
      const dLen = Math.max(1e-5, Math.hypot(dx, dy));
      const nx = dx / dLen;
      const ny = dy / dLen;

      const drawX = x + nx * (note.dr * 0.35);
      const drawY = y + ny * (note.dr * 0.35) + bob;

      flowCtx.save();
      flowCtx.translate(drawX, drawY);
      flowCtx.rotate(waveTilt);
      flowCtx.drawImage(
        atlasImg,
        note.sx, note.sy, note.sw, note.sh,
        -note.ax, -note.ay, note.sw, note.sh
      );
      flowCtx.restore();
    }
  }

  function renderFrame(t) {
    renderSunlight(t);
    renderNotes(t);
  }

  let rafId = 0;
  let lastFrame = 0;
  let visible = !window.JournalPage;
  const startTime = performance.now();

  window.addEventListener('journal:visibility', ({ detail }) => {
    visible = Boolean(detail);
    syncMotion();
  });

  function tick(now) {
    if (document.hidden || !visible || reducedMotion.matches) return;
    if (now - lastFrame >= 48) {
      lastFrame = now;
      renderFrame((now - startTime) / 1000);
    }
    rafId = requestAnimationFrame(tick);
  }

  function syncMotion() {
    cancelAnimationFrame(rafId);
    if (!document.hidden && visible && !reducedMotion.matches) {
      rafId = requestAnimationFrame(tick);
    }
  }

  if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', () => {
      renderFrame(0);
      syncMotion();
    });
  }

  document.addEventListener('visibilitychange', syncMotion);
  renderFrame(0);
  syncMotion();
})();
