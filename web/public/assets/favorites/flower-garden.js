const gardenLeafTones = [
  ["#315344", "#486555", "#aec17b"],
  ["#314e3d", "#62815a", "#c5cb97"],
  ["#394b38", "#77895e", "#d1d1a2"],
  ["#244b44", "#527b67", "#9dbfa3"],
];

function gardenRandom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function paintBloom(profile, random) {
  const bloom = document.createElement("canvas");
  bloom.width = bloom.height = 80;
  const paint = bloom.getContext("2d");
  paint.translate(40, 40);
  paint.scale(33, 33);
  const initialAngle = random() * Math.PI * 2;

  for (let petal = 0; petal < profile.petals; petal++) {
    const angle = initialAngle + (petal + (random() - 0.5) * 0.18) * 2 * Math.PI / profile.petals;
    const width = profile.width * (0.86 + random() * 0.28);
    const length = 0.8 + random() * 0.21;
    paint.save();
    paint.rotate(angle);

    const color = paint.createLinearGradient(0, 0, width * 0.45, -length);
    color.addColorStop(0, profile.shade);
    color.addColorStop(0.88, profile.light);
    paint.fillStyle = color;
    paint.beginPath();
    paint.moveTo(-0.08, 0.08);
    paint.bezierCurveTo(-width * 0.58, -0.15, -width * 1.04, -length * 0.65, -width * 0.59, -length * 0.9);
    paint.bezierCurveTo(-width * 0.11, -length * 1.09, width * 0.58, -length * 1.05, width * 0.79, -length * 0.79);
    paint.bezierCurveTo(width * 0.99, -length * 0.54, width * 0.48, -0.19, 0.08, 0.08);
    paint.fill();

    paint.strokeStyle = "#fff5db65";
    paint.lineWidth = 0.03;
    paint.lineCap = "round";
    paint.beginPath();
    paint.moveTo(width * 0.05, -length * 0.34);
    paint.quadraticCurveTo(width * 0.38, -length * 0.52, width * 0.27, -length * 0.8);
    paint.stroke();
    paint.strokeStyle = "#ffe9e049";
    paint.lineWidth = 0.045;
    paint.beginPath();
    paint.moveTo(-width * 0.29, -length * 0.82);
    paint.quadraticCurveTo(width * 0.05, -length * 0.99, width * 0.43, -length * 0.86);
    paint.stroke();
    paint.restore();
  }

  paint.fillStyle = profile.center;
  paint.beginPath();
  paint.ellipse(0, 0, profile.disk * 1.12, profile.disk, 0.19, 0, 2 * Math.PI);
  paint.fill();
  for (let seed = 0; seed < 13; seed++) {
    const angle = seed * 2.4;
    const distance = Math.sqrt(seed / 13) * profile.disk * 0.9;
    paint.fillStyle = seed % 4 === 0 ? profile.shade : profile.seed;
    paint.beginPath();
    paint.arc(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.9, 0.02 + random() * 0.023, 0, 2 * Math.PI);
    paint.fill();
  }
  return bloom;
}

function paintGardenLeaf(paint, x, y, angle, length, width, [shade, light, vein]) {
  paint.save();
  paint.translate(x, y);
  paint.rotate(angle);

  paint.fillStyle = shade;
  paint.beginPath();
  paint.moveTo(0, 0);
  paint.bezierCurveTo(length * 0.21, -width, length * 0.57, -width * 0.8, length, -width * 0.15);
  paint.bezierCurveTo(length * 0.64, width * 0.11, length * 0.40, width * 0.82, 0, 0);
  paint.fill();

  paint.fillStyle = light;
  paint.beginPath();
  paint.moveTo(0, 0);
  paint.bezierCurveTo(length * 0.21, -width, length * 0.57, -width * 0.8, length, -width * 0.15);
  paint.quadraticCurveTo(length * 0.4, -width * 0.18, 0, 0);
  paint.fill();

  paint.globalAlpha *= 0.48;
  paint.strokeStyle = vein;
  paint.lineWidth = 0.65;
  paint.beginPath();
  paint.moveTo(0, 0);
  paint.quadraticCurveTo(length * 0.48, -width * 0.04, length * 0.84, -width * 0.16);
  paint.stroke();
  paint.restore();
}

function paintGrassBlade(paint, { x, y, lean, rise, phase, shade }, time) {
  const sway = Math.sin(time * 1.25 + phase) * (rise * 0.13);
  const tipX = x + lean + sway;
  const tipY = y - rise;
  const color = paint.createLinearGradient(0, y, 0, tipY);
  color.addColorStop(0, "#25443800");
  color.addColorStop(0.46, shade[0] + "b0");
  color.addColorStop(1, shade[1] + "bd");
  paint.fillStyle = color;
  paint.beginPath();
  paint.moveTo(x - 2, y);
  paint.quadraticCurveTo(x + lean * 0.14, y - rise * 0.75, tipX, tipY);
  paint.quadraticCurveTo(x + lean * 0.36 + 2, y - rise * 0.63, x + 2, y);
  paint.fill();
}

class FlowerGarden {
  constructor(canvas, width, height, { profiles, beds, drifts, leafTones = gardenLeafTones, seed = 2026, wind = 1, fps = 30 }) {
    this.paint = canvas.getContext("2d");
    this.width = width;
    this.height = height;
    this.paint.scale(canvas.width / width, canvas.height / height);
    this.shoots = [];
    this.grass = [];
    this.leafTones = leafTones;
    this.wind = wind;
    this.fps = fps;
    const random = gardenRandom(seed);
    const blooms = Object.fromEntries(Object.entries(profiles).map(([kind, profile]) => [
      kind, Array.from({ length: 5 }, () => paintBloom(profile, random)),
    ]));

    for (const { root: [x, y], flowers } of beds) {
      for (let blade = 0; blade < 3; blade++) {
        this.grass.push({
          x: x + (random() - 0.5) * 42, y: y + random() * 15,
          lean: (random() - 0.5) * 65, rise: 19 + random() * 32,
          phase: random() * 2 * Math.PI, shade: leafTones[blade % leafTones.length],
        });
      }
      flowers.forEach(([kind, lean, rise, radius], index) => {
        const rootX = x + (index - (flowers.length - 1) / 2) * 10;
        const rootY = y + (random() - 0.5) * 9;
        this.plantFlower(rootX, rootY, lean, rise, radius, blooms[kind], random);
      });
    }

    for (const [kind, centerX, centerY, spreadX, spreadY, count, radius] of drifts) {
      const rotation = random() * 2 * Math.PI;
      for (let index = 0; index < count; index++) {
        const angle = rotation + index * 2.39996 + (random() - 0.5) * 0.44;
        const distance = Math.sqrt((index + 0.5) / count);
        const x = centerX + Math.cos(angle) * spreadX * distance;
        const y = centerY + Math.sin(angle) * spreadY * distance;
        const lean = (random() - 0.5) * 26;
        const rise = 17 + random() * 21;
        const flowerRadius = radius * (0.62 + random() * 0.68);
        this.plantFlower(x - lean, y + rise, lean, rise, flowerRadius, blooms[kind], random);
      }
    }

    this.shoots.sort((a, b) => a.y - b.y);
  }

  plantFlower(x, y, lean, rise, radius, blooms, random) {
    const leaves = [
      { at: 0.43 + random() * 0.14, length: 5 + random() * rise * 0.21, tilt: (random() - 0.5) * 0.48 },
    ];
    if (rise > 40) {
      leaves.push({ at: 0.63 + random() * 0.12, length: 8 + random() * rise * 0.16, tilt: (random() - 0.5) * 0.52 });
    }
    this.shoots.push({
      x, y, lean, rise, radius, leaves,
      side: random() < 0.5 ? -1 : 1,
      phase: random() * 2 * Math.PI,
      pace: 0.93 + random() * 0.45,
      tilt: (random() - 0.5) * 1.22,
      pitch: 0.57 + random() * 0.4,
      curve: 0.05 + random() * 0.32,
      shade: this.leafTones[Math.floor(random() * this.leafTones.length)],
      bloom: blooms[Math.floor(random() * blooms.length)],
    });
  }

  draw(time) {
    const frame = Math.floor(time * this.fps);
    if (frame === this.previousFrame) return;
    this.previousFrame = frame;
    const paint = this.paint;
    paint.clearRect(0, 0, this.width, this.height);
    paint.lineCap = "round";

    for (const blade of this.grass) paintGrassBlade(paint, blade, time);
    for (const shoot of this.shoots) this.drawShoot(shoot, time);
  }

  drawShoot(shoot, time) {
    const paint = this.paint;
    const { x, y, lean, rise, radius, phase, pace, tilt, pitch, curve, side, shade, leaves, bloom } = shoot;
    const gust = Math.sin(time * 1.22 - x * 0.004 + y * 0.002);
    const flutter = Math.sin(time * pace * 1.15 + phase);
    const flex = 4 + Math.min(rise, 72) * 0.105;
    const bend = flex * this.wind * (0.69 * gust + 0.55 * flutter);
    const controlX = x + lean * curve + bend * 0.14;
    const controlY = y - rise * 0.58;
    const tipX = x + lean + bend;
    const tipY = y - rise + bend * lean / rise * 0.22;

    const stem = paint.createLinearGradient(0, y, 0, tipY);
    stem.addColorStop(0, "#25443800");
    stem.addColorStop(0.25, shade[0] + "a6");
    stem.addColorStop(0.74, shade[1] + "e8");
    stem.addColorStop(1, shade[1]);
    paint.beginPath();
    paint.moveTo(x, y);
    paint.quadraticCurveTo(controlX, controlY, tipX, tipY);
    paint.strokeStyle = stem;
    paint.lineWidth = 1.55;
    paint.stroke();

    leaves.forEach(({ at, length, tilt }, index) => {
      const facing = index === 0 ? side : -side;
      const base = 1 - at;
      const leafX = base * base * x + 2 * base * at * controlX + at * at * tipX;
      const leafY = base * base * y + 2 * base * at * controlY + at * at * tipY;
      const angle = (facing === 1 ? -0.57 : -2.56) + tilt + flutter * 0.14 + gust * 0.075;
      paint.globalAlpha = 0.76 + 0.1 * index;
      paintGardenLeaf(paint, leafX, leafY, angle, length, length * 0.25, shade);
    });

    paint.globalAlpha = 1;
    paint.save();
    paint.translate(tipX, tipY);
    paint.rotate(tilt + bend / rise * 0.68);
    paint.scale(1, pitch + flutter * 0.055);
    paint.globalAlpha = 0.95;
    const size = radius * 80 / 33;
    paint.drawImage(bloom, -size / 2, -size / 2, size, size);
    paint.restore();
  }
}
