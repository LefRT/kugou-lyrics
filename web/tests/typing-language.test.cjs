const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const base = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(base, 'src/typing-language.ts'), 'utf8')
  .replaceAll('import.meta.env.BASE_URL', JSON.stringify(path.join(base, 'public/').replaceAll('\\', '/') + '/'));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject, Intl, require: name => require(name === 'kuromoji/build/kuromoji.js' ? 'kuromoji' : name) });
const { makeTypingCues, prepareTypingCues, characters, keyboardRows, typingKeys } = exportsObject;

test('word-level timing preserves real silent gaps for the readout and threads', () => {
  const cues = makeTypingCues([{ text: '你好', start: 0, end: 5000, words: [{ t: '你', s: 0, e: 200 }, { t: '好', s: 1000, e: 1300 }] }], 5000);
  assert.equal(cues[0].start, 0); assert.equal(cues[0].end, 200);
  assert.equal(cues[1].start, 1000); assert.equal(cues[1].end, 1300);
  assert.equal(cues.map(cue => cue.keys).join(' '), 'NI HAO');
});

test('combined accents and emoji remain intact as individual printed glyphs', () => {
  const parts = characters('Cafe\u0301 👩‍🎤');
  assert.equal(parts.length, 6); assert.equal(parts[3], 'é'); assert.equal(parts[5], '👩‍🎤');
});

test('Russian text uses Cyrillic keystrokes and the Russian keyboard', () => {
  const cues = makeTypingCues([{ text: 'Привет, мир!', start: 0, end: 4000 }], 4000);
  assert(cues.every(cue => cue.language === 'ru'));
  assert.equal(cues.map(cue => cue.char).join('|'), 'Привет,|мир!');
  assert.equal(cues[0].keys, 'ПРИВЕТ,'); assert.equal(cues[1].keys, 'МИР!');
  assert(keyboardRows('ru').join('').includes('Ё'));
});

test('French keeps accented text, AZERTY keys, and ligatures', () => {
  const cues = makeTypingCues([{ text: 'Été à cœur', start: 0, end: 4000 }], 4000);
  assert(cues.every(cue => cue.language === 'fr'));
  assert.equal(cues.map(cue => cue.char).join('|'), 'Été|à|cœur');
  assert.equal(cues[1].gap, 'word');
  assert.equal(typingKeys('œ', 'fr'), 'Œ'); assert.equal(typingKeys('û', 'fr'), 'U');
  assert(keyboardRows('fr')[0].startsWith('AZERTY'));
  assert(makeTypingCues([{ text: 'Bonjour mon amour', start: 0, end: 4000 }], 4000).every(cue => cue.language === 'fr'));
});

test('Japanese kanji uses the bundled Japanese dictionary, including all-kanji lines', async () => {
  const cues = await prepareTypingCues([{ text: '今日は日本語を話します。', start: 0, end: 6000 }, { text: '世界', start: 7000, end: 9000 }], 10000);
  assert(cues.every(cue => cue.language === 'ja'));
  assert.equal(cues.slice(0, 2).map(cue => cue.keys).join(''), 'KYOU');
  assert.equal(cues.slice(3, 6).map(cue => cue.keys).join(''), 'NIHONGO');
  assert.equal(cues.slice(-2).map(cue => cue.keys).join(''), 'SEKAI');
  assert.equal(cues.map(cue => cue.char).join(''), '今日は日本語を話します。世界');
});

test('mixed punctuation and Japanese reading stay aligned with every printed glyph', async () => {
  const text = 'こんにちは、世界！';
  const cues = await prepareTypingCues([{ text, start: 0, end: 5000 }], 5000);
  assert.equal(cues.length, characters(text).length);
  assert.equal(cues.map(cue => cue.keys).join(''), 'KONNICHIHA,SEKAI!');
  assert(cues.every(cue => cue.end > cue.start));
});

test('word cues use the original timed bounds and distinguish spaces between words and lyric lines', () => {
  const cues = makeTypingCues([
    { text: '作词：某人', credit: true, start: 0, end: 500 },
    { text: 'Hello  world!', start: 600, end: 2700, words: [
      { t: 'Hello', s: 650, e: 1050 }, { t: 'world!', s: 1600, e: 2360 },
    ] },
    { text: 'New song', start: 2900, end: 4800 },
  ], 5000);
  assert.equal(cues.map(cue => cue.char).join('|'), 'Hello|world!|New|song');
  assert.equal(JSON.stringify(cues.map(({ gap }) => gap)), '[null,"word","line","word"]');
  assert.equal(cues[0].start, 650); assert.equal(cues[0].end, 1050);
  assert.equal(cues[1].start, 1600); assert.equal(cues[1].end, 2360);
  assert(cues.every(cue => cue.sideways));
});

test('apostrophes, hyphenated words and foreign words in Chinese lyrics stay together', () => {
  const cues = makeTypingCues([
    { text: "L’été, peut-être.", start: 0, end: 1400 },
    { text: 'Жить по-русски!', start: 1500, end: 2800 },
    { text: '是 Hello 夜', start: 2900, end: 4400 },
  ], 5000);
  assert.equal(cues.map(cue => cue.char).join('|'), 'L’été,|peut-être.|Жить|по-русски!|是|Hello|夜');
  assert.equal(cues[5].language, 'en');
  assert(!cues[4].sideways && !cues[6].sideways);
});
