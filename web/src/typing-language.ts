import { pinyin } from 'pinyin-pro';
import { toRomaji } from 'wanakana';

export type TypingLanguage = 'zh' | 'en' | 'ru' | 'fr' | 'ja';
export type LyricLine = { text: string; start: number; end?: number; credit?: boolean; words?: { t: string; s: number; e: number }[] | null };
export type TypingCue = {
  id: number; char: string; keys: string; start: number; end?: number; language?: TypingLanguage;
  sideways?: boolean; gap?: 'word' | 'line';
};
type JapaneseToken = { surface_form: string; reading?: string };
type JapaneseTokenizer = { tokenize(text: string): JapaneseToken[] };
let japanese: Promise<JapaneseTokenizer> | undefined;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const characters = (text: string) => Array.from(segmenter.segment(text.normalize('NFC')), part => part.segment);
const westernLetter = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Nd}]\p{Mark}*$/u;
const wordJoiner = /^['’\-‐‑]$/u;
const closingMark = /^["',.;:!?…»”’%)\]]$/u;
const openingMark = /^['"«“‘(\[]$/u;

function writingUnits(chars: string[], startsLine: boolean, western: boolean) {
  const units: { from: number; to: number; sideways: boolean; gap?: TypingCue['gap'] }[] = [];
  let gap: TypingCue['gap'] = startsLine ? 'line' : undefined;
  for (let i = 0; i < chars.length;) {
    if (/^\s+$/u.test(chars[i])) {
      if (units.length) gap = 'word';
      i++;
      continue;
    }
    const from = i;
    if (openingMark.test(chars[i]) && westernLetter.test(chars[i + 1] ?? '')) i++;
    const word = westernLetter.test(chars[i]);
    i++;
    if (word) {
      while (i < chars.length && (westernLetter.test(chars[i])
        || wordJoiner.test(chars[i]) && westernLetter.test(chars[i + 1] ?? ''))) i++;
      while (i < chars.length && closingMark.test(chars[i])) i++;
    }
    units.push({ from, to: i, sideways: word || western && closingMark.test(chars[from]), gap });
    gap = undefined;
  }
  return units;
}

export function detectLanguage(text: string, fallback: TypingLanguage = 'en'): TypingLanguage {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'ja';
  if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
  if (/\p{Script=Han}/u.test(text)) return fallback === 'ja' ? 'ja' : 'zh';
  if (/[àâçéèêëîïôœùûüÿæ]/iu.test(text)) return 'fr';
  if (/\b(?:bonjour|merci|toujours|amour|avec|pourquoi|nous|vous)\b/iu.test(text)) return 'fr';
  return fallback === 'fr' ? 'fr' : 'en';
}

export function keyboardRows(language: TypingLanguage): string[] {
  if (language === 'ru') return ['ЙЦУКЕНГШЩЗХЪ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮЁ,.?!'];
  if (language === 'fr') return ['AZERTYUIOPÉÈ', 'QSDFGHJKLMÇÀ', 'WXCVBNŒÊÙ,.?!'];
  return ['QWERTYUIOP?', 'ASDFGHJKL!', language === 'ja' ? 'ZXCVBNM,.文' : 'ZXCVBNM,.'];
}

export function typingKeys(char: string, language: TypingLanguage): string {
  const punctuation: Record<string, string> = { '，': ',', '、': ',', '。': '.', '；': '.', '：': '.', '！': '!', '？': '?', '…': '.', '’': "'", '‘': "'", '「': '"', '」': '"' };
  if (punctuation[char]) return punctuation[char];
  if (/^\s+$/u.test(char)) return '';
  if (language === 'ja' && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) return toRomaji(char).toUpperCase();
  const upper = char.toUpperCase();
  if (language === 'fr' && !keyboardRows('fr').join('').includes(upper)) {
    return upper.replace(/Æ/g, 'AE').normalize('NFD').replace(/\p{Mark}/gu, '');
  }
  return upper;
}

async function japaneseTokenizer() {
  if (!japanese) japanese = import('kuromoji/build/kuromoji.js').then(({ default: kuromoji }) =>
    new Promise<JapaneseTokenizer>((resolve, reject) => {
      kuromoji.builder({ dicPath: `${import.meta.env.BASE_URL}assets/japanese-dict/` }).build((error, tokenizer) => {
        if (error) reject(error); else resolve(tokenizer);
      });
    })).catch(error => { japanese = undefined; throw error; });
  return japanese;
}

function japaneseKeys(text: string, tokenizer: JapaneseTokenizer): string[] {
  const keys: string[] = [];
  for (const token of tokenizer.tokenize(text.normalize('NFC'))) {
    const surface = characters(token.surface_form);
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token.surface_form)) {
      keys.push(...surface.map(char => typingKeys(char, 'ja'))); continue;
    }
    const roman = toRomaji(token.reading || token.surface_form).toUpperCase();
    // Keep the word's actual reading intact while distributing its keystrokes over its timed glyphs.
    surface.forEach((char, i) => keys.push(roman.slice(Math.floor(i * roman.length / surface.length), Math.floor((i + 1) * roman.length / surface.length)) || typingKeys(char, 'ja')));
  }
  return keys;
}

export function makeTypingCues(lines: LyricLine[], duration: number, readings = new Map<string, string[]>()): TypingCue[] {
  const cues: TypingCue[] = [];
  const valid = lines.filter(line => !line.credit && line.text?.trim()).sort((a, b) => a.start - b.start);
  const language = detectLanguage(valid.map(line => line.text).join(''));
  for (let li = 0; li < valid.length; li++) {
    const line = valid[li], text = line.text.normalize('NFC'), chars = characters(text), locale = detectLanguage(text, language);
    const end = line.end && line.end > line.start ? line.end : valid[li + 1]?.start > line.start ? valid[li + 1].start : Math.max(line.start + 4000, duration);
    const chinese = locale === 'zh' ? pinyin(text, { type: 'all', toneType: 'none', v: true }) : [];
    const times = chars.map((_, i) => ({ s: line.start + (end - line.start) * i / chars.length, e: line.start + (end - line.start) * (i + 1) / chars.length }));
    let cursor = 0;
    for (const word of line.words || []) {
      const letters = characters(word.t), suffix = chars.slice(cursor).join('');
      const found = suffix.indexOf(word.t.normalize('NFC'));
      const at = found < 0 ? cursor : cursor + characters(suffix.slice(0, found)).length;
      for (let i = 0; i < letters.length && at + i < times.length; i++) {
        times[at + i] = { s: word.s + (word.e - word.s) * i / letters.length, e: word.s + (word.e - word.s) * (i + 1) / letters.length };
      }
      cursor = at + letters.length;
    }
    for (const unit of writingUnits(chars, li > 0, locale !== 'zh' && locale !== 'ja')) {
      const part = chars.slice(unit.from, unit.to), char = part.join('');
      const cueLanguage = unit.sideways ? detectLanguage(char, locale) : locale;
      const keys = part.map((glyph, offset) => {
        const i = unit.from + offset, reading = chinese[i];
        return locale === 'ja' && !unit.sideways ? readings.get(text)?.[i] ?? typingKeys(glyph, locale)
          : reading?.isZh ? reading.pinyin.toUpperCase() : typingKeys(glyph, cueLanguage);
      }).join('');
      const start = Math.max(0, times[unit.from].s), finish = times[unit.to - 1].e;
      cues.push({ id: cues.length, char, keys, start, end: Math.max(start, Math.min(end, finish)),
        language: cueLanguage, sideways: unit.sideways, gap: unit.gap });
    }
  }
  return cues;
}

export async function prepareTypingCues(lines: LyricLine[], duration: number): Promise<TypingCue[]> {
  const hint = detectLanguage(lines.map(line => line.text).join(''));
  const japaneseLines = lines.filter(line => detectLanguage(line.text, hint) === 'ja');
  if (!japaneseLines.length) return makeTypingCues(lines, duration);
  const tokenizer = await japaneseTokenizer(), readings = new Map<string, string[]>();
  for (const line of japaneseLines) readings.set(line.text.normalize('NFC'), japaneseKeys(line.text, tokenizer));
  return makeTypingCues(lines, duration, readings);
}

export const letterFont = (language: TypingLanguage = 'en') => language === 'ja'
  ? '42px "Yu Gothic", "Hiragino Sans", "Noto Sans JP", "LetterCN", serif'
  : language === 'zh' ? '42px "LetterCN", "KaiTi", "STKaiti", serif'
  : language === 'ru' ? '42px Georgia, "Times New Roman", "LetterCN", serif'
  : 'italic 42px Georgia, "Times New Roman", "LetterCN", serif';
