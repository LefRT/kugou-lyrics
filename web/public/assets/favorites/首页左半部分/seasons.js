'use strict';

const paperWidth = 620;
const paperHeight = 830;
const { makeRandom, paintGrain, wash, paintPaper } = window.SeasonsPaper;
const panelLeft = 99;
const panelWidth = 422;
const panelHeight = 154;
const panelTops = [62, 245, 428, 611];
const panels = [...document.querySelectorAll('.panel')];

// Each bough grows from a point on a thicker branch. All faces share this drawing.
const boughs = [
  [48, 1.1, [[128, 827], [148, 815], [165, 793], [187, 761], [210, 723], [231, 682], [245, 639], [249, 595], [240, 556], [229, 517], [235, 485], [255, 452], [273, 418], [280, 379], [274, 347], [261, 316], [255, 285], [258, 254], [248, 227], [226, 202], [210, 176], [200, 144], [197, 118], [186, 94], [167, 74], [158, 50], [141, 32], [134, 14], [123, 6]]],

  // The crown grows along two long, rising forks.
  [12, .7, [[225, 200], [246, 174], [276, 151], [303, 144], [328, 119], [353, 109], [375, 87], [391, 56], [410, 37], [418, 16]]],
  [5.5, .7, [[264, 159], [263, 134], [270, 115], [268, 92], [279, 77]]],
  [3.4, .65, [[269, 121], [284, 108], [304, 104], [317, 89]]],
  [5.5, .7, [[323, 123], [349, 128], [375, 117], [400, 117], [421, 101]]],
  [3.2, .55, [[374, 116], [387, 97], [409, 90], [422, 75]]],
  [4.2, .6, [[376, 85], [363, 69], [365, 48], [359, 35]]],
  [7.5, .7, [[199, 138], [175, 130], [149, 134], [124, 122], [104, 103], [83, 97], [65, 79]]],
  [3.5, .6, [[122, 120], [102, 135], [79, 133], [62, 145]]],
  [3.2, .55, [[104, 102], [102, 79], [90, 64], [88, 46]]],
  [4.2, .6, [[172, 80], [186, 60], [189, 37], [200, 19]]],
  [3.4, .65, [[141, 32], [123, 34], [108, 26], [86, 27]]],
  [4.5, .7, [[215, 185], [193, 183], [177, 196], [157, 197], [138, 212]]],

  [15, .85, [[279, 382], [302, 345], [330, 326], [358, 301], [378, 271], [386, 239], [402, 212], [426, 194], [443, 167], [460, 137], [485, 119], [504, 93], [515, 65]]],
  [6, .65, [[378, 273], [361, 247], [358, 221], [346, 202], [348, 178], [339, 162]]],
  [3.5, .6, [[357, 217], [338, 213], [322, 195], [302, 190]]],
  [5.2, .6, [[424, 195], [456, 190], [483, 175], [509, 174], [530, 152], [555, 140]]],
  [3.2, .6, [[508, 174], [513, 151], [529, 132], [532, 112]]],
  [3.5, .65, [[476, 126], [473, 108], [483, 86], [481, 68]]],
  [4.5, .6, [[258, 291], [238, 266], [222, 257], [216, 233], [202, 218]]],

  [10.5, .75, [[276, 410], [312, 389], [346, 380], [376, 359], [415, 352], [449, 332], [473, 307], [503, 292], [529, 266], [552, 252]]],
  [4, .6, [[376, 359], [387, 333], [382, 309], [396, 290]]],
  [3.5, .6, [[447, 333], [469, 339], [493, 335], [516, 342], [533, 329]]],
  [3.7, .6, [[503, 292], [506, 269], [520, 249], [524, 230], [541, 211]]],
  [9.2, .7, [[258, 449], [229, 428], [201, 414], [180, 390], [163, 359], [135, 346], [109, 339], [84, 318], [69, 294]]],
  [4.2, .7, [[180, 390], [153, 391], [131, 406], [102, 409], [85, 427]]],
  [3.5, .6, [[133, 405], [111, 393], [89, 392], [69, 381]]],
  [4, .6, [[135, 346], [134, 322], [122, 304], [128, 284]]],
  [4.8, .65, [[206, 417], [201, 387], [214, 363], [214, 345], [232, 327]]],

  [8.6, .7, [[231, 524], [258, 508], [282, 482], [313, 467], [345, 463], [374, 445], [405, 440], [430, 422], [463, 419], [489, 400], [518, 391]]],
  [4.5, .65, [[312, 467], [326, 445], [325, 426], [336, 409]]],
  [3.4, .6, [[371, 447], [395, 463], [420, 466], [443, 485]]],
  [3.2, .6, [[429, 422], [441, 402], [459, 386], [467, 368]]],
  [7.5, .65, [[231, 514], [200, 504], [174, 484], [141, 477], [117, 459], [95, 435], [69, 427], [48, 410]]],
  [3.8, .6, [[140, 477], [117, 489], [103, 508], [82, 512], [64, 529]]],
  [3.4, .55, [[118, 459], [117, 437], [105, 418]]],
  [5, .65, [[241, 558], [215, 552], [196, 537], [173, 534], [152, 517]]],

  [9.5, .7, [[247, 612], [276, 589], [304, 555], [331, 539], [365, 533], [391, 513], [411, 489], [434, 480]]],
  [4, .62, [[301, 559], [316, 574], [338, 578], [355, 594], [380, 595]]],
  [4.4, .6, [[364, 533], [385, 541], [407, 534], [438, 533], [462, 515], [480, 511]]],
  [3, .6, [[441, 530], [447, 511], [463, 491]]],
  [6.7, .7, [[239, 665], [213, 645], [192, 619], [161, 609], [139, 586], [113, 573], [92, 549], [73, 545]]],
  [4, .6, [[164, 610], [140, 616], [124, 634], [101, 641], [85, 658]]],
  [3.4, .55, [[111, 570], [110, 547], [97, 531], [99, 515]]],

  // Winter leaves room around the long bare branches.
  [10.5, .7, [[209, 724], [236, 703], [251, 674], [280, 658], [314, 646], [341, 623], [371, 614], [398, 593], [424, 585], [451, 562], [478, 551], [503, 531]]],
  [6, .65, [[313, 646], [341, 658], [371, 657], [400, 678], [433, 683], [461, 701], [491, 699], [518, 711], [545, 699]]],
  [3.8, .62, [[428, 682], [447, 665], [468, 664], [491, 646], [515, 648], [535, 631]]],
  [3.6, .57, [[461, 701], [463, 726], [482, 737], [488, 752]]],
  [4.6, .65, [[398, 593], [423, 609], [451, 604], [480, 620], [504, 616]]],
  [3.4, .58, [[478, 551], [491, 530], [490, 506], [507, 488]]],
  [7.6, .7, [[178, 775], [211, 762], [234, 742], [268, 735], [291, 712], [321, 709], [349, 692], [368, 669]]],
  [3.6, .56, [[267, 736], [288, 750], [309, 752], [327, 766], [352, 764]]],
  [3.7, .58, [[233, 743], [249, 720], [244, 701], [254, 686]]],
  [4.8, .68, [[209, 724], [186, 712], [159, 713], [135, 696], [110, 699], [90, 682]]],
  [9, .6, [[171, 784], [163, 800], [141, 805], [115, 813], [101, 823]]],
  [6.2, .55, [[167, 789], [174, 800], [194, 806], [210, 814]]],
];

function smoothPoints(points) {
  const samples = [];
  const interpolate = (a, b, c, d, t) => b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * b - 3 * c + d - a)));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const c = points[i + 1];
    const d = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 3));
    for (let point = 0; point < steps; point++) {
      samples.push([0, 1].map(axis => interpolate(a[axis], b[axis], c[axis], d[axis], point / steps)));
    }
  }
  samples.push(points.at(-1));
  return samples;
}

const tree = new Path2D();
const branchSamples = boughs.map(([base, tip, points], branch) => {
  const samples = smoothPoints(points);
  const edges = samples.map(([x, y], index) => {
    const before = samples[Math.max(index - 1, 0)];
    const after = samples[Math.min(index + 1, samples.length - 1)];
    const angle = Math.atan2(after[1] - before[1], after[0] - before[0]) + Math.PI / 2;
    const progress = index / (samples.length - 1);
    const widthVariation = branch === 0
      ? 1 + .025 * Math.sin(progress * 18)
      : 1 + .095 * Math.sin(index * .49 + branch) + .043 * Math.cos(index * 1.37);
    const taper = (1 - progress) ** (branch === 0 ? 1.19 : 1.06);
    const rootTip = branch === 0 ? .1 + .9 * Math.sin(Math.min(1, progress / .072) * Math.PI / 2) : 1;
    const radius = (tip + (base - tip) * taper) * widthVariation * rootTip / 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  for (const side of [1, -1]) {
    for (let step = 0; step < samples.length; step++) {
      const i = side === 1 ? step : samples.length - 1 - step;
      const [x, y] = samples[i];
      const [dx, dy] = edges[i];
      const method = side === 1 && step === 0 ? 'moveTo' : 'lineTo';
      tree[method](x + side * dx, y + side * dy);
    }
  }
  tree.closePath();
  return { samples, edges };
});

function drawTree(context, tinted) {
  context.fillStyle = tinted ? '#302922' : '#352c2a';
  context.fill(tree);
  context.save();
  context.clip(tree);
  const random = makeRandom(895);
  const bark = ['#08091250', '#16121179', '#635b5050', '#a2866255', '#e0ba7f30'];

  branchSamples.forEach(({ samples, edges }, branch) => {
    const passes = branch === 0 ? 36 : 5;
    for (let pass = 0; pass < passes; pass++) {
      const start = Math.floor(random() * (samples.length - 3));
      const end = Math.min(samples.length, start + 4 + Math.floor(random() * (branch === 0 ? 65 : 18)));
      const offset = random() * 2 - 1;
      const phase = random() * 6;
      context.strokeStyle = bark[Math.floor(random() * bark.length)];
      context.lineWidth = .35 + random() * (branch === 0 ? 1.65 : .72);
      context.beginPath();
      for (let i = start; i < end; i++) {
        const [x, y] = samples[i];
        const [dx, dy] = edges[i];
        const drift = offset + Math.sin(i * .18 + phase) * .12;
        context.lineTo(x + drift * dx, y + drift * dy);
      }
      context.stroke();
    }
  });
  paintGrain(context, paperWidth, paperHeight, .65);
  context.restore();
}

const seasons = [
  {
    sky: ['#79b5ce', '#a6c8d8', '#83b5ce'],
    pigments: ['#b95d85', '#cd7498', '#de8eac', '#efa8bd', '#f5c6d1', '#f5d9da', '#ffdce3'],
    clusters: [[23, 26, 52, 22], [105, 39, 46, 26], [171, 22, 61, 32], [271, 25, 68, 22], [367, 23, 57, 24], [408, 69, 56, 25], [31, 105, 51, 43], [90, 126, 56, 25], [193, 111, 55, 44], [295, 106, 56, 27], [355, 139, 59, 33]],
    density: 83, size: 10,
  },
  {
    sky: ['#86b7b1', '#a9c8aa', '#76a8a4'],
    pigments: ['#41613d', '#507444', '#668451', '#7c984e', '#99ac57', '#b5c371', '#d5d68b'],
    clusters: [[24, 29, 58, 32], [114, 41, 58, 35], [207, 32, 58, 34], [314, 31, 70, 35], [410, 26, 59, 31], [45, 114, 70, 47], [138, 130, 53, 30], [259, 115, 71, 33], [352, 104, 61, 31], [410, 131, 65, 29]],
    density: 125, size: 9,
  },
  {
    sky: ['#639dc7', '#9ac3df', '#6fa8d0'],
    pigments: ['#a66c2d', '#bf8a37', '#d59e38', '#dfb344', '#e9c455', '#f1d67a', '#f5e39a'],
    clusters: [[17, 39, 51, 30], [92, 37, 54, 35], [171, 21, 64, 27], [256, 30, 58, 30], [305, 46, 42, 23], [403, 37, 20, 16], [15, 106, 48, 35], [106, 121, 66, 43], [183, 110, 68, 33], [271, 112, 57, 25], [335, 92, 54, 20]],
    density: 88, size: 10,
  },
  { sky: ['#657f9d', '#9aafc3', '#7189a6'] },
];

function pigmentMark(context, random, x, y, radius, color) {
  const arc = Math.PI * 2;
  const rotation = random() * arc;
  context.fillStyle = color;
  context.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = rotation + i * arc / 8;
    const edge = radius * (.57 + random() * .54);
    context.lineTo(x + Math.cos(angle) * edge, y + Math.sin(angle) * edge * .89);
  }
  context.closePath();
  context.fill();
}

function drawFoliage(context, index, random) {
  const { clusters, pigments, density, size } = seasons[index];
  for (const [x, y, width, height] of clusters) {
    for (let i = 0; i < density; i++) {
      const angle = random() * Math.PI * 2;
      const spread = Math.sqrt(random()) * (.75 + random() * .42);
      const markX = x + Math.cos(angle) * spread * width;
      const markY = y + Math.sin(angle) * spread * height;
      const radius = (.18 + random() ** .8) * size;
      const shade = pigments[Math.floor(random() * pigments.length)];
      context.globalAlpha = .41 + random() * .55;
      pigmentMark(context, random, markX, markY, radius, shade);
    }
  }
  context.globalAlpha = 1;

  if (index === 0) {
    context.fillStyle = '#ffe5ec';
    for (let i = 0; i < 76; i++) {
      const [x, y, w, h] = clusters[i % clusters.length];
      const cx = x + (random() - .5) * w * 1.65;
      const cy = y + (random() - .5) * h * 1.65;
      const radius = 1 + random() * 2;
      context.globalAlpha = .38 + random() * .48;
      context.beginPath();
      for (let petal = 0; petal < 5; petal++) {
        const angle = petal * Math.PI * 2 / 5;
        const px = cx + Math.cos(angle) * radius * 1.1;
        const py = cy + Math.sin(angle) * radius * 1.1;
        context.moveTo(px + radius, py);
        context.arc(px, py, radius, 0, Math.PI * 2);
      }
      context.fill();
    }
    context.globalAlpha = 1;
  }

  if (index === 1) {
    const fruit = [[32, 38], [61, 102], [106, 31], [125, 86], [156, 119], [188, 50], [224, 88], [253, 29], [269, 126], [302, 70], [320, 46], [343, 103], [363, 33], [383, 75], [405, 52], [75, 128], [19, 80], [406, 129]];
    for (const [x, y] of fruit) {
      const radius = 3.4 + random() * 3.3;
      const color = context.createRadialGradient(x - 2, y - 2, .4, x, y, radius);
      color.addColorStop(0, '#ee9772');
      color.addColorStop(.45, '#d9624f');
      color.addColorStop(1, '#8e3638');
      pigmentMark(context, random, x, y, radius, color);
      context.strokeStyle = '#544632';
      context.lineWidth = .9;
      context.beginPath();
      context.moveTo(x, y - radius * .55);
      context.quadraticCurveTo(x - 1, y - radius * 1.2, x + 1.6, y - radius * 1.42);
      context.stroke();
    }
  }
}

function drawSnow(context, random) {
  for (let i = 0; i < 245; i++) {
    const x = random() * panelWidth;
    const y = random() * panelHeight;
    context.globalAlpha = .2 + random() * .67;
    pigmentMark(context, random, x, y, .45 + random() ** 2 * 3.25, '#f5f2e6');
  }
  context.globalAlpha = 1;
}

function drawSnowOnBranches(context) {
  const random = makeRandom(258);
  context.lineCap = 'round';
  branchSamples.forEach(({ samples, edges }, branch) => {
    for (let i = 0; i < samples.length - 2; i++) {
      const [x, y] = samples[i];
      const [nextX, nextY] = samples[i + 1];
      if (y < panelTops[3] || random() < .34 || (branch !== 0 && Math.abs(nextY - y) > 2 * Math.abs(nextX - x))) continue;
      const width = Math.abs(edges[i][1]);
      if (Math.hypot(...edges[i]) < .88) continue;
      context.strokeStyle = ['#edece4', '#faf7e9', '#a8c2d7'][Math.floor(random() * 3)];
      context.lineWidth = Math.min(2.65, .65 + width * .36);
      context.beginPath();
      context.moveTo(x, y - width * .81);
      context.lineTo(nextX, nextY - Math.abs(edges[i + 1][1]) * .81);
      context.stroke();
    }
  });
}

function prepareCanvas(canvas) {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(Number(canvas.getAttribute('width')) * scale);
  canvas.height = Math.round(Number(canvas.getAttribute('height')) * scale);
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  return context;
}

function drawPaper() {
  const context = prepareCanvas(document.querySelector('.paper'));
  if (!window.JournalPage) paintPaper(context, paperWidth, paperHeight);

  const margins = new Path2D();
  margins.rect(0, 0, paperWidth, paperHeight);
  panelTops.forEach(y => margins.rect(panelLeft, y, panelWidth, panelHeight));
  context.clip(margins, 'evenodd');
  drawTree(context, false);
}

function drawFace(canvas, index, color) {
  const context = prepareCanvas(canvas);
  const random = makeRandom(2691 + index * 309);
  wash(context, panelWidth, panelHeight, color ? seasons[index].sky : ['#9d9ea6', '#b8b6ba', '#a3a3ab']);

  if (color && index < 3) {
    drawFoliage(context, index, random);
  } else if (color) {
    drawSnow(context, random);
  } else {
    for (let i = 0; i < 150; i++) {
      const x = random() * panelWidth;
      const y = random() * panelHeight;
      pigmentMark(context, random, x, y, .4 + random() * 2.4, i % 3 ? '#47475034' : '#e9e6de70');
    }
  }

  paintGrain(context, panelWidth, panelHeight, .65);
  context.save();
  context.translate(-panelLeft, -panelTops[index]);
  drawTree(context, color);
  if (color && index === 3) drawSnowOnBranches(context);
  context.restore();
  context.strokeStyle = '#fbf1dc94';
  context.beginPath();
  context.moveTo(.5, panelHeight - .5);
  context.lineTo(.5, .5);
  context.lineTo(panelWidth - .5, .5);
  context.stroke();
}

if (!window.JournalPage) {
  drawPaper();
  panels.forEach((panel, index) => {
    drawFace(panel.querySelector('.face--gray'), index, false);
    drawFace(panel.querySelector('.face--color'), index, true);
  });
}

const revealButton = document.querySelector('#reveal');
const resetButton = document.querySelector('#reset');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let queuedFlips = [];

const isOpen = panel => panel.getAttribute('aria-pressed') === 'true';
const setOpen = (panel, open) => panel.setAttribute('aria-pressed', String(open));

function updateControls() {
  revealButton.disabled = queuedFlips.length > 0 || panels.every(isOpen);
  resetButton.disabled = queuedFlips.length === 0 && !panels.some(isOpen);
}

function clearQueue() {
  queuedFlips.forEach(clearTimeout);
  queuedFlips = [];
}

function mountJournalCards() {
  const painting = document.querySelector('.painting');
  painting.removeAttribute('aria-describedby');
  const tree = document.createElement('img');
  tree.src = '../season-tree.webp';
  tree.className = 'paper';
  tree.alt = '';
  tree.decoding = 'async';
  painting.querySelector('.paper').replaceWith(tree);
  let openCard;
  function closeCard(restoreFocus = false) {
    if (!openCard) return;
    const { card, front, back } = openCard;
    delete card.dataset.open;
    back.inert = true;
    front.inert = false;
    front.setAttribute('aria-expanded', 'false');
    if (restoreFocus) front.focus({ preventScroll: true });
    openCard = undefined;
  }

  panels.forEach(front => {
    const turn = front.querySelector('.panel-turn');
    const art = document.createElement('img');
    art.src = `../season-${front.dataset.season}.webp`;
    art.alt = '';
    art.decoding = 'async';
    const card = document.createElement('div');
    card.className = front.className;
    card.dataset.season = front.dataset.season;
    front.replaceWith(card);
    art.className = 'season-art';
    front.className = 'face season-front';
    front.removeAttribute('aria-pressed');
    front.setAttribute('aria-expanded', 'false');
    front.replaceChildren(art);

    const back = document.createElement('div');
    back.className = 'face season-back';
    back.id = `lyrics-${card.dataset.season}`;
    back.inert = true;
    front.setAttribute('aria-controls', back.id);

    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'season-fold';
    fold.setAttribute('aria-label', `合上${front.getAttribute('aria-label')}`);
    fold.append(art.cloneNode());
    fold.addEventListener('click', () => closeCard(true));

    const scroll = document.createElement('div');
    scroll.className = 'season-lyrics';
    const lyrics = document.createElement('button');
    lyrics.type = 'button';
    lyrics.className = 'season-clip';
    scroll.append(lyrics);
    back.append(fold, scroll);

    turn.removeAttribute('aria-hidden');
    turn.replaceChildren(front, back);
    card.append(turn);
    let clip;
    front.addEventListener('click', event => {
      clip = window.JournalPage.favorites?.nextClip();
      if (!clip) return;
      closeCard();
      lyrics.replaceChildren(...clip.lines.map(text => {
        const line = document.createElement('span');
        line.textContent = text;
        return line;
      }));
      scroll.scrollTop = 0;
      openCard = { card, front, back, lyrics };
      card.dataset.open = '';
      front.setAttribute('aria-expanded', 'true');
      front.inert = true;
      back.inert = false;
      if (!event.detail) lyrics.focus({ preventScroll: true });
    });
    lyrics.addEventListener('click', event => {
      if (clip && openCard?.card === card) window.JournalPage.favorites?.playClip(clip, !event.detail);
    });
  });
  window.addEventListener('journal:reset-clips', () => closeCard());
  window.addEventListener('journal:focus-clip', () => openCard?.lyrics.focus({ preventScroll: true }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCard(true);
  });
}

if (window.JournalPage) {
  mountJournalCards();
} else {
  panels.forEach(panel => panel.addEventListener('click', () => {
    clearQueue();
    setOpen(panel, !isOpen(panel));
    updateControls();
  }));
}

revealButton.addEventListener('click', () => {
  const closed = panels.filter(panel => !isOpen(panel));
  if (motionPreference.matches) {
    closed.forEach(panel => setOpen(panel, true));
  } else {
    queuedFlips = closed.map((panel, index) => setTimeout(() => {
      queuedFlips.shift();
      setOpen(panel, true);
      updateControls();
    }, index * 250));
  }
  updateControls();
});

resetButton.addEventListener('click', () => {
  clearQueue();
  panels.forEach(panel => setOpen(panel, false));
  updateControls();
});
