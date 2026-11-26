(() => {
  'use strict';

  const data = window.__SHARE_DATA__;
  if (!data) return;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const card = document.getElementById('share-card');
  if (data.layout) {
    if (data.layout.lineSize) card.style.setProperty('--line-size', data.layout.lineSize);
    if (data.layout.stanzaGap) card.style.setProperty('--stanza-gap', data.layout.stanzaGap);
    if (data.layout.blockGap) card.style.setProperty('--block-gap', data.layout.blockGap);
  }

  function resolveAudioUrl(src) {
    if (!src || !src.startsWith('data:')) return src || '';
    const comma = src.indexOf(',');
    if (comma < 0) return src;
    const header = src.slice(5, comma);
    const mime = header.split(';')[0] || 'audio/mpeg';
    const b64 = src.slice(comma + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }

  const audioUrl = resolveAudioUrl(data.audioSrc);
  const audio = new Audio(audioUrl);
  audio.preload = 'metadata';

  const timedEntries = [];
  const timelineStarts = [];
  let floatingEntry = null;

  function renderHero(container, title) {
    container.replaceChildren();
    const rowTop = el('div', 'hero-row hero-row--top');
    rowTop.append(el('span', 'hero-main', title.top.text));
    if (title.top.pinyin) rowTop.append(el('span', 'hero-pinyin', title.top.pinyin));
    const ruleShort = el('div', 'hero-rule hero-rule--short');
    const rowBottom = el('div', 'hero-row hero-row--bottom');
    if (title.bottom.pinyin) rowBottom.append(el('span', 'hero-pinyin', title.bottom.pinyin));
    rowBottom.append(el('span', 'hero-main hero-main--dark', title.bottom.text));
    const ruleDouble = el('div', 'hero-rule hero-rule--double');
    container.append(rowTop, ruleShort, rowBottom, ruleDouble);
  }

  function jumpToMs(ms) {
    if (!data.audioSrc) return;
    audio.currentTime = Math.max(0, ms / 1000);
    if (audio.paused) void audio.play().catch(() => {});
    syncHighlight(ms);
  }

  function renderLine(spec) {
    const p = el('p', 'line' + (spec.faved ? ' is-faved' : ''));
    if (spec.rot !== undefined) p.style.setProperty('--rot', `${spec.rot}deg`);
    if (spec.indent) p.style.setProperty('--indent', spec.indent);

    for (const token of spec.tokens) {
      if (typeof token === 'string') {
        p.append(document.createTextNode(token));
      } else if (token.kw && token.py && token.pos) {
        const stack = el('span', `kw-stack kw-stack--${token.pos}`);
        const kw = el('span', 'kw', token.kw);
        if (token.rot !== undefined) kw.style.setProperty('--krot', `${token.rot}deg`);
        const py = el('span', 'py', token.py);
        if (token.pos === 'above') stack.append(py, kw);
        else stack.append(kw, py);
        p.append(stack);
      } else if (token.kw) {
        const kw = el('span', 'kw', token.kw);
        if (token.rot !== undefined) kw.style.setProperty('--krot', `${token.rot}deg`);
        p.append(kw);
      } else if (token.py) {
        p.append(el('span', 'py', token.py));
      }
    }

    const spans = spec.spans || [];
    if (spans.length) {
      timedEntries.push({ node: p, spans });
      for (const [s] of spans) timelineStarts.push(s);
      p.addEventListener('click', () => {
        const nowMs = audio.currentTime * 1000;
        const nextSpan = spans.find(([s]) => s > nowMs + 500) || spans[0];
        jumpToMs(nextSpan[0]);
      });
    }
    return p;
  }

  function renderAll(spec) {
    timedEntries.length = 0;
    timelineStarts.length = 0;
    renderHero(document.getElementById('hero-title'), spec.title);
    document.getElementById('stanza-left-mid').replaceChildren(...spec.leftMid.map(renderLine));

    const leftBottom = document.getElementById('stanza-left-bottom');
    const linesWrap = el('div', 'stanza-lines');
    linesWrap.append(...spec.leftBottom.lines.map(renderLine));
    if (spec.leftBottom.floating && spec.leftBottom.floating.kw) {
      const floating = el('div', 'kw-float' + (spec.leftBottom.floating.faved ? ' is-faved' : ''));
      if (spec.leftBottom.floating.py) floating.append(el('span', 'py', spec.leftBottom.floating.py));
      floating.append(el('span', 'kw', spec.leftBottom.floating.kw));
      floatingEntry = { node: floating, spans: spec.leftBottom.floating.spans || [] };
      leftBottom.replaceChildren(linesWrap, floating);
    } else {
      floatingEntry = null;
      leftBottom.replaceChildren(linesWrap);
    }

    document.getElementById('stanza-right-top').replaceChildren(...spec.rightTop.map(renderLine));
    document.getElementById('stanza-right-mid').replaceChildren(...spec.rightMid.map(renderLine));
    document.getElementById('stanza-right-bottom').replaceChildren(...spec.rightBottom.map(renderLine));

    timelineStarts.sort((a, b) => a - b);
  }

  const playBtn = document.getElementById('btn-play');
  const loopBtn = document.getElementById('btn-loop');
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  const resetBtn = document.getElementById('btn-reset');
  const iconPause = playBtn?.querySelector('.icon-pause');
  const iconPlay = playBtn?.querySelector('.icon-play');
  const rail = document.getElementById('progress-rail');
  const fill = document.getElementById('progress-fill');
  const dot = document.getElementById('progress-dot');

  let activeNode = null;
  let rafId = 0;

  function inSpans(spans, ms) {
    return spans.some(([s, e]) => ms >= s && ms < e);
  }

  function syncHighlight(ms) {
    let hit = null;
    for (const entry of timedEntries) {
      if (inSpans(entry.spans, ms)) { hit = entry.node; break; }
    }
    if (hit !== activeNode) {
      activeNode?.classList.remove('is-active');
      activeNode = hit;
      activeNode?.classList.add('is-active');
    }
    if (floatingEntry) {
      floatingEntry.node.classList.toggle('is-active', inSpans(floatingEntry.spans, ms));
    }
  }

  function syncProgress() {
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const ratio = dur ? Math.max(0, Math.min(1, audio.currentTime / dur)) : 0;
    const pct = `${(ratio * 100).toFixed(2)}%`;
    if (dot) dot.style.left = pct;
    if (fill) fill.style.width = pct;
    syncHighlight(audio.currentTime * 1000);
  }

  function syncPlayUi() {
    const playing = !audio.paused && !audio.ended;
    playBtn?.setAttribute('aria-pressed', String(playing));
    if (iconPause) iconPause.style.display = playing ? '' : 'none';
    if (iconPlay) iconPlay.style.display = playing ? 'none' : '';
    cancelAnimationFrame(rafId);
    if (playing) {
      const loop = () => {
        syncProgress();
        if (!audio.paused && !audio.ended) rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    } else {
      syncProgress();
    }
  }

  playBtn?.addEventListener('click', () => {
    if (!data.audioSrc) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  });

  loopBtn?.addEventListener('click', () => {
    audio.loop = !audio.loop;
    loopBtn.setAttribute('aria-pressed', String(audio.loop));
  });

  prevBtn?.addEventListener('click', () => {
    const ms = audio.currentTime * 1000;
    let prev = 0;
    for (const s of timelineStarts) {
      if (s < ms - 1200) prev = s;
      else break;
    }
    jumpToMs(prev);
  });

  nextBtn?.addEventListener('click', () => {
    const ms = audio.currentTime * 1000;
    const next = timelineStarts.find(s => s > ms + 300);
    if (next !== undefined) jumpToMs(next);
  });

  resetBtn?.addEventListener('click', () => jumpToMs(0));

  rail?.addEventListener('click', event => {
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (!dur) return;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * dur;
    syncProgress();
  });

  document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      if (!data.audioSrc) return;
      if (audio.paused) void audio.play().catch(() => {});
      else audio.pause();
    }
  });

  audio.addEventListener('play', syncPlayUi);
  audio.addEventListener('pause', syncPlayUi);
  audio.addEventListener('ended', syncPlayUi);
  audio.addEventListener('loadedmetadata', syncProgress);
  audio.addEventListener('timeupdate', syncProgress);

  const canvas = document.getElementById('art-canvas');
  const redraw = () => window.LyricShareArt?.renderArt(canvas);

  renderAll(data);
  syncPlayUi();
  redraw();
  new ResizeObserver(redraw).observe(card);
})();
