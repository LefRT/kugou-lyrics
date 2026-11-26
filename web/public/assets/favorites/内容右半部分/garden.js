(() => {
  'use strict';

  const flowers = document.querySelector('.garden-flowers');
  const floor = document.querySelector('.garden-floor');
  const width = floor.width;
  const height = floor.height;
  const brush = flowers.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (from, to, t) => from + (to - from) * t;
  const smooth = t => t * t * (3 - 2 * t);

  // The paper shows the left lobe of a heart that opens at the right page edge.
  const paperEdge = [[1034, 396]];
  for (const [a, b, end] of [
    [[899, 306], [838, 164], [656, 193]],
    [[470, 182], [297, 285], [304, 470]],
    [[310, 701], [611, 832], [1016, 1068]],
  ]) {
    const start = paperEdge.at(-1);
    for (let i = 1; i <= 75; i++) {
      const t = i / 75;
      const u = 1 - t;
      paperEdge.push(start.map((point, axis) => u ** 3 * point + 3 * u ** 2 * t * a[axis] + 3 * u * t ** 2 * b[axis] + t ** 3 * end[axis]));
    }
  }
  const roughEdge = paperEdge.map(([x, y]) => [
    x + 5.1 * Math.sin(y * .074) + 2.7 * Math.sin(y * .181 + 1.4),
    y + 4.4 * Math.sin(x * .096) + 2.2 * Math.sin(x * .233),
  ]);
  roughEdge.push([width + 120, 1120], [width + 120, 390]);

  const carpet = new Path2D();
  carpet.rect(0, 0, width, height);
  carpet.moveTo(...roughEdge[0]);
  for (const point of roughEdge.slice(1)) carpet.lineTo(...point);
  carpet.closePath();

  const paperLeft = new Float32Array(height + 1).fill(width + 120);
  const paperRight = new Float32Array(height + 1).fill(-120);
  for (let i = 0; i < roughEdge.length; i++) {
    const [x1, y1] = roughEdge[i];
    const [x2, y2] = roughEdge[(i + 1) % roughEdge.length];
    for (let y = Math.ceil(Math.min(y1, y2)); y < Math.max(y1, y2); y++) {
      const x = mix(x1, x2, (y - y1) / (y2 - y1));
      paperLeft[y] = Math.min(paperLeft[y], x);
      paperRight[y] = Math.max(paperRight[y], x);
    }
  }

  function mossDistance(x, y) {
    const row = clamp(Math.round(y), 0, height);
    return Math.max(paperLeft[row] - x, x - paperRight[row]);
  }

  const mossTones = [
    [[47, 64, 13], [74, 101, 19]],
    [[57, 85, 14], [111, 145, 24]],
    [[70, 103, 15], [139, 172, 30]],
    [[97, 135, 25], [160, 192, 39]],
    [[121, 152, 28], [186, 208, 56]],
    [[133, 161, 37], [211, 222, 99]],
  ];

  function bitmap(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  function noiseGrid(spacing, random) {
    const cols = Math.ceil(width / spacing) + 2;
    const rows = Math.ceil(height / spacing) + 2;
    const points = Float32Array.from({ length: cols * rows }, random);
    return (x, y) => {
      const gx = x / spacing;
      const gy = y / spacing;
      const col = Math.floor(gx);
      const row = Math.floor(gy);
      const i = row * cols + col;
      const dx = smooth(gx - col);
      const dy = smooth(gy - row);
      return mix(mix(points[i], points[i + 1], dx), mix(points[i + cols], points[i + cols + 1], dx), dy);
    };
  }

  function mossUnderpainting(random) {
    const texture = bitmap(width / 2, height / 2);
    const paint = texture.getContext('2d');
    const light = noiseGrid(123, random);
    const clusters = noiseGrid(36, random);
    const creases = noiseGrid(8, random);
    const pixels = paint.createImageData(texture.width, texture.height);
    const stops = [[44, 62, 13], [76, 105, 16], [110, 146, 22], [153, 181, 40], [185, 204, 66]];
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const index = (y / 2 * texture.width + x / 2) * 4;
        const sun = .13 * (1 - x / width) + .043 * (1 - y / height);
        const shade = .37 * (light(x, y) - .5) + .36 * (clusters(x, y) - .5) + .24 * (creases(x, y) - .5);
        const ridge = clamp(mossDistance(x, y) / 28, 0, 1);
        const inverseEdgeShade = .09 * (1 - ridge);
        const tone = clamp(.59 + sun + shade - inverseEdgeShade + (random() - .5) * .15, 0, .999) * 4;
        const stop = Math.floor(tone);
        for (let channel = 0; channel < 3; channel++) {
          pixels.data[index + channel] = mix(stops[stop][channel], stops[stop + 1][channel], tone - stop);
        }
        pixels.data[index + 3] = 255;
      }
    }
    paint.putImageData(pixels, 0, 0);
    return texture;
  }

  function mossBrush(tone, random) {
    const tile = bitmap(52, 52);
    const paint = tile.getContext('2d');
    const [dark, light] = tone;
    paint.translate(26, 28);
    const shade = paint.createLinearGradient(9, 12, -15, -18);
    shade.addColorStop(0, `rgb(${dark.join(' ')} / .83)`);
    shade.addColorStop(.6, `rgb(${light.join(' ')} / .91)`);
    shade.addColorStop(1, `rgb(${light.map((c, i) => c + (i === 2 ? 29 : 21)).join(' ')} / .9)`);

    for (let leaf = 0; leaf < 8; leaf++) {
      const direction = leaf * 2.39996 + random() * .65;
      const length = 9 + random() * 15;
      const breadth = 1 + random() * 2.8;
      const x = (random() - .5) * 10;
      const y = (random() - .5) * 6;
      paint.save();
      paint.translate(x, y);
      paint.rotate(direction);
      paint.fillStyle = leaf % 3 === 0 ? `rgb(${dark.join(' ')} / .75)` : shade;
      paint.beginPath();
      paint.moveTo(-.7, 0);
      paint.quadraticCurveTo(-breadth, -.62 * length, .7, -length);
      paint.quadraticCurveTo(breadth, -.71 * length, 1.3, -length * .18);
      paint.quadraticCurveTo(.8, -1.7, -.7, 0);
      paint.fill();
      if (leaf % 3 === 1) {
        paint.strokeStyle = '#e2e79e77';
        paint.lineWidth = .65;
        paint.beginPath();
        paint.moveTo(0, -length * .27);
        paint.quadraticCurveTo(-.1, -length * .54, .47, -length * .87);
        paint.stroke();
      }
      paint.restore();
    }
    return tile;
  }

  function paintMoss() {
    const paint = floor.getContext('2d');
    const random = gardenRandom(16837);
    if (!window.JournalPage) window.SeasonsPaper.paintPaper(paint, width, height);

    const paperLight = paint.createLinearGradient(width, height * .26, width * .22, height);
    paperLight.addColorStop(0, '#c5964732');
    paperLight.addColorStop(.56, '#e0b75c20');
    paperLight.addColorStop(1, '#fff8dd21');
    paint.fillStyle = paperLight;
    paint.fillRect(0, 0, width, height);

    paint.save();
    paint.shadowColor = '#45421e8c';
    paint.shadowOffsetX = 5;
    paint.shadowOffsetY = 7;
    paint.shadowBlur = 13;
    paint.fillStyle = '#648421';
    paint.fill(carpet, 'evenodd');
    paint.restore();

    paint.save();
    paint.clip(carpet, 'evenodd');
    paint.drawImage(mossUnderpainting(random), 0, 0, width, height);
    paint.restore();

    const tufts = mossTones.flatMap(tone => Array.from({ length: 5 }, () => mossBrush(tone, random)));
    const exposure = noiseGrid(47, random);
    for (let i = 0; i < 40500; i++) {
      const x = random() * width;
      const y = random() * height;
      if (mossDistance(x, y) < -2) continue;
      const density = exposure(x, y);
      const tone = clamp(Math.floor(6 * (.63 * density + .25 * random() + .21 * (1 - x / width))), 0, 5);
      const size = 6 + random() ** 1.8 * (13 + density * 13);
      paint.globalAlpha = .44 + random() * .52;
      const tuft = tufts[tone * 5 + Math.floor(random() * 5)];
      paint.drawImage(tuft, x - size / 2, y - size * .59, size, size);
    }
    paint.globalAlpha = 1;
  }

  const petalTones = [
    { petals: 6, width: .47, disk: .15, light: '#fff4d9', shade: '#d6b792', center: '#c7ab68', seed: '#fef0b9' },
    { petals: 7, width: .45, disk: .13, light: '#fff9e6', shade: '#dfccb7', center: '#d4b881', seed: '#fff1cd' },
    { petals: 5, width: .5, disk: .16, light: '#fae9d8', shade: '#d9b494', center: '#c1a075', seed: '#f7e0b6' },
    { petals: 7, width: .5, disk: .13, light: '#f5c5bb', shade: '#bc857c', center: '#c1a17f', seed: '#f7dfb8' },
    { petals: 6, width: .49, disk: .15, light: '#f6d2c7', shade: '#c69691', center: '#cdac88', seed: '#f8e7bf' },
  ];

  function blossomBunch(random, variants, radius, tint) {
    const spread = radius * (1 + random() * .4);
    const rise = radius * (.8 + random() * .58);
    const tile = bitmap(Math.ceil(spread * 2 + 22), Math.ceil(rise + 26));
    const paint = tile.getContext('2d');
    const rootX = tile.width / 2;
    const rootY = tile.height - 5;
    const count = 6 + Math.floor(random() * 8);
    const windward = (random() - .5) * .7;
    const stems = paint.createLinearGradient(0, rootY, 0, rootY - rise);
    stems.addColorStop(0, '#53651b12');
    stems.addColorStop(.55, '#5d742699');
    stems.addColorStop(1, '#c3c679ca');
    const blooms = [];
    for (let i = 0; i < count; i++) {
      const headX = rootX + (random() - .5) * spread * 1.55 + windward * (rise * .35);
      const headY = rootY - rise * (.32 + random() * .66);
      const scale = (2.2 + random() ** 1.18 * 4) * (.65 + radius * .014);
      const alternate = random() < .22;
      const pool = variants[alternate ? Math.floor(random() * 3) : tint];
      blooms.push({ x: headX, y: headY, scale, art: pool[Math.floor(random() * pool.length)], angle: random() * tau });
      paint.strokeStyle = stems;
      paint.lineWidth = .8 + random() * .5;
      paint.beginPath();
      paint.moveTo(rootX + (random() - .5) * 11, rootY);
      paint.quadraticCurveTo(mix(rootX, headX, .38), mix(rootY, headY, .62), headX, headY);
      paint.stroke();

      if (i % 3 === 0) {
        paint.fillStyle = '#a8ba536c';
        paint.beginPath();
        paint.ellipse(mix(rootX, headX, .7), mix(rootY, headY, .65), 2.5, scale * 1.18, headX > rootX ? .58 : -.58, 0, tau);
        paint.fill();
      }
    }

    for (const { x, y, scale, art, angle } of blooms.sort((a, b) => a.y - b.y)) {
      paint.fillStyle = '#51471845';
      paint.beginPath();
      paint.ellipse(x + scale * .35, y + scale * .55, scale * .96, scale * .66, .3, 0, tau);
      paint.fill();
      paint.save();
      paint.translate(x, y);
      paint.rotate(angle);
      const size = scale * 80 / 33;
      paint.drawImage(art, -size / 2, -size / 2, size, size);
      paint.restore();
    }
    return { tile, rootX, rootY };
  }

  function growBlossoms() {
    const random = gardenRandom(7069);
    const variants = petalTones.map(tone => Array.from({ length: 6 }, () => paintBloom(tone, random)));
    const patches = noiseGrid(90, random);
    const bunches = [];
    for (let row = 0; row < height; row += 33) {
      for (let col = 0; col < width; col += 33) {
        const x = col + 4 + random() * 28;
        const y = row + 18 + random() * 31;
        const density = patches(x, Math.min(y, height));
        if (random() > .19 + density * .63 || x > width || y > height + 7) continue;

        const radius = 10 + random() ** 1.16 * 24;
        if (Math.min(mossDistance(x, y - radius), mossDistance(x, y - radius * 1.65)) < radius * .55) continue;
        const tint = random() < .27 ? 3 + Math.floor(random() * 2) : Math.floor(random() * 3);
        bunches.push({
          ...blossomBunch(random, variants, radius, tint),
          x, y,
          flutter: .035 + random() * .088,
          phase: random() * tau,
        });
      }
    }
    return bunches.sort((a, b) => a.y - b.y);
  }

  paintMoss();
  const bunches = growBlossoms();
  let visible = !window.JournalPage;
  let previous;
  let elapsed = 0;
  let animation;
  let drawnFrame = -1;

  function drawFlowers(time) {
    const frame = Math.floor(time * 30);
    if (frame === drawnFrame) return;
    drawnFrame = frame;
    brush.clearRect(0, 0, width, height);
    for (const { tile, rootX, rootY, x, y, flutter, phase } of bunches) {
      const breeze = Math.sin(time * 1.65 - x * .0037 + y * .0029);
      const sway = flutter * (.72 * breeze + .43 * Math.sin(time * 2.4 + phase));
      brush.save();
      brush.translate(x, y);
      brush.rotate(sway);
      brush.drawImage(tile, -rootX, -rootY);
      brush.restore();
    }
  }

  function animate(now) {
    if (previous !== undefined) elapsed += Math.min((now - previous) / 1000, .05);
    previous = now;
    drawFlowers(elapsed);
    animation = requestAnimationFrame(animate);
  }

  function syncMotion() {
    cancelAnimationFrame(animation);
    previous = undefined;
    drawFlowers(elapsed);
    if (visible && !document.hidden && !motion.matches) animation = requestAnimationFrame(animate);
  }

  window.addEventListener('journal:visibility', event => {
    visible = event.detail;
    syncMotion();
  });
  const lyrics = document.querySelector('.garden-lyrics');
  const notesPanel = document.querySelector('.garden-notes');
  let activeTab = 'lyrics';
  let clipLines = [];
  let currentSongId = null;
  let currentNote = '';

  const notePad = document.createElement('textarea');
  notePad.className = 'garden-note-pad';
  notePad.setAttribute('aria-label', '留言');
  notePad.spellcheck = false;
  notePad.addEventListener('input', () => {
    currentNote = notePad.value;
    if (currentSongId) window.JournalPage?.favorites?.saveSongNote?.(currentSongId, currentNote);
  });
  if (notesPanel) notesPanel.replaceChildren(notePad);

  function renderLyricsPanel() {
    const count = clipLines.length;
    const maxLen = clipLines.reduce((m, s) => Math.max(m, s.length), 0);
    const density = count <= 4 && maxLen <= 10 ? 'sparse'
      : count <= 8 && maxLen <= 13 ? 'medium'
      : 'dense';
    lyrics.dataset.density = density;

    lyrics.replaceChildren(...clipLines.map((text, index) => {
      const line = document.createElement('p');
      line.className = 'lyric-line';
      line.style.setProperty('--i', String(index));
      line.textContent = text;
      return line;
    }));
    lyrics.hidden = activeTab !== 'lyrics' || !count;
    lyrics.scrollLeft = 0;
  }

  function renderNotesPanel(shouldFocus = false) {
    if (!notesPanel) return;
    notesPanel.hidden = activeTab !== 'notes';
    if (notePad.value !== currentNote) notePad.value = currentNote;
    if (activeTab === 'notes' && shouldFocus) {
      queueMicrotask(() => {
        notePad.focus({ preventScroll: true });
        notePad.selectionStart = notePad.selectionEnd = notePad.value.length;
      });
    }
  }

  window.addEventListener('journal:clip-lyrics', ({ detail: lines }) => {
    clipLines = Array.isArray(lines) ? lines : [];
    renderLyricsPanel();
  });
  window.addEventListener('journal:song-note', ({ detail }) => {
    currentSongId = detail?.songId ?? null;
    currentNote = typeof detail?.note === 'string' ? detail.note : '';
    renderNotesPanel(false);
  });
  window.addEventListener('journal:heart-tab', ({ detail }) => {
    const tab = typeof detail === 'string' ? detail : detail?.tab;
    const focus = Boolean(detail && typeof detail === 'object' && detail.focus);
    activeTab = tab === 'notes' ? 'notes' : 'lyrics';
    renderLyricsPanel();
    renderNotesPanel(focus);
  });
  document.addEventListener('visibilitychange', syncMotion);
  motion.addEventListener('change', syncMotion);
  syncMotion();
})();
