(() => {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawOrganicBlob(ctx, cx, cy, rx, ry, rand, lobes = 14) {
    ctx.beginPath();
    const pts = [];
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const jitter = 0.72 + rand() * 0.52;
      pts.push([cx + Math.cos(a) * rx * jitter, cy + Math.sin(a) * ry * jitter]);
    }
    for (let i = 0; i < lobes; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % lobes];
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    ctx.closePath();
  }

  function drawRainStreaks(ctx, w, h, rand) {
    // 顶部左侧淡青灰与淡金竖向雨丝
    ctx.save();
    for (let i = 0; i < 68; i++) {
      const x = w * (0.08 + rand() * 0.56);
      const y0 = h * (0.015 + rand() * 0.09);
      const len = h * (0.04 + rand() * 0.145) * (1 - Math.abs(x / w - 0.34) * 0.7);
      const thick = w * (0.0011 + rand() * 0.0026);
      const isSage = rand() < 0.62;
      const grad = ctx.createLinearGradient(x, y0, x, y0 + len);
      if (isSage) {
        grad.addColorStop(0, `rgba(154, 166, 140, ${(0.08 + rand() * 0.22).toFixed(3)})`);
        grad.addColorStop(0.65, `rgba(166, 174, 148, ${(0.14 + rand() * 0.24).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(166, 174, 148, 0)');
      } else {
        grad.addColorStop(0, `rgba(196, 160, 96, ${(0.08 + rand() * 0.18).toFixed(3)})`);
        grad.addColorStop(0.7, `rgba(184, 144, 82, ${(0.12 + rand() * 0.2).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(184, 144, 82, 0)');
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = thick;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + (rand() - 0.5) * w * 0.004, y0 + len);
      ctx.stroke();

      if (rand() < 0.32) {
        ctx.fillStyle = isSage ? 'rgba(156,168,142,0.22)' : 'rgba(192,152,88,0.22)';
        ctx.beginPath();
        ctx.ellipse(x, y0 + len + w * 0.004, thick * 0.9, thick * 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawGoldBubbles(ctx, w, h, rand) {
    // 右上角与边缘漂浮的金赭水彩圆环与水珠
    const rings = [
      [0.86, 0.11, 0.022], [0.91, 0.15, 0.025], [0.81, 0.16, 0.017],
      [0.95, 0.19, 0.015], [0.87, 0.22, 0.029], [0.93, 0.25, 0.014],
      [0.82, 0.27, 0.019], [0.89, 0.30, 0.012], [0.94, 0.33, 0.018],
      [0.58, 0.30, 0.019], [0.55, 0.35, 0.014], [0.06, 0.62, 0.016],
      [0.08, 0.67, 0.012], [0.41, 0.88, 0.036], [0.35, 0.91, 0.018],
    ];
    ctx.save();
    for (const [rx, ry, rr] of rings) {
      const x = w * rx;
      const y = h * ry;
      const r = w * rr;
      ctx.fillStyle = `rgba(216, 174, 102, ${(0.07 + rand() * 0.09).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(186, 138, 66, ${(0.34 + rand() * 0.24).toFixed(3)})`;
      ctx.lineWidth = w * (0.0018 + rand() * 0.0018);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      if (rand() < 0.65) {
        ctx.strokeStyle = 'rgba(206, 164, 94, 0.32)';
        ctx.lineWidth = w * 0.0012;
        ctx.beginPath();
        ctx.arc(x + r * 0.08, y - r * 0.06, r * 0.64, 0.3, Math.PI * 1.75);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 42; i++) {
      const x = w * (0.76 + rand() * 0.22);
      const y = h * (0.07 + rand() * 0.30);
      const r = w * (0.0016 + rand() * 0.0045);
      ctx.fillStyle = `rgba(198, 146, 72, ${(0.18 + rand() * 0.32).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWaterRipples(ctx, w, h) {
    // 中右与底部的水波涟漪
    const sets = [
      { cx: w * 0.56, cy: h * 0.555, rx: w * 0.082, ry: h * 0.022, count: 6, alpha: 0.42 },
      { cx: w * 0.14, cy: h * 0.905, rx: w * 0.078, ry: h * 0.017, count: 4, alpha: 0.30 },
      { cx: w * 0.36, cy: h * 0.935, rx: w * 0.095, ry: h * 0.020, count: 5, alpha: 0.34 },
    ];
    ctx.save();
    for (const s of sets) {
      for (let i = 1; i <= s.count; i++) {
        const k = i / s.count;
        ctx.strokeStyle = `rgba(176, 140, 82, ${(s.alpha * (1 - k * 0.35)).toFixed(3)})`;
        ctx.lineWidth = w * (0.0022 - k * 0.0008);
        ctx.beginPath();
        ctx.ellipse(s.cx, s.cy, s.rx * k, s.ry * k, -0.05, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSplashCrown(ctx, w, h, rand) {
    // 底部中左雨滴溅起水花
    const cx = w * 0.355;
    const cy = h * 0.918;
    ctx.save();
    ctx.strokeStyle = 'rgba(182, 142, 78, 0.44)';
    ctx.fillStyle = 'rgba(202, 162, 92, 0.24)';
    for (let i = 0; i < 11; i++) {
      const t = (i / 10) - 0.5;
      const dx = t * w * 0.125;
      const dy = -(0.022 + (1 - Math.abs(t * 2)) * 0.036 + rand() * 0.014) * h;
      ctx.lineWidth = w * 0.0018;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 0.35, cy);
      ctx.quadraticCurveTo(cx + dx * 0.72, cy + dy * 0.65, cx + dx, cy + dy);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + dx, cy + dy - w * 0.003, w * 0.0038, w * 0.006, t * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAmberWash(ctx, w, h, rand) {
    // 右下角暖琥珀水彩晕染 + 有机飞溅点
    ctx.save();
    const layers = [
      [0.88, 0.88, 0.24, 0.22, 'rgba(214, 134, 62, 0.30)'],
      [0.77, 0.92, 0.21, 0.16, 'rgba(222, 152, 78, 0.26)'],
      [0.93, 0.74, 0.16, 0.22, 'rgba(218, 144, 70, 0.24)'],
      [0.84, 0.82, 0.15, 0.14, 'rgba(198, 114, 48, 0.22)'],
      [0.72, 0.96, 0.14, 0.10, 'rgba(206, 126, 56, 0.22)'],
      [0.96, 0.60, 0.10, 0.14, 'rgba(224, 158, 86, 0.18)'],
    ];
    for (const [cx, cy, rx, ry, color] of layers) {
      drawOrganicBlob(ctx, w * cx, h * cy, w * rx, h * ry, rand, 18);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(182, 102, 42, 0.12)';
      ctx.lineWidth = w * 0.0025;
      ctx.stroke();
    }

    // 飞溅墨点（从右下往中右渐稀）
    for (let i = 0; i < 165; i++) {
      const t = rand();
      const x = w * (0.46 + Math.pow(rand(), 0.58) * 0.54);
      const y = h * (0.44 + Math.pow(t, 0.72) * 0.56);
      const distBR = Math.hypot((1 - x / w) * 1.1, (1 - y / h));
      if (distBR > 0.62 && rand() > 0.25) continue;
      const r = w * (0.0018 + Math.pow(rand(), 2.2) * 0.015);
      const alpha = (0.14 + rand() * 0.34) * Math.max(0.28, 1 - distBR * 0.85);
      drawOrganicBlob(ctx, x, y, r, r * (0.75 + rand() * 0.5), rand, 7);
      ctx.fillStyle = `rgba(${198 + Math.floor(rand() * 26)}, ${118 + Math.floor(rand() * 38)}, ${48 + Math.floor(rand() * 28)}, ${alpha.toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function renderArt(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const rand = mulberry32(20261126);
    drawAmberWash(ctx, w, h, rand);
    drawRainStreaks(ctx, w, h, rand);
    drawGoldBubbles(ctx, w, h, rand);
    drawWaterRipples(ctx, w, h);
    drawSplashCrown(ctx, w, h, rand);
  }

  window.LyricShareArt = { renderArt };
})();
