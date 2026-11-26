const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/wind-score.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function canvas(width = 0, height = 0) {
  const image = { width: 0, height: 0, frame: [], crops: [] };
  let current;
  const context = new Proxy({
    canvas: image,
    clearRect() { image.frame = []; },
    save() { current = {}; },
    restore() { image.frame.push(current); current = null; },
    translate(x, y) { if (current) Object.assign(current, { x, y }); },
    scale(value) { current.scale = value; },
    drawImage(source) {
      if (current) current.sprite = source;
      else image.crops.push(source);
    },
  }, {
    get(target, key) { return target[key] ?? (() => {}); },
    set(target, key, value) {
      if (current) current[key] = value;
      return Reflect.set(target, key, value);
    },
  });
  image.getContext = () => context;
  image.getBoundingClientRect = () => ({ width, height });
  return image;
}

function scene({ compact = false, random = () => .38 } = {}) {
  const sprites = [];
  const source = { naturalWidth: 1031 };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, devicePixelRatio: 2, Path2D: class {},
    document: { createElement() { const sprite = canvas(); sprites.push(sprite); return sprite; } },
  });
  const stageHeight = compact ? 844 : 965;
  const back = canvas(compact ? 390 : 945, compact ? 273 : stageHeight);
  const front = canvas(compact ? 390 : 945, compact ? 273 : stageHeight);
  const flight = new exports.StageFlight(back, front, source, random);
  flight.setLayout(compact ? { x: 94, y: 168, w: 48 } : { x: 59, y: 527, w: 182 }, stageHeight, compact);
  const advance = (seconds, night = false) => {
    for (let i = 0; i < Math.round(seconds * 20); i++) flight.draw(.05, night);
  };
  return { back, front, flight, source, sprites, stageHeight, advance };
}

test('one to three original balloons launch with staggered timing and front/back depth', () => {
  for (const [roll, count] of [[.12, 1], [.38, 2], [.93, 3]]) {
    // Choose the release size first and hold the other flight settings constant.
    let first = true;
    const { back, front, source, sprites, advance } = scene({ random: () => {
      if (!first) return .52;
      first = false;
      return roll;
    } });
    advance(.65);
    assert.equal(front.frame.length, 1);
    assert.equal(back.frame.length, 0);
    advance(1.2);
    const visible = [...front.frame, ...back.frame];
    assert.equal(visible.length, count);
    assert.equal(back.frame.length, count - 1);
    assert.equal(new Set(visible.map(item => item.sprite)).size, count);
    for (const sprite of sprites) assert.deepEqual(sprite.crops, [source]);
    assert(visible.every(item => item.lineWidth * item.scale >= 1.04));
  }
});

for (const compact of [false, true]) {
  test((compact ? 'mobile' : 'desktop') + ': constant size and fade at one sixth of the viewport', () => {
    const { front, stageHeight, advance } = scene({ compact });
    advance(1);
    const launch = front.frame[0];
    assert.equal(launch.globalAlpha, .96);
    let last = launch;
    let reachedFade = false;
    for (let i = 0; i < 240; i++) {
      advance(.05);
      const current = front.frame[0];
      if (!current || current.y > last.y) break;
      assert.equal(current.scale, launch.scale);
      if (current.y >= stageHeight / 6) assert.equal(current.globalAlpha, .96);
      else {
        reachedFade = true;
        assert(current.globalAlpha < last.globalAlpha);
      }
      last = current;
    }
    assert(reachedFade);
    assert(last.globalAlpha < .01);
    assert(last.y > 40);
    assert.equal(front.width, compact ? 780 : 1890);
  });

  test((compact ? 'mobile' : 'desktop') + ': varied paths stay left and the number of balloons is capped', () => {
    let seed = 591;
    const { front, back, advance } = scene({ compact, random: () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    } });
    const left = [], right = [];
    let maxCount = 0;
    for (let i = 0; i < 2400; i++) {
      advance(.05);
      const visible = [...front.frame, ...back.frame];
      maxCount = Math.max(maxCount, visible.length);
      for (const item of visible) {
        assert(item.x < (compact ? 274 : 804));
        if (item.globalAlpha > .7) (item.x < (compact ? 185 : 365) ? left : right).push(item.x);
      }
    }
    assert(maxCount >= 3 && maxCount <= (compact ? 4 : 5));
    assert(left.length > right.length && right.length > 0);
    assert(Math.max(...right) - Math.min(...left) > 140);
  });
}

test('balloon strings stay visible at night and flight resumes after a layout change', () => {
  const { flight, back, front, advance } = scene();
  advance(1, true);
  assert.equal(front.frame[0].strokeStyle, '#a0bfd1');
  flight.setLayout({ x: 95, y: 170, w: 48 }, 844, true);
  flight.draw(.05, true);
  assert.equal(front.frame.length + back.frame.length, 0);
  advance(1.25, true);
  assert.equal(front.frame.length + back.frame.length, 2);
});
