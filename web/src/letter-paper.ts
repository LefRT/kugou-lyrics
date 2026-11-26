import { characters, letterFont, type TypingLanguage } from './typing-language';
export { makeTypingCues, prepareTypingCues } from './typing-language';
export type { LyricLine, TypingCue } from './typing-language';
import type { TypingCue } from './typing-language';
import { STAGE_STACKED_QUERY } from './stage-sky';

type Ink = { char: string; language: TypingLanguage; sideways: boolean; advance: number };
type Glyph = Ink & { gap?: TypingCue['gap']; x: number; y: number; attached: boolean; phase: number; release: number; printedAt: number; page: number };
type Particle = Ink & { x: number; y: number; vx: number; vy: number; rotation: number; spin: number; age: number; alpha: number; phase: number };
type Point = { x: number; y: number };
type Flow = { y: number; column: number; page: number };
type Placement = Pick<Glyph, 'x' | 'y' | 'advance' | 'page'>;
type SheetPosition = { x: number; y: number; angle: number; tilt: number; lift: number; depth: number };
type Sheet = { element: HTMLElement; context: CanvasRenderingContext2D; pose: DOMMatrixReadOnly; position: SheetPosition | null; glyphs: Glyph[]; dirty: boolean; animateUntil: number };
type SheetMotion = { sheet: Sheet; from: SheetPosition; to: SheetPosition; delay: number; duration: number; rise: number; tuckAway?: boolean };
type StackChange = 'place' | 'browse' | 'gather';
type Outro = 'waiting' | 'gathering' | 'clearing' | 'finished';
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const COLUMN_TOP = 78, LAST_COLUMN = 9;
const NAME_DURATION = .56, STAMP_DURATION = .28, SIGNATURE_DURATION = NAME_DURATION + STAMP_DURATION;
const FLAT_SHEET: SheetPosition = { x: 0, y: 0, angle: 0, tilt: 0, lift: 0, depth: 0 };
// From front to back: the active sheet, the left sheet, the right sheet and the sheet peeking out above.
const SHEET_POSES = [[-2.5, 1.2, -3.8], [-18, -1.6, -11], [17, -1.2, 10], [3, -8.4, 5.5]];

/** Vertical letter layout; falling dynamics are transplanted from letter-bloom/scene.js. */
export class LetterPaper {
  private ctx: CanvasRenderingContext2D;
  private glyphs: Glyph[] = [];
  private particles: Particle[] = [];
  private atlas = new Map<string, HTMLCanvasElement>();
  private advances = new Map<string, number>();
  private rect = new DOMRect();
  private scale = 1;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private bodyBottom = 1100;
  private sheets: Sheet[] = [];
  private cues: TypingCue[] = [];
  private placements: Placement[] = [];
  private printedLyrics = 0;
  private readingPage: number | null = null;
  private motions: SheetMotion[] = [];
  private motionAge = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private stackChanged = false;
  private heading: HTMLElement;
  private signoff: HTMLElement;
  private navigation: HTMLElement;
  private previousPage: HTMLButtonElement;
  private nextPage: HTMLButtonElement;
  private age = 0;
  private signatureAge: number | null = null;
  private outro: Outro | null = null;
  private fallAge = 0;
  private decorationDuration = 0;
  private seed = 221197;
  private observer: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private paper: HTMLElement) {
    this.ctx = canvas.getContext('2d')!;
    this.heading = paper.querySelector<HTMLElement>('.letter-song-title')!;
    this.signoff = paper.querySelector<HTMLElement>('.letter-signoff')!;
    this.navigation = paper.querySelector<HTMLElement>('.letter-page-nav')!;
    [this.previousPage, this.nextPage] = this.navigation.querySelectorAll('button');
    this.previousPage.onclick = () => this.browse(-1);
    this.nextPage.onclick = () => this.browse(1);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas); this.observer.observe(paper); this.resize();
    // 信纸字体是 webfont：加载完成后清掉字模缓存，落在纸上的字才不会用回退楷体
    void Promise.all([document.fonts.load(letterFont('zh'), '信纸'), document.fonts.load(letterFont('en'), 'Lyrics 0123'),
      document.fonts.load(letterFont('ru'), 'Привет')]).then(() => {
      this.atlas.clear();
      this.advances.clear();
      this.reflow();
    }).catch(() => {});
  }
  private random() { this.seed |= 0; this.seed = this.seed + 0x6D2B79F5 | 0; let n = Math.imul(this.seed ^ this.seed >>> 15, 1 | this.seed); n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n; return ((n ^ n >>> 14) >>> 0) / 4294967296; }
  private range(a: number, b: number) { return a + this.random() * (b - a); }
  private resize() {
    const rect = this.paper.getBoundingClientRect();
    const box = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (rect.x === this.rect.x && rect.y === this.rect.y && rect.width === this.rect.width && rect.height === this.rect.height
      && box.width === this.width && box.height === this.height && dpr === this.dpr) return;
    this.rect = rect; this.scale = this.rect.width / 900 || 1;
    this.width = box.width; this.height = box.height; this.dpr = dpr;
    this.canvas.width = Math.round(box.width * this.dpr); this.canvas.height = Math.round(box.height * this.dpr);
    this.bodyBottom = Math.max(COLUMN_TOP + 46, this.rect.height / this.scale - 72);
    this.reflow();
  }
  private get latestPage() { return this.sheets.length - 1; }
  private get viewedPage() { return this.readingPage ?? this.latestPage; }
  private browse(direction: number) {
    if (this.outro) return;
    const target = clamp(this.viewedPage + direction, 0, this.latestPage);
    this.readingPage = target === this.latestPage ? null : target;
    this.syncStack('browse');
  }
  private reflow(placements?: Placement[], placementAnimation = false) {
    if (this.outro === 'clearing' || this.outro === 'finished') {
      for (const sheet of this.sheets) sheet.dirty = true;
      this.syncStack();
      return;
    }
    const previousPage = this.latestPage;
    placements ??= this.planLayout();
    this.placements = placements;
    this.ensureSheet(0);
    for (const sheet of this.sheets) {
      sheet.glyphs = [];
      sheet.dirty = true;
      sheet.animateUntil = 0;
    }
    for (let i = 0; i < this.glyphs.length; i++) {
      const g = this.glyphs[i];
      Object.assign(g, placements[i]);
      const sheet = this.ensureSheet(g.page);
      sheet.glyphs.push(g);
      sheet.animateUntil = Math.max(sheet.animateUntil, g.printedAt + .075);
    }
    const last = this.glyphs.at(-1)?.page ?? 0;
    for (const sheet of this.sheets.splice(last + 1)) sheet.element.remove();
    if (this.readingPage !== null && this.readingPage >= last) this.readingPage = null;
    if (this.outro === 'gathering') this.syncStack('gather');
    else if (last !== previousPage || !this.motions.length) this.syncStack(placementAnimation && last !== previousPage ? 'place' : undefined);
    else this.syncSignature();
  }
  private planLayout(extra?: TypingCue) {
    const content = [...this.glyphs, ...(extra ? [extra] : []), ...this.cues.slice(this.printedLyrics)];
    const flow: Flow = { y: COLUMN_TOP, column: 1, page: 0 };
    const placements = content.map(cue => this.layout(cue, flow));
    const last = placements.at(-1);
    if (last && this.signoff.title && flow.column === LAST_COLUMN) {
      // A final sheet needs the left column for the signature. Carry the closing line
      // onto a fresh sheet, keeping the preceding lines in the previous left column.
      let first = placements.length - 1;
      while (placements[first - 1]?.page === last.page && placements[first - 1].x === last.x) first--;
      let split = first + 1;
      while (split < content.length && content[split].gap !== 'line') split++;
      if (split === content.length) split = first + Math.floor((content.length - first) / 2);
      const next: Flow = { y: COLUMN_TOP, column: 0, page: last.page + 1 };
      for (let i = split; i < content.length; i++) placements[i] = this.layout(content[i], next);
    }
    return placements;
  }
  private layout(g: Pick<TypingCue, 'char' | 'language' | 'sideways' | 'gap'>, flow: Flow) {
    let extent = 46;
    if (g.sideways) {
      const key = `${g.language}:${g.char}`;
      extent = this.advances.get(key) ?? 0;
      if (!extent) {
        this.ctx.font = letterFont(g.language);
        extent = this.ctx.measureText(g.char).width + 7;
        this.advances.set(key, extent);
      }
    }
    const advance = Math.min(Math.max(23, extent), this.bodyBottom - COLUMN_TOP);
    let gap = flow.y === COLUMN_TOP ? 0 : g.gap === 'line' ? 24 : g.gap === 'word' ? 11 : 0;
    if (flow.y + gap + advance > this.bodyBottom) {
      flow.y = COLUMN_TOP;
      if (++flow.column > LAST_COLUMN) { flow.column = 0; flow.page++; }
      gap = 0;
    }
    const x = 900 - 41 - (flow.column + .5) * 81.8;
    const y = flow.y + gap + advance / 2;
    flow.y += gap + advance;
    return { x, y, advance, page: flow.page };
  }
  private ensureSheet(page: number) {
    const existing = this.sheets[page];
    if (existing) return existing;
    const element = document.createElement('div');
    element.className = 'letter-sheet';
    element.dataset.page = String(page + 1);
    const rules = document.createElement('div');
    rules.className = 'letter-rules';
    rules.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'letter-sheet-ink';
    canvas.setAttribute('aria-hidden', 'true');
    element.append(rules, canvas);
    this.paper.insertBefore(element, this.navigation);
    const sheet: Sheet = { element, context: canvas.getContext('2d')!, pose: new DOMMatrix(), position: null, glyphs: [], dirty: true, animateUntil: 0 };
    this.sheets[page] = sheet;
    return sheet;
  }
  private syncSignature() {
    const sheet = this.sheets[this.placements.at(-1)?.page ?? 0];
    this.signoff.hidden = !sheet || this.signatureAge === null;
    if (sheet && this.signoff.parentElement !== sheet.element) sheet.element.append(this.signoff);
  }
  private sheetPosition(depth: number, compact: boolean): SheetPosition {
    if (this.sheets.length === 1) return FLAT_SHEET;
    if (this.outro && this.outro !== 'waiting') {
      const edge = clamp(this.rect.width * .011, 2, 4);
      return { ...FLAT_SHEET, x: (depth * .65 - 1) * edge, y: depth * edge, angle: compact ? -2.5 : -3, depth };
    }
    const [x, y, angle] = SHEET_POSES[depth];
    const { left, top, width, height } = this.rect;
    const turn = angle * (compact ? .76 : 1);
    const radians = Math.abs(turn) * Math.PI / 180;
    const midX = width / 2, midY = height / 2;
    const halfWidth = midX * Math.cos(radians) + midY * Math.sin(radians);
    const halfHeight = midY * Math.cos(radians) + midX * Math.sin(radians);
    const dx = clamp(width * x / 100 * (compact ? .81 : 1),
      12 + halfWidth - left - midX, this.width - 12 - halfWidth - left - midX);
    const dy = Math.max(height * y / 100 * (compact ? .5 : 1),
      (compact ? top - 13 : 14) + halfHeight - top - midY);
    return { ...FLAT_SHEET, x: dx, y: dy, angle: turn, depth };
  }
  private setSheetPosition(sheet: Sheet, position: SheetPosition) {
    const { x, y, angle, tilt, lift, depth } = position;
    const midX = this.rect.width / 2, midY = this.rect.height / 2;
    sheet.position = position;
    sheet.pose = new DOMMatrix().translate(midX + x, midY + y).rotate(angle)
      .skewX(-tilt * .4).scale(1, 1 - tilt * .009).translate(-midX, -midY);
    sheet.element.style.transform = sheet.pose.toString();
    sheet.element.style.setProperty('--sheet-lift', `${lift}px`);
    sheet.element.style.setProperty('--sheet-shade', `${depth * 26}%`);
  }
  private hideSheet(sheet: Sheet) {
    sheet.element.hidden = true;
    sheet.position = null;
    if (sheet.context.canvas.width) sheet.context.canvas.width = 0;
    sheet.dirty = true;
  }
  private syncStack(change?: StackChange) {
    const viewed = this.viewedPage;
    const visible = [viewed];
    for (let distance = 1; distance < this.sheets.length && visible.length < SHEET_POSES.length; distance++) {
      if (viewed - distance >= 0) visible.push(viewed - distance);
      if (viewed + distance <= this.latestPage && visible.length < SHEET_POSES.length) visible.push(viewed + distance);
    }
    const first = this.sheets[0].element;
    if (this.heading.parentElement !== first) first.append(this.heading);
    this.syncSignature();
    const compact = matchMedia(STAGE_STACKED_QUERY).matches;
    const animate = change && this.sheets.length > 1 && !this.reducedMotion.matches;
    this.motions = [];
    this.motionAge = 0;
    this.sheets.forEach((sheet, i) => {
      const { element } = sheet;
      const depth = visible.indexOf(i);
      element.setAttribute('aria-hidden', String(depth !== 0));
      if (depth < 0) {
        if (animate && sheet.position) {
          element.style.zIndex = '0';
          this.motions.push({ sheet, from: sheet.position, to: this.sheetPosition(0, compact), delay: 0, duration: .4, rise: 0, tuckAway: true });
        } else this.hideSheet(sheet);
        return;
      }
      element.hidden = false;
      element.style.zIndex = String(SHEET_POSES.length - depth);
      element.dataset.depth = String(depth);
      const to = this.sheetPosition(depth, compact);
      let from = sheet.position;
      if (animate && change === 'place' && !from) {
        from = { ...to, x: this.width - this.rect.left + this.rect.height * .19,
          y: to.y - Math.min(90, this.rect.height * .16), angle: to.angle + 14, tilt: 13, lift: 18 };
      }
      if (animate && from) {
        const duration = change === 'gather' ? .66 : change === 'place' ? (depth === 0 ? .6 : .46) : .36;
        const delay = change === 'gather' ? depth * .045 : change === 'place' && depth !== 0 ? .08 : 0;
        const rise = change === 'gather' ? 8 + depth * 1.5 : change === 'browse' && depth === 0 ? 7 : 0;
        this.motions.push({ sheet, from, to, delay, duration, rise });
      }
      this.setSheetPosition(sheet, animate && from ? from : to);
    });
    this.paper.toggleAttribute('data-stacked', this.sheets.length > 1);
    this.updateNavigation();
    this.notifyStackChange();
  }
  private updateNavigation() {
    this.navigation.hidden = this.sheets.length < 2;
    this.previousPage.disabled = Boolean(this.outro) || this.viewedPage === 0;
    this.nextPage.disabled = Boolean(this.outro) || this.viewedPage === this.latestPage;
    this.navigation.querySelector('span')!.textContent = `${this.viewedPage + 1} / ${this.sheets.length}`;
  }
  private notifyStackChange() {
    if (!this.stackChanged) {
      this.stackChanged = true;
      queueMicrotask(() => {
        this.stackChanged = false;
        this.paper.dispatchEvent(new Event('letterstackchange'));
      });
    }
  }
  private moveSheets(dt: number) {
    if (!this.motions.length) return;
    this.motionAge += dt;
    this.motions = this.motions.filter(({ sheet, from, to, delay, duration, rise, tuckAway }) => {
      const t = clamp((this.motionAge - delay) / duration);
      if (t === 0) return true;
      if (t === 1) {
        if (tuckAway) this.hideSheet(sheet);
        else this.setSheetPosition(sheet, to);
        return false;
      }
      const slide = rise ? t * t * (3 - 2 * t) : 1 - (1 - t) ** 3;
      const lift = Math.sin(Math.PI * t) * rise;
      this.setSheetPosition(sheet, {
        x: mix(from.x, to.x, slide), y: mix(from.y, to.y, slide) - lift,
        angle: mix(from.angle, to.angle, slide), tilt: mix(from.tilt, to.tilt, slide) + lift * .42,
        lift: mix(from.lift, to.lift, slide) + lift, depth: mix(from.depth, to.depth, slide),
      });
      return true;
    });
    if (!this.motions.length) this.notifyStackChange();
  }
  drawLandscapeCutout(matte: CanvasRenderingContext2D) {
    // The paper is opaque. Leave the scenery continuous while it is in motion.
    if (this.motions.length) return;
    for (const { element, pose } of this.sheets) {
      if (element.hidden) continue;
      matte.save();
      matte.translate(this.rect.left, this.rect.top);
      matte.transform(pose.a, pose.b, pose.c, pose.d, pose.e, pose.f);
      matte.fillRect(0, 0, this.rect.width, this.rect.height);
      matte.restore();
    }
  }
  private drawInk(c: CanvasRenderingContext2D, ink: Ink) {
    if (ink.sideways) c.rotate(Math.PI / 2);
    c.font = letterFont(ink.language);
    c.fillText(ink.char, 0, 0, ink.sideways ? ink.advance - 7 : 56);
  }
  private sprite(ink: Ink) {
    const key = `${ink.language}:${ink.sideways}:${ink.advance}:${ink.char}`;
    if (this.atlas.has(key)) return this.atlas.get(key)!;
    const sprite = document.createElement('canvas');
    sprite.width = 132; sprite.height = ink.sideways ? Math.ceil((ink.advance + 22) * 2) : 132;
    const c = sprite.getContext('2d')!;
    c.setTransform(2, 0, 0, 2, sprite.width / 2, sprite.height / 2);
    c.fillStyle = '#000'; c.textAlign = 'center'; c.textBaseline = 'middle';
    this.drawInk(c, ink);
    this.atlas.set(key, sprite); return sprite;
  }
  setTrack(title: string, artist: string, cues: TypingCue[]) {
    this.cues = cues;
    this.atlas.clear();
    this.advances.clear();
    const heading = this.heading;
    const nameText = title.trim().replace(/^《(.*)》$/u, '$1');
    const titleText = `《${nameText}》`;
    const song = document.createElement('span');
    song.textContent = nameText;
    song.classList.toggle('letter-sideways-name', !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nameText));
    heading.replaceChildren('《', song, '》');
    heading.title = titleText;
    heading.style.setProperty('--title-units', String(characters(titleText)
      .reduce((width, char) => width + (/\s/u.test(char) ? .35 : /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Nd}]$/u.test(char) ? .65 : 1), 0)));

    const signoff = this.signoff;
    const name = artist?.trim() || '';
    const signature = signoff.querySelector('.letter-byline')!;
    signature.textContent = name;
    signature.classList.toggle('letter-sideways-name', !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name));
    signoff.title = name;
    const seal = signoff.querySelector<HTMLElement>('.letter-seal')!;
    const glyphs = characters(name.replace(/\s+/gu, ''));
    const han = glyphs.length > 0 && glyphs.every(char => /\p{Script=Han}/u.test(char));
    seal.replaceChildren();
    seal.dataset.layout = han ? 'vertical' : 'horizontal';
    if (han) {
      const carved = glyphs.slice(0, 4), split = Math.ceil(carved.length / 2);
      for (const column of [carved.slice(0, split), carved.slice(split)].filter(parts => parts.length)) {
        const span = document.createElement('span'); span.textContent = column.join(''); seal.append(span);
      }
    } else {
      const words = name.split(/\s+/u);
      seal.textContent = glyphs.length <= 9 ? name
        : words.length > 1 ? words.slice(0, 4).map(word => characters(word)[0]).join('').toUpperCase() : glyphs.slice(0, 4).join('');
    }
    this.clear();
  }
  writeSignature(elapsed: number) {
    if (this.signatureAge !== null || !this.signoff.title) return;
    this.signatureAge = this.reducedMotion.matches ? SIGNATURE_DURATION : Math.min(elapsed, SIGNATURE_DURATION);
    this.paintSignature(this.signatureAge);
    this.syncSignature();
  }
  private paintSignature(age: number) {
    const written = clamp(age / NAME_DURATION);
    const stamp = clamp((age - NAME_DURATION) / STAMP_DURATION);
    const impact = clamp(stamp / .46);
    const scale = mix(1.42, .95, impact) + .05 * clamp((stamp - .46) / .54);
    const style = this.signoff.style;
    style.setProperty('--signature-cover', `${100 * (1 - written)}%`);
    style.setProperty('--stamp-opacity', String(clamp(stamp / .34)));
    style.setProperty('--stamp-scale', String(scale));
    style.setProperty('--stamp-offset', `${-9 * (1 - impact)}px`);
  }
  clear() {
    this.glyphs = []; this.particles = []; this.motions = [];
    this.readingPage = null; this.printedLyrics = 0;
    this.signatureAge = null; this.outro = null;
    this.paper.style.removeProperty('--decoration-opacity');
    this.reflow();
  }
  print(cue: TypingCue, animate = true): Point {
    const previousPage = this.latestPage;
    const manual = cue.id < 0;
    const placements = manual ? this.planLayout(cue) : this.placements;
    const g: Glyph = { char: cue.char, language: cue.language || 'en', sideways: Boolean(cue.sideways), gap: cue.gap,
      ...placements[this.glyphs.length], attached: true, phase: this.range(0, Math.PI * 2), release: Infinity, printedAt: animate ? this.age : -10 };
    this.glyphs.push(g);
    if (manual) this.reflow(placements, animate);
    else {
      this.printedLyrics++;
      const sheet = this.ensureSheet(g.page);
      sheet.glyphs.push(g);
      sheet.dirty = true;
      if (animate) sheet.animateUntil = this.age + .075;
      if (previousPage !== g.page) this.syncStack(animate ? 'place' : undefined);
    }
    return this.screenPoint(g);
  }
  private screenPoint(g: Glyph): Point {
    const point = this.sheets[g.page].pose.transformPoint({ x: g.x * this.scale, y: g.y * this.scale });
    return { x: this.rect.left + point.x, y: this.rect.top + point.y };
  }
  beginOutro() {
    this.outro = 'waiting';
    this.updateNavigation();
  }
  get isClearing() { return this.outro === 'clearing'; }
  get outroComplete() { return this.outro === 'finished'; }
  private beginClearing() {
    const front = this.sheets[this.viewedPage];
    const reduced = this.reducedMotion.matches;
    // The sheets below the top one are covered once the bundle is squared up.
    for (const sheet of this.sheets) {
      for (const g of sheet.glyphs) if (reduced || sheet !== front || !g.char.trim()) g.attached = false;
      sheet.dirty = true;
    }
    if (reduced) {
      this.paper.style.setProperty('--decoration-opacity', '0');
      this.outro = 'finished';
      return;
    }
    this.outro = 'clearing';
    this.fallAge = 0;
    this.decorationDuration = this.viewedPage === 0 || (!this.signoff.hidden && this.signoff.parentElement === front.element) ? 1.35 : 0;
    if (!this.decorationDuration) this.paper.style.setProperty('--decoration-opacity', '0');
    const ink = front.glyphs.filter(g => g.attached);
    if (!ink.length) return;
    const left = Math.min(...ink.map(g => g.x)), right = Math.max(...ink.map(g => g.x));
    const center = (left + right) / 2, radius = Math.max(82, (right - left) / 2);
    for (const g of ink) g.release = Math.abs(g.x - center) / radius * 2.7 + (this.bodyBottom - g.y) / 3500 + this.range(0, .22);
  }
  randomAttachedPoint(): Point | null {
    const candidates = this.sheets[this.viewedPage].glyphs.filter(g => g.attached);
    return candidates.length ? this.screenPoint(candidates[Math.floor(this.random() * candidates.length)]) : null;
  }
  stir(birds: { x: number; y: number; vx: number; vy: number }[]) {
    if (this.fallAge < .4) return;
    const reach = Math.max(13, this.rect.width * .039);
    for (const g of this.sheets[this.viewedPage].glyphs) {
      if (!g.attached) continue;
      const p = this.screenPoint(g);
      const bird = birds.find(b => (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < reach ** 2);
      if (bird) this.release(g, { x: clamp(bird.vx / this.scale * .45, -160, 160), y: clamp(bird.vy / this.scale * .35, -100, 100) });
    }
  }
  private release(g: Glyph, force: Point | null = null) {
    if (!g.attached) return;
    g.attached = false;
    this.sheets[g.page].dirty = true;
    const pose = this.sheets[g.page].pose;
    const point = pose.transformPoint({ x: g.x * this.scale, y: g.y * this.scale });
    const center = point.x / this.scale;
    // Original letter-bloom release velocities, spin, alpha and phase.
    this.particles.push({ char: g.char, language: g.language, sideways: g.sideways, advance: g.advance, x: center, y: point.y / this.scale,
      vx: force === null ? (449 - center) * .22 + this.range(-25, 25) : force.x,
      vy: force === null ? this.range(-8, 15) : force.y,
      rotation: Math.atan2(pose.b, pose.a) + this.range(-.22, .22), spin: this.range(-2.7, 2.7), age: 0, alpha: this.range(.82, 1), phase: g.phase });
  }
  private clearInk(dt: number) {
    this.fallAge += dt;
    if (this.fallAge - dt < this.decorationDuration) {
      const opacity = 1 - clamp((this.fallAge - .3) / (this.decorationDuration - .3));
      this.paper.style.setProperty('--decoration-opacity', String(opacity));
    }
    const ink = this.sheets[this.viewedPage].glyphs;
    for (const g of ink) if (g.attached && g.release <= this.fallAge) this.release(g);
    for (const p of this.particles) {
      // Keep the original fall; remove each glyph as its lower edge touches the floor.
      p.age += dt; p.vy = Math.min(560, p.vy + 415 * dt); p.vx += Math.sin(p.age * 2 + p.phase) * 4 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rotation += p.spin * dt;
      if (p.x < -100 || p.x > 1000) { p.x = clamp(p.x, -100, 1000); p.vx *= -.25; }
    }
    const floor = (this.height - 78 - this.rect.top) / this.scale;
    this.particles = this.particles.filter(p => p.y + 30 < floor);
    if (this.fallAge >= this.decorationDuration && !this.particles.length && !ink.some(g => g.attached)) this.outro = 'finished';
  }
  draw(dt: number, playing: boolean) {
    this.age += dt;
    if (playing || !this.outro) this.moveSheets(dt);
    if (playing) {
      if (this.signatureAge !== null && this.signatureAge < SIGNATURE_DURATION) {
        this.signatureAge = Math.min(this.signatureAge + dt, SIGNATURE_DURATION);
        this.paintSignature(this.signatureAge);
      }
      if (this.outro === 'waiting' && !this.motions.length && (this.signatureAge === null || this.signatureAge >= SIGNATURE_DURATION)) {
        this.outro = 'gathering';
        this.syncStack('gather');
      }
      if (this.outro === 'gathering' && !this.motions.length) this.beginClearing();
      if (this.outro === 'clearing') this.clearInk(dt);
    }
    for (const sheet of this.sheets) if (!sheet.element.hidden && (sheet.dirty || sheet.animateUntil > 0)) this.drawSheet(sheet);
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.rect.left, this.dpr * this.rect.top);
    for (const p of this.particles) {
      const sprite = this.sprite(p);
      c.save(); c.translate(p.x, p.y); c.rotate(p.rotation); c.globalAlpha = p.alpha;
      c.drawImage(sprite, -sprite.width / 4, -sprite.height / 4, sprite.width / 2, sprite.height / 2);
      c.restore();
    }
    c.globalAlpha = 1;
  }
  private drawSheet(sheet: Sheet) {
    const c = sheet.context;
    const width = Math.round(this.rect.width * this.dpr), height = Math.round(this.rect.height * this.dpr);
    if (c.canvas.width !== width) c.canvas.width = width;
    if (c.canvas.height !== height) c.canvas.height = height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, width, height);
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#000';
    for (const g of sheet.glyphs) {
      if (!g.attached) continue;
      c.save(); c.translate(g.x, g.y);
      c.globalAlpha = Math.min(1, .55 + (this.age - g.printedAt) * 6);
      this.drawInk(c, g); c.restore();
    }
    sheet.dirty = false;
    if (this.age >= sheet.animateUntil) sheet.animateUntil = 0;
  }
  destroy() { this.observer.disconnect(); this.atlas.clear(); }
}
