(() => {
  'use strict';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const sunDeskCanvas = document.getElementById('sun-desk-canvas');
  const sunBookCanvas = document.getElementById('sun-book-canvas');
  const bookEl = document.getElementById('book');

  if (!sunDeskCanvas || !sunBookCanvas || !bookEl) return;
  let geometry;

  const assetSources = {
    tree: './tree-shadow.png',
    catBody: './cat-body-shadow.png',
    catTail: './cat-tail-shadow.png',
    mapleTL: './maple-tl-shadow.png',
    mapleBL: './maple-bl-shadow.png',
  };

  const assets = {};
  for (const [key, src] of Object.entries(assetSources)) {
    const img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', () => {
      if (reducedMotion.matches && geometry) requestStaticFrame();
    });
    img.src = src;
    assets[key] = img;
  }

  function isReady(img) {
    return Boolean(img && img.complete && img.naturalWidth > 0);
  }

  // Paint left-side maple shadows + right-side swaying tree & tail-wagging cat
  function measure() {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1, Math.sqrt(900_000 / (vw * vh)));
    const w = Math.round(vw * dpr);
    const h = Math.round(vh * dpr);
    geometry = { dpr, vw, w, h, rect: bookEl.getBoundingClientRect() };
    if (sunDeskCanvas.width !== w) sunDeskCanvas.width = w;
    if (sunDeskCanvas.height !== h) sunDeskCanvas.height = h;
    renderBookLighting(geometry.rect);
    requestStaticFrame();
  }

  function renderDeskLighting(timeSec) {
    if (!geometry) return;
    const { dpr, vw, w, h, rect } = geometry;

    const ctx = sunDeskCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const leftGap = rect.left;
    const rightGap = vw - rect.right;

    // -----------------------------------------------------------------------
    // A) Left-side Japanese Maple Leaf Shadows (top-left & bottom-left)
    // -----------------------------------------------------------------------
    if (leftGap >= 64) {
      const leftZoneW = (leftGap - Math.max(6, leftGap * 0.04)) * dpr;

      if (isReady(assets.mapleTL)) {
        const img = assets.mapleTL;
        const aspect = img.naturalWidth / img.naturalHeight;
        const drawW = Math.min(leftZoneW * 0.96, h * 0.34 * aspect);
        const drawH = drawW / aspect;
        const swayAngle = Math.sin(timeSec * 0.92 + 0.4) * 0.046
                        + Math.sin(timeSec * 1.85 + 1.1) * 0.015;

        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.translate(0, 0);
        ctx.rotate(swayAngle);
        ctx.drawImage(img, -8 * dpr, -6 * dpr, drawW, drawH);
        ctx.restore();
      }

      if (isReady(assets.mapleBL)) {
        const img = assets.mapleBL;
        const aspect = img.naturalWidth / img.naturalHeight;
        const drawW = Math.min(leftZoneW * 0.95, h * 0.42 * aspect);
        const drawH = drawW / aspect;
        const pivotX = drawW * 0.28;
        const pivotY = h;
        const swayAngle = Math.sin(timeSec * 0.84 + 1.9) * 0.052
                        + Math.sin(timeSec * 1.68 + 0.6) * 0.016;

        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.translate(pivotX, pivotY);
        ctx.rotate(swayAngle);
        ctx.drawImage(img, -pivotX, -drawH + 6 * dpr, drawW, drawH);
        ctx.restore();
      }
    }

    // -----------------------------------------------------------------------
    // B) Right-side Swaying Flowering Tree & Tail-Wagging Cat Shadow
    // -----------------------------------------------------------------------
    if (rightGap < 48) {
      return;
    }

    const rightMargin = Math.max(6, rightGap * 0.03);
    const maxW = Math.max(24, (rightGap - rightMargin) * dpr);
    const maxH = Math.max(60, (rect.bottom - 6) * dpr);

    let treeW = maxW;
    let treeH = maxH;
    if (isReady(assets.tree)) {
      const tImg = assets.tree;
      const tAspect = tImg.naturalWidth / Math.max(1, tImg.naturalHeight);
      treeH = treeW / tAspect;
      if (treeH > maxH) {
        treeH = maxH;
        treeW = treeH * tAspect;
      }

      const drawX = w - treeW;
      const drawY = 0;

      // Pivot gently near lower-right trunk base so upper canopy sways smoothly
      const pivotX = w - treeW * 0.06;
      const pivotY = treeH * 0.88;
      const treeSway = Math.sin(timeSec * 0.52) * 0.011 + Math.sin(timeSec * 1.05) * 0.003;

      ctx.save();
      ctx.globalAlpha = 0.36;
      ctx.translate(pivotX, pivotY);
      ctx.rotate(treeSway);
      ctx.drawImage(tImg, drawX - pivotX, drawY - pivotY, treeW, treeH);
      ctx.restore();
    }

    if (isReady(assets.catBody) && isReady(assets.catTail)) {
      const bImg = assets.catBody;
      const tImg = assets.catTail;
      // Match the proportional scale of the cat relative to the tree (crop width ratio ~ 0.52)
      const catW = treeW * 0.525;
      const catH = catW * (bImg.naturalHeight / bImg.naturalWidth);
      const catX = w - treeW * 0.84;
      const catY = Math.min(h - catH - 8 * dpr, rect.bottom * dpr - catH - 2 * dpr);

      // Body
      ctx.save();
      ctx.globalAlpha = 0.37;
      ctx.drawImage(bImg, catX, catY, catW, catH);
      ctx.restore();

      // Tail rotating smoothly around exact hip pivot (0.7053, 0.9408) at a steady, slow rhythm
      const pivotX = catX + catW * 0.7053;
      const pivotY = catY + catH * 0.9408;
      const freq = 1.15;
      const amp = 0.068;
      const tailAngle = Math.sin(timeSec * freq) * amp + Math.sin(timeSec * freq * 2.0 + 0.6) * amp * 0.25;

      ctx.save();
      ctx.globalAlpha = 0.37;
      ctx.translate(pivotX, pivotY);
      ctx.rotate(tailAngle);
      ctx.drawImage(tImg, -catW * 0.7053, -catH * 0.9408, catW, catH);
      ctx.restore();
    }
  }

  // Paint clean curved-page Lambertian shading & spine crease onto the book
  function renderBookLighting(rect) {
    if (rect.width < 10 || rect.height < 10) return;

    const w = Math.min(560, Math.max(240, Math.round(rect.width * 0.55)));
    const h = Math.round(w * (rect.height / rect.width));

    if (sunBookCanvas.width !== w || sunBookCanvas.height !== h) {
      sunBookCanvas.width = w;
      sunBookCanvas.height = h;
    }

    const ctx = sunBookCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const curveGrad = ctx.createLinearGradient(0, 0, w, 0);
    curveGrad.addColorStop(0.00, 'rgba(255, 253, 246, 0.08)');
    curveGrad.addColorStop(0.20, 'rgba(255, 252, 244, 0.03)');
    curveGrad.addColorStop(0.42, 'rgba(130, 96, 82, 0.00)');
    curveGrad.addColorStop(0.47, 'rgba(116, 78, 68, 0.045)');
    curveGrad.addColorStop(0.495, 'rgba(92, 56, 52, 0.13)');
    curveGrad.addColorStop(0.500, 'rgba(72, 42, 46, 0.18)');
    curveGrad.addColorStop(0.512, 'rgba(90, 56, 54, 0.09)');
    curveGrad.addColorStop(0.555, 'rgba(255, 252, 242, 0.11)');
    curveGrad.addColorStop(0.68, 'rgba(255, 251, 242, 0.04)');
    curveGrad.addColorStop(0.88, 'rgba(130, 96, 86, 0.00)');
    curveGrad.addColorStop(1.00, 'rgba(108, 78, 86, 0.035)');
    ctx.fillStyle = curveGrad;
    ctx.fillRect(0, 0, w, h);
  }

  // Animation loop (gentle ~24fps breeze & cat tail wag; static single frame if reduced motion)
  let rafId = 0;
  let staticFrame = 0;
  let lastFrame = 0;
  const startTime = performance.now();

  function tick(now) {
    if (document.hidden || reducedMotion.matches) return;
    if (now - lastFrame >= 42) { // ~24 fps for silky low-CPU breeze
      lastFrame = now;
      const t = (now - startTime) / 1000;
      renderDeskLighting(t);
    }
    rafId = requestAnimationFrame(tick);
  }

  function requestStaticFrame() {
    if (!staticFrame) staticFrame = requestAnimationFrame(() => {
      staticFrame = 0;
      renderDeskLighting(0);
    });
  }

  function start() {
    cancelAnimationFrame(rafId);
    if (document.hidden) return;
    if (reducedMotion.matches) requestStaticFrame();
    else {
      rafId = requestAnimationFrame(tick);
    }
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 80);
  });

  if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', start);
  }

  document.addEventListener('visibilitychange', start);
  requestAnimationFrame(() => {
    measure();
    start();
  });
})();
