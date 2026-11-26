// 控制台通过 hash 路由切换页面。
// 与舞台共用黑白印刷视觉；数据来自 kg_web.py 的 JSON API。
import { createPixelSwitch, pixelSwitchMarkup } from './reference/pixel-switch';
import { createConstructionProgress } from './reference/construction-progress';
import { changeConsoleTheme, previewConsoleTheme } from './console-theme';
import { retryStreamSrc, songPlaybackError } from './song-playback';
import { mountMiziBackdrop } from './mizi-backdrop';
import { mountSearchBackdrop } from './search-backdrop';
import { mountSongsBackdrop } from './songs-backdrop';
import { makeStroke, seededRandom, strokeLines } from './ink-strokes';
import { readStageTheme } from './stage-theme';
import { mashupHref, songStageHref, songStreamSrc } from './demo';
import miziHeroSketch from './assets/mizi-hero-sketch.webp';

interface Stats {
  total: number;
}

interface SongRow {
  song_id: string;
  title: string;
  artist: string;
  duration_ms?: number | null;
  matches?: number;
}

interface PagedSongs {
  total: number;
  page: number;
  pages: number;
  items: SongRow[];
}

interface SemanticLyricResult extends SongRow {
  reason: string;
  evidence: { text: string; start_ms: number | null }[];
  clip: { start_ms: number; end_ms: number } | null;
}

interface SemanticLyricSearch {
  results: SemanticLyricResult[];
  mode: 'local' | 'literal';
  warnings: string[];
  constraints_pending: boolean;
}

interface Occurrence {
  start_ms: number | null;
  text: string;
  approx: boolean;
}

interface SongDetail extends SongRow {
  lyrics_text?: string | null;
  playlist?: string | null;
  timeline: {
    lines: {
      start: number; end: number; text: string; credit?: boolean;
    }[];
  } | null;
}

/** HTML 转义：文本节点和属性值都安全（含引号）。 */
const esc = (text: string) => String(text ?? '').replace(/[&<>"']/g, ch => (
  ch === '&' ? '&amp;'
    : ch === '<' ? '&lt;'
      : ch === '>' ? '&gt;'
        : ch === '"' ? '&quot;' : '&#39;'
));

/** 当前路由的渲染序号：异步请求回来时若已换页，旧结果直接丢弃。 */
let renderSeq = 0;
let routeScroll: number | undefined;
let displayedHash: string | undefined;

const restoreRouteScroll = () => {
  if (routeScroll === undefined) return;
  window.scrollTo(0, routeScroll);
  routeScroll = undefined;
};

/** 本文档内「往前跳」的次数：详情页的返回据此判断是否真有站内上一页可回。 */
let routeDepth = 0;
/** 每个 hash 离开时的滚动位置，返回时用来还原到当初点进去的位置。 */
const scrollMemo = new Map<string, number>();

const clock = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
};

const clockShort = (ms: number | null | undefined) => {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** 关键词高亮（大小写不敏感）：先按原文切分，再对每段转义，避免匹配到 HTML 实体。 */
const highlight = (text: string, kw: string) => {
  const raw = String(text ?? '');
  if (!kw) return esc(raw);
  const pattern = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return raw.split(pattern)
    .map((part, index) => (index % 2 === 1 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join('');
};

const footerHtml = () => `
  <footer class="footer" aria-hidden="true">
    <div class="fm-track">
      <span>SEEK SAFE SING</span><i></i><span>FIND YOUR WORD</span><i></i><span>CREATED BY LRight</span>
    </div>
  </footer>`;

// 导航上的全屏开关：一个正方形描边图标，进入全屏时方块略微变大，状态跟随浏览器事件
// 全屏：视频播放器通用的四角框（未全屏四角朝外、已全屏朝内）
const FS_SVG = '<svg class="fs-in" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3H3v7M14 3h7v7M10 21H3v-7M14 21h7v-7"/></svg>'
  + '<svg class="fs-out" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h7V3M21 10h-7V3M3 14h7v7M21 14h-7v7"/></svg>';

const navHtml = (active: string) => `
  <nav class="nav at-top" id="topnav">
    <a class="nav-brand" href="#/">歌词库</a>
    <div class="nav-links">
    <a href="#/" class="${active === 'home' ? 'active' : ''}">觅字</a>
    <a href="#/create" class="${active === 'create' ? 'active' : ''}">缀字</a>
    <a href="#/songs" class="${active === 'songs' ? 'active' : ''}">歌曲库</a>
    <a href="#/search" class="${active === 'search' ? 'active' : ''}">歌词检索</a>
    <a href="#/favorites"${active === 'favorites' ? ' class="active" aria-current="page"' : ''}>收藏收藏</a>
    </div>
    <span class="nav-spacer"></span>
    <span class="nav-tools">
      <button class="pixel-switch" id="theme-toggle" type="button" role="switch" aria-checked="false" aria-label="夜间模式" title="点击或左右拖动，切换日夜">
        ${pixelSwitchMarkup}
      </button>
      <button class="nav-fs" id="fullscreen-toggle" type="button" aria-pressed="false" aria-label="全屏" title="全屏 / 退出全屏（Esc）">${FS_SVG}</button>
    </span>
    <i class="scroll-progress" aria-hidden="true"></i>
  </nav>`;

// ---------------------------------------------------------------------------
// 装饰：歌名车流 / 聚光灯 / 磁吸按钮 / 撒花 / 滚动进度线

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// hero 背景歌名流：歌名取自两侧封面。
// 每条流速带重复两遍同样的序列做无缝循环，速度按实际长度换算，画面永不断流。

interface CoverPools { left: CoverGroup[]; right: CoverGroup[] }

/** 封面分组洗牌后分成左右两半（封面栏与歌名流共用同一份分组）。 */
const splitCoverPools = (groups: CoverGroup[]): CoverPools => {
  const shuffled = [...groups];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const half = Math.ceil(shuffled.length / 2);
  return { left: shuffled.slice(0, half), right: shuffled.slice(half) };
};

/** 一组封面 → 歌名池（去重；封面角标显示的也是这个 title）。 */
const namesOf = (pool: CoverGroup[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of pool) {
    const t = (g.items[0]?.title || '').trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
};

/** 一条流速带。vertical：竖排（往上/往下）；reverse：反向；speed：px/s。 */
const mountLane = (
  layer: HTMLElement,
  cls: string,
  sequence: string,
  opts: { vertical?: boolean; reverse?: boolean; speed: number },
) => {
  if (!sequence) return;
  const lane = document.createElement('div');
  lane.className = `nflow ${cls}${opts.vertical ? ' nflow-v' : ''}`;
  lane.setAttribute('aria-hidden', 'true');
  const track = document.createElement('div');
  track.className = 'nflow-track';
  if (opts.reverse) track.classList.add('rev');
  track.innerHTML = `<span>${sequence}</span><span>${sequence}</span>`;
  lane.appendChild(track);
  layer.appendChild(lane);
  // 字体渲染后量长度，换算成「像素/秒」恒定的时长
  const measure = () => {
    const span = track.firstElementChild as HTMLElement | null;
    if (!span) return;
    const size = opts.vertical ? span.offsetHeight : span.offsetWidth;
    if (size > 0) {
      track.style.animationDuration = `${(size / opts.speed).toFixed(1)}s`;
    }
  };
  measure();
  void document.fonts.ready.then(measure);
};

/** 觅字的两横两纵在四个交点交替从上方和下方穿过。 */
const mountNameFlow = (hero: HTMLElement, pools: CoverPools) => {
  hero.querySelectorAll('.nflow-layer').forEach(el => el.remove());
  const names = namesOf([...pools.left, ...pools.right]);
  if (!names.length) return;
  const layer = document.createElement('div');
  layer.className = 'nflow-layer mizi-flow';
  layer.setAttribute('aria-hidden', 'true');
  hero.insertBefore(layer, hero.firstChild);

  const lanes = [
    { cls: 'mizi-flow-east', reverse: true, speed: 39 },
    { cls: 'mizi-flow-north', vertical: true, speed: 29 },
    { cls: 'mizi-flow-west', speed: 34 },
    { cls: 'mizi-flow-south', vertical: true, reverse: true, speed: 31 },
  ];
  lanes.forEach((lane, index) => {
    const bucket = names.filter((_, i) => i % lanes.length === index);
    const titles = bucket.length ? bucket : names;
    // 两份等长车流首尾相接，小曲库也能填满一整条车道。
    const sequence = Array.from({ length: lane.vertical ? 16 : 32 }, (_, i) =>
      `<span class="mizi-flow-title">${esc(titles[i % titles.length])}</span><i class="mizi-flow-chevron"></i>`,
    ).join('');
    mountLane(layer, lane.cls, sequence, lane);
  });
};

/** 撒花：任务从进行中变为完成的那一刻庆祝一下。 */
const burstConfetti = (card: HTMLElement | null) => {
  if (!card || reducedMotion()) return;
  const colors = ['#e8250c', '#141312', '#8a5cf6', '#f2f0eb', '#ff5c47'];
  for (let i = 0; i < 30; i++) {
    const bit = document.createElement('i');
    bit.className = 'confetti';
    const angle = Math.random() * Math.PI - Math.PI / 2;
    const dist = 80 + Math.random() * 180;
    bit.style.setProperty('--cx', `${(Math.cos(angle) * dist * 1.4).toFixed(0)}px`);
    bit.style.setProperty('--cy', `${(-Math.sin(angle) * dist - 40).toFixed(0)}px`);
    bit.style.setProperty('--crot', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
    bit.style.setProperty('--cdur', `${(0.9 + Math.random() * 0.7).toFixed(2)}s`);
    bit.style.setProperty('--cdelay', `${Math.round(Math.random() * 150)}ms`);
    bit.style.left = `${(38 + Math.random() * 16).toFixed(0)}%`;
    bit.style.top = `${(38 + Math.random() * 10).toFixed(0)}%`;
    bit.style.background = colors[i % colors.length];
    card.appendChild(bit);
    window.setTimeout(() => bit.remove(), 2200);
  }
};

let scrollProgressBar: HTMLElement | null = null;
const updateScrollBar = () => {
  if (!scrollProgressBar) return;
  const { scrollHeight, clientHeight, scrollTop } = document.documentElement;
  const max = scrollHeight - clientHeight;
  scrollProgressBar.style.transform = `scaleX(${max > 0 ? Math.max(0, Math.min(1, scrollTop / max)) : 0})`;
  // 页面顶端时导航透明（两侧封面流穿到顶角），滚动后恢复底色
  scrollProgressBar.parentElement?.classList.toggle('at-top', scrollTop < 12);
};

/** 滚动事件每帧最多算一次布局，避免连续 scroll 强制同步重排。 */
let scrollBarRaf = 0;
const scheduleScrollBar = () => {
  if (scrollBarRaf) return;
  scrollBarRaf = requestAnimationFrame(() => {
    scrollBarRaf = 0;
    updateScrollBar();
  });
};

// ---------------------------------------------------------------------------
// 获奖站技巧层：mono 扰动解码 / 自定义光标 / 预载帘幕

const SCRAMBLE_POOL = '01<>_/#*+·:—';
/** hover 时文字逐位"解码"（Obys / Awwwards 站经典效果），结束恢复原文。 */
const scrambleText = (el: HTMLElement) => {
  if (reducedMotion()) return;
  const finalText = el.dataset.scramble ?? el.textContent ?? '';
  el.dataset.scramble = finalText;
  if (el.dataset.scrambling) return;
  el.dataset.scrambling = '1';
  const width = el.getBoundingClientRect().width;
  if (width > 0) el.style.minWidth = `${Math.ceil(width)}px`; // 扰动期间锁宽，避免布局抖动
  const start = performance.now();
  const duration = 380;
  const step = (now: number) => {
    if (!el.isConnected) return;
    const t = Math.min(1, (now - start) / duration);
    const reveal = Math.floor(t * finalText.length);
    let out = finalText.slice(0, reveal);
    for (let i = reveal; i < finalText.length; i++) {
      const ch = finalText[i];
      out += ch === ' ' ? ' ' : SCRAMBLE_POOL[(Math.random() * SCRAMBLE_POOL.length) | 0];
    }
    el.textContent = out;
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = finalText;
      delete el.dataset.scrambling;
      el.style.minWidth = '';
    }
  };
  requestAnimationFrame(step);
};

/** 预载帘幕：mono 计数 0000→0100，纸面揭走露出红幕再揭走（每个会话只放一次）。 */
const runPreloader = () => {
  try {
    if (reducedMotion() || sessionStorage.getItem('kg-preload')) return;
    sessionStorage.setItem('kg-preload', '1');
  } catch { return; }
  const pre = document.createElement('div');
  pre.className = 'preloader';
  pre.setAttribute('aria-hidden', 'true');
  pre.innerHTML = `
    <div class="pl-panel pl-red"></div>
    <div class="pl-panel pl-main">
      <b class="pl-count">0000</b>
      <span class="pl-tag">LYRIC.VAULT — LOADING</span>
    </div>`;
  document.body.appendChild(pre);
  const num = pre.querySelector<HTMLElement>('.pl-count')!;
  let value = 0;
  const tick = () => {
    if (!pre.isConnected) return;
    value = Math.min(100, value + 4 + Math.round(Math.random() * 9));
    num.textContent = String(value).padStart(4, '0');
    if (value < 100) window.setTimeout(tick, 24 + Math.random() * 52);
    else window.setTimeout(() => {
      pre.classList.add('done');
      window.setTimeout(() => pre.remove(), 1100);
    }, 140);
  };
  window.setTimeout(tick, 120);
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const postJson = async <T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};

interface MashupTask {
  id: string;
  word: string;
  status: 'running' | 'cancelling' | 'cancelled' | 'done' | 'error';
  created: string;
  total_songs: number;
  processed: number;
  segments: number;
  total_ms: number;
  meta_id: string | null;
  error: string | null;
  phase: 'selecting' | 'processing' | 'joining' | null;
  work_available: boolean;
  video_export?: VideoExport | null;
}

interface VideoExport {
  id?: string;
  status: 'running' | 'cancelling' | 'cancelled' | 'done' | 'error';
  progress: number;
  available?: boolean;
  error?: string;
}

const videoExportUrl = (mid: string, action = '') => `/api/mashup/video${action}?id=${encodeURIComponent(mid)}`;
const videoDownloadKey = 'kg-video-download';
let videoDownloadTimer = 0;
let videoDownloadRevision = 0;

function watchVideoDownload(mid: string, id: string) {
  const revision = ++videoDownloadRevision;
  window.clearTimeout(videoDownloadTimer);
  try { sessionStorage.setItem(videoDownloadKey, JSON.stringify({ mid, id })); } catch { /* storage is optional */ }
  const check = async () => {
    try {
      const response = await fetch(videoExportUrl(mid, '/status'), { cache: 'no-store' });
      if (revision !== videoDownloadRevision) return;
      if (response.status !== 404) {
        if (!response.ok) throw Error();
        const job = await response.json() as VideoExport;
        if (revision !== videoDownloadRevision) return;
        if (job.id === id && (job.status === 'running' || job.status === 'cancelling')) {
          videoDownloadTimer = window.setTimeout(check, 1800);
          return;
        }
        if (job.id === id && job.status === 'done' && job.available) {
          const download = document.createElement('a');
          download.href = videoExportUrl(mid);
          download.download = '';
          download.hidden = true;
          document.body.append(download);
          download.click();
          download.remove();
        }
      }
      try { sessionStorage.removeItem(videoDownloadKey); } catch { /* storage is optional */ }
    } catch {
      if (revision === videoDownloadRevision) videoDownloadTimer = window.setTimeout(check, 3500);
    }
  };
  videoDownloadTimer = window.setTimeout(check, 1200);
}

try {
  const pending = JSON.parse(sessionStorage.getItem(videoDownloadKey) ?? 'null');
  if (typeof pending?.mid === 'string' && typeof pending?.id === 'string') watchVideoDownload(pending.mid, pending.id);
} catch { /* storage is optional */ }

// ---------------------------------------------------------------------------
// 动效初始化：滚动渐入 + 数字滚动（Apple 官网式克制缓动）
const countUp = (el: HTMLElement) => {
  const target = parseFloat(el.dataset.count ?? '0');
  const decimals = parseInt(el.dataset.decimals ?? '0', 10);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toFixed(decimals);
    return;
  }
  const start = performance.now();
  const duration = 1200;
  const step = (now: number) => {
    if (!el.isConnected) return; // 已经换页，别再往旧节点写
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (target * eased).toFixed(decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

/** 每次路由渲染挂上的观察者/计时器，换页前统一释放，避免整棵旧 DOM 被 observer 吊住。 */
let fxCleanups: (() => void)[] = [];
const runFxCleanups = () => {
  for (const cleanup of fxCleanups) {
    try { cleanup(); } catch { /* 单项释放失败不影响其余 */ }
  }
  fxCleanups = [];
};

const commitConsolePage = (root: HTMLElement, markup: string) => {
  stopDetailAudio();
  runFxCleanups();
  cancelAnimationFrame(scrollBarRaf);
  scrollBarRaf = 0;
  root.innerHTML = markup;
  scrollProgressBar = root.querySelector<HTMLElement>('.scroll-progress');
  displayedHash = window.location.hash || '#/';
};

const bindPointerFrame = (element: HTMLElement, draw: (x: number, y: number, rect: DOMRect) => void, leave: () => void) => {
  let frame = 0;
  let x = 0, y = 0;
  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    x = event.clientX;
    y = event.clientY;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (element.isConnected) draw(x, y, element.getBoundingClientRect());
    });
  };
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    leave();
  };
  element.addEventListener('pointermove', move, { passive: true });
  element.addEventListener('pointerleave', reset);
  fxCleanups.push(() => {
    reset();
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerleave', reset);
  });
};

const initConsoleNav = (root: HTMLElement) => {
  // 主题切换：点击 = 0.4s 渐变提交；拖动 = 调色板实时跟随拖动进度
  const themeButton = root.querySelector<HTMLButtonElement>('#theme-toggle');
  if (themeButton) {
    const toggle = createPixelSwitch(themeButton, document.documentElement.dataset.theme === 'night', changeConsoleTheme, previewConsoleTheme);
    fxCleanups.push(() => toggle.destroy());
  }

  // 全屏开关：状态跟随浏览器全屏事件（Esc 退出时方块自动缩小同步）
  const fsButton = root.querySelector<HTMLButtonElement>('#fullscreen-toggle');
  if (fsButton) {
    const syncFsUi = () => {
      const on = !!document.fullscreenElement;
      fsButton.setAttribute('aria-pressed', String(on));
      fsButton.setAttribute('aria-label', on ? '退出全屏' : '全屏');
    };
    const toggleFs = () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen().catch(() => {});
    };
    fsButton.addEventListener('click', toggleFs);
    document.addEventListener('fullscreenchange', syncFsUi);
    fxCleanups.push(() => {
      fsButton.removeEventListener('click', toggleFs);
      document.removeEventListener('fullscreenchange', syncFsUi);
    });
    syncFsUi();
  }

  // 先应用当前页的滚动状态，再允许导航底色在用户滚动时过渡。
  updateScrollBar();
  // 每页沿用文档的动画时钟，避免返回有滚动进度的页面时渐变颜色跳回起点。
  const flow = scrollProgressBar?.getAnimations()[0];
  if (flow) flow.startTime = 0;
  scrollProgressBar?.parentElement?.classList.add('scroll-ready');

  // mono 文字扰动解码：导航链接悬停
  if (!reducedMotion()) {
    root.querySelectorAll<HTMLElement>('.nav-links a').forEach(a => {
      a.addEventListener('mouseenter', () => scrambleText(a));
    });
  }
};

const initConsoleFx = (root: HTMLElement, seq: number) => {
  if (seq !== renderSeq) return;
  // 页脚签名：统一追加到当前路由内容末尾
  root.querySelector('.footer')?.remove();
  root.insertAdjacentHTML('beforeend', footerHtml());
  restoreRouteScroll();

  // 两侧专辑封面流：挂在 #app 上铺满整页高度（covers 会话内取一次缓存）
  coversPromise ??= fetchJson<CoverGroup[]>('/api/covers').catch(() => [] as never[]);
  void coversPromise.then(groups => {
    if (seq !== renderSeq) return;
    const pools = splitCoverPools(groups);
    mountCoverRails(root, pools);
    const hero = root.querySelector<HTMLElement>('.hero');
    if (hero) mountNameFlow(hero, pools);
  });

  initConsoleNav(root);

  // 滚动渐入（含行列表的级联延迟）
  const reveals = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
  const belowFold = reveals.filter(el => el.getBoundingClientRect().top >= window.innerHeight);
  const deferred = new Set(belowFold);
  for (const el of reveals) {
    if (!deferred.has(el)) {
      el.classList.add('in', 'reveal-ready');
      continue;
    }
    const index = parseInt(el.dataset.stagger ?? '0', 10);
    el.style.transitionDelay = `${Math.min(index * 55, 400)}ms`;
  }
  if (belowFold.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0 });
    belowFold.forEach(el => io.observe(el));
    fxCleanups.push(() => io.disconnect());
  } else {
    belowFold.forEach(el => el.classList.add('in'));
  }

  // 数字滚动
  root.querySelectorAll<HTMLElement>('[data-count]').forEach(el => countUp(el));

  // 标题的变色句点：钉在两片渐变块中线延长线的交点

  if (!reducedMotion()) {
    // 磁吸按钮：轻微被光标"吸"过去
    root.querySelectorAll<HTMLElement>('.toolbar button').forEach(btn => {
      bindPointerFrame(btn, (x, y, rect) => {
        const dx = (x - rect.left) / rect.width - 0.5;
        const dy = (y - rect.top) / rect.height - 0.5;
        btn.style.transform = `translate(${(dx * 10).toFixed(1)}px, ${(dy * 7).toFixed(1)}px)`;
      }, () => { btn.style.transform = ''; });
    });

    // hero 光标坐标读数（ref2 的 X/Y 标注）
    const hero = root.querySelector<HTMLElement>('.hero');
    const coord = hero?.querySelector<HTMLElement>('.coord');
    if (hero && coord) {
      const label = coord.querySelector('b');
      bindPointerFrame(hero, (clientX, clientY, rect) => {
        const x = Math.round(clientX - rect.left);
        const y = Math.round(clientY - rect.top);
        coord.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        coord.classList.add('moved');
        if (label) label.textContent = `X:${x} Y:${y}`;
      }, () => { coord.classList.remove('moved'); });
    }
  }
};

// ---------------------------------------------------------------------------
// 首页：hero（飘词场随机轮换）+ 觅字作品（单击进舞台 / 长按右滑删除）+ 两侧封面流

interface CoverGroup { file: string; items: { song_id: string; title: string }[] }

let coversPromise: Promise<CoverGroup[]> | null = null;

/** 横竖窗棂共用一段回纹，渲染为可随主题着色的遮罩。 */
const coverLatticeMask = (vertical: boolean) => {
  const tile = document.createElement('canvas');
  const length = 48;
  const depth = 16;
  const scale = 3;
  tile.width = (vertical ? depth : length) * scale;
  tile.height = (vertical ? length : depth) * scale;
  const ink = tile.getContext('2d')!;
  ink.scale(scale, scale);
  if (vertical) {
    ink.translate(depth, 0);
    ink.rotate(Math.PI / 2);
  }
  ink.lineWidth = 1;
  ink.stroke(new Path2D([
    'M0 1.5H48 M0 14.5H48',
    'M0 8H4V4H17V12H8V7H13V9',
    'M17 8H24V12H37V4H28V9H33V7',
    'M37 8H41L44 5L47 8L44 11L41 8 M47 8H48',
  ].join(' ')));
  return `url("${tile.toDataURL()}")`;
};

/** 两侧封面流：左列向上、右列向下；栏体挂在 #app 上 absolute top/bottom:0，
 *  从导航顶角贯穿到页脚底角，整页高度自适应（页高变化由 ResizeObserver 感知），
 *  内容不够时按栏高补格（×2 拼成无缝循环）。 */
const mountCoverRails = (host: HTMLElement, pools: CoverPools) => {
  host.querySelectorAll('.cover-rail').forEach(el => el.remove());
  if (pools.left.length + pools.right.length < 6) return;
  const horizontalLattice = coverLatticeMask(false);
  const verticalLattice = coverLatticeMask(true);
  const observers: ResizeObserver[] = [];
  const build = (cls: string, dir: 'up' | 'down', pool: CoverGroup[]) => {
    const rail = document.createElement('div');
    rail.className = `cover-rail ${cls}`;
    rail.style.setProperty('--cr-lattice-horizontal', horizontalLattice);
    rail.style.setProperty('--cr-lattice-vertical', verticalLattice);
    const viewport = document.createElement('div');
    viewport.className = 'cr-window';
    const track = document.createElement('div');
    track.className = 'cr-track';
    track.dataset.dir = dir;
    viewport.appendChild(track);
    rail.appendChild(viewport);
    host.appendChild(rail);

    // 每条栏从池子里随机一个起点：进来第一眼看到的封面不必是列表第一张
    const offset = Math.floor(Math.random() * pool.length);
    const cellHtml = (index: number) => {
      const p = (index + offset) % pool.length;
      const g = pool[p];
      return `<div class="cr-cell">
        <button class="cov" type="button" data-i="${p}">
          <img src="/covers/${encodeURIComponent(g.file)}" alt="" draggable="false" loading="lazy">
          <span class="cov-name">${esc(g.items[0]?.title || '未知曲目')}</span>
        </button>
      </div>`;
    };
    const fill = () => {
      // 窄屏时栏体被 CSS 隐藏（宽度 0）：先不建，等 ResizeObserver 报出可见宽度再补
      const windowW = viewport.clientWidth;
      if (!windowW) return;
      const cellH = windowW + 28;  // 方形封面、标题和横档的估算
      const need = Math.max(5, Math.ceil(viewport.clientHeight / cellH) + 1);
      // 只按"铺满一屏"来放会永远循环那 5~9 张，看起来就像封面没换过；
      // 多排 24 张，循环一圈要滚好几分钟，正常浏览期间看不出重复。
      const cells = need + 24;
      if (cells !== Number(track.dataset.cells)) {
        track.dataset.cells = String(cells);
        const html = Array.from({ length: cells }, (_, i) => cellHtml(i)).join('');
        track.innerHTML = html + html;
      }
      const copyH = track.getBoundingClientRect().height / 2;
      track.style.setProperty('--rail-dur', `${Math.max(30, copyH / 26).toFixed(1)}s`);
    };
    fill();
    const observer = new ResizeObserver(fill);
    observer.observe(rail);
    observers.push(observer);

    track.addEventListener('click', event => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>('.cov');
      if (!btn) return;
      const g = pool[Number(btn.dataset.i) % pool.length];
      // 点封面：同图多首时随机挑一首；点歌名：就放这首
      const pick = event.target instanceof HTMLElement && event.target.classList.contains('cov-name')
        ? g.items[0]
        : g.items[Math.floor(Math.random() * g.items.length)];
      if (pick) window.location.href = `/?song=${encodeURIComponent(pick.song_id)}`;
    });
  };
  build('cr-left', 'up', pools.left);
  build('cr-right', 'down', pools.right);
  fxCleanups.push(() => observers.forEach(observer => observer.disconnect()));
};

/** 左滑删除手势（觅字作品 / 缀字记录共用）：按住左键向左滑过阈值，右端露出红色删除钮。 */
const WORK_SWIPE_OPEN = 68;
let swipeDocBound = false;
const closeSwipeDrawers = () => {
  document.querySelectorAll<HTMLElement>('[data-swipe].open').forEach(li => {
    li.classList.remove('open');
    const card = li.querySelector<HTMLElement>('[data-swipe-card]');
    if (card) { card.style.width = ''; card.style.transform = ''; }
  });
};
const bindSwipeAction = (
  host: ParentNode,
  onAction: (li: HTMLElement, btn: HTMLButtonElement) => void,
) => {
  const openDistance = WORK_SWIPE_OPEN;
  const threshold = openDistance * .5;
  host.querySelectorAll<HTMLElement>('[data-swipe]').forEach(li => {
    const card = li.querySelector<HTMLElement>('[data-swipe-card]');
    const action = li.querySelector<HTMLButtonElement>('[data-swipe-action]');
    if (!card || !action) return;
    let startX = 0, startY = 0, dx = 0;
    let dragging = false, startedOpen = false, suppressClick = false, pointerId = -1;

    card.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('.record-video')) return;
      startX = event.clientX; startY = event.clientY;
      dx = 0; dragging = false; suppressClick = false; pointerId = event.pointerId;
    });
    card.addEventListener('pointermove', event => {
      // buttons!==1 说明没按住；pointerId!==-1 且不符说明是别根手指
      if (event.buttons !== 1 || (pointerId !== -1 && pointerId !== event.pointerId)) return;
      if (pointerId === -1) {
        // 容错：个别环境拖拽起始的 pointerdown 会丢，按住移动时就地起算
        startX = event.clientX; startY = event.clientY;
        pointerId = event.pointerId;
      }
      const mx = event.clientX - startX;
      const my = event.clientY - startY;
      // 左滑唤出操作；打开状态下右滑收回。
      const wantOpen = !li.classList.contains('open');
      if (!dragging && Math.abs(mx) > 7 && Math.abs(mx) > Math.abs(my) * 1.4
        && ((wantOpen && mx < 0) || (!wantOpen && mx > 0))) {
        dragging = true;
        startedOpen = !wantOpen;
        card.classList.add('dragging');
        try { card.setPointerCapture(event.pointerId); } catch { /* 捕获失败不挡手势 */ }
        closeSwipeDrawers();
      }
      if (!dragging) return;
      // 卡片左移，给右侧操作按钮留出空间。
      let offset = Math.max(0, (startedOpen ? openDistance : 0) - mx);
      if (offset > openDistance) offset = openDistance + (offset - openDistance) * 0.35; // 越过打开位加阻尼
      dx = offset;
      // 左移 12% + 右缘回缩 88%，打开位正好露出删除钮并留 12px 缝
      card.style.width = `calc(100% - ${(offset * 0.88).toFixed(1)}px)`;
      card.style.transform = `translateX(${(-offset * 0.12).toFixed(1)}px)`;
    });
    const finish = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = -1;
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      card.classList.remove('dragging');
      card.style.width = '';
      card.style.transform = '';
      if (dx >= threshold) li.classList.add('open');
      else li.classList.remove('open');
      dx = 0;
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    // 拖过的这次 click 不算“进舞台”；普通点击顺手收起别的抽屉
    card.addEventListener('click', event => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      closeSwipeDrawers();
    });

    action.addEventListener('click', () => onAction(li, action));
  });

  if (!swipeDocBound) {
    swipeDocBound = true;
    document.addEventListener('pointerdown', event => {
      if (!(event.target as HTMLElement).closest('[data-swipe]')) closeSwipeDrawers();
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSwipeDrawers(); });
  }
};
const swipeButtonHtml = (word: string, action: 'delete' | 'cancel' = 'delete') => {
  const label = action === 'cancel' ? '取消' : '删除';
  return `<button class="mu-action" data-swipe-action="${action}" type="button" aria-label="${label}${word}">${label}</button>`;
};
/** 删作品后原地移除这一行并更新统计。 */
const removeWorkInPlace = (li: HTMLElement) => {
  const segs = Number(li.dataset.segs ?? 0);
  li.classList.add('gone');
  window.setTimeout(() => {
    // 420ms 内如果已经换页，这一行不再属于当前页面，什么也别碰
    if (!li.isConnected) return;
    const list = li.closest<HTMLElement>('.mashups');
    li.remove();
    const left = list ? list.querySelectorAll('.mu-item').length : 0;
    const page = list?.closest('.page');
    const works = page?.querySelector<HTMLElement>('[data-works]');
    if (works) works.textContent = String(left);
    const counter = page?.querySelector<HTMLElement>('.counter');
    if (counter) {
      const next = Math.max(0, (parseInt(counter.textContent ?? '0', 10) || 0) - segs);
      if (next > 0) counter.textContent = String(next).padStart(4, '0');
      else counter.remove();
    }
  }, 420);
};

const renderHome = async (root: HTMLElement, seq: number) => {
  const [stats, mashups] = await Promise.all([
    fetchJson<Stats>('/api/stats').catch(() => null),
    fetchJson<{ id: string; word: string; count: number; total_ms: number }[]>('/api/mashups').catch(() => [] as never[]),
  ]);
  if (seq !== renderSeq) return;
  const segTotal = mashups.reduce((sum, m) => sum + m.count, 0);
  commitConsolePage(root, `
    ${navHtml('home')}
    <div class="page">
      <div class="hero reveal">
        <div class="hero-artwork">
          <img src="${miziHeroSketch}" width="1080" height="379" alt="暖光和枫叶间的双马尾少女铅笔画" decoding="async" draggable="false">
        </div>
        <span class="anno anno-tl">LYRIC.VAULT — EST.2026</span>
        <span class="anno anno-tr">SEEK.SAFE<br>MS.PRECISION</span>
        ${segTotal > 0 ? `<span class="counter" aria-hidden="true">${String(segTotal).padStart(4, '0')}</span>` : ''}
        <span class="coord" aria-hidden="true"><i></i><b>X:0 Y:0</b></span>
        <h1>
          <span class="mask"><span class="rise">觅字</span></span>
        </h1>
        <p class="hero-meta rise" style="animation-delay:.22s">
          <b data-count="${stats ? stats.total : 0}">0</b> SONGS · <span data-works>${mashups.length}</span> WORKS
        </p>
      </div>

      <div class="mizi-works">
        <div class="mizi-backdrop" aria-hidden="true"><canvas></canvas></div>
        <ul class="mashups" role="list" style="--work-swipe-distance:${WORK_SWIPE_OPEN}px">
          ${mashups.map(m => `
            <li class="mu-item" data-mid="${esc(m.id)}" data-segs="${m.count}" data-swipe>
              <a class="mu-card" data-swipe-card draggable="false"
                 title="${esc(m.word)}" href="${esc(mashupHref(m.id))}">
                <span class="word">${esc(m.word)}</span>
                <span class="meta">${m.count} 段 · ${clockShort(m.total_ms)}</span>
              </a>
              ${swipeButtonHtml(esc(m.word))}
            </li>`).join('')}
        </ul>
      </div>
    </div>`);
  bindSwipeAction(root, (li, btn) => {
    void (async () => {
      const mid = li.dataset.mid ?? '';
      btn.disabled = true;
      btn.textContent = '删除中';
      const ok = await fetch(`/api/mashup?id=${encodeURIComponent(mid)}`, { method: 'DELETE' })
        .then(r => r.ok).catch(() => false);
      if (!li.isConnected) return;
      if (!ok) {
        btn.disabled = false;
        btn.textContent = '删除';
        return;
      }
      removeWorkInPlace(li);
    })();
  });
  initConsoleFx(root, seq);
  const backdrop = root.querySelector<HTMLElement>('.mizi-backdrop');
  const works = root.querySelector<HTMLUListElement>('.mashups');
  if (backdrop && works) fxCleanups.push(mountMiziBackdrop(backdrop, works));
};

// ---------------------------------------------------------------------------
// 分页：上一页 / 下一页 + 页码输入框（回车或失焦即跳转，不写说明文字）
const pagerHtml = (page: number, pages: number, link: (n: number) => string) => pages > 1 ? `
      <div class="pagination split">
        ${page > 1 ? `<a href="${link(page - 1)}">← 上一页</a>` : '<span>← 上一页</span>'}
        ${page < pages ? `<a href="${link(page + 1)}">下一页 →</a>` : '<span>下一页 →</span>'}
      </div>
      <form class="page-jump" data-pages="${pages}" data-current="${page}" novalidate>
        <input type="number" inputmode="numeric" min="1" max="${pages}" step="1" value="${page}" aria-label="页码">
        <span>/ ${pages}</span>
      </form>` : '';

const bindPager = (root: HTMLElement, link: (n: number) => string) => {
  const form = root.querySelector<HTMLFormElement>('.page-jump');
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('input');
  const pages = Number(form.dataset.pages ?? 1);
  const current = Number(form.dataset.current ?? 1);
  const jump = () => {
    const raw = input?.value.trim() ?? '';
    if (!raw) {                     // 清空后离开：退回当前页，不跳
      if (input) input.value = String(current);
      return;
    }
    const typed = Math.trunc(Number(raw));
    const n = Math.min(pages, Math.max(1, Number.isFinite(typed) ? typed : current));
    if (input) input.value = String(n);
    if (n !== current) window.location.hash = link(n);
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); jump(); });
  input?.addEventListener('blur', jump);
};

// ---------------------------------------------------------------------------
// 歌曲库
const renderSongs = async (root: HTMLElement, query: URLSearchParams, seq: number) => {
  const q = query.get('q') ?? '';
  const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1);
  const data = await fetchJson<PagedSongs>(
    `/api/songs?q=${encodeURIComponent(q)}&page=${page}`,
  ).catch(() => null);
  if (seq !== renderSeq) return;

  const pageLink = (n: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('page', String(n));
    return `#/songs?${params.toString()}`;
  };

  commitConsolePage(root, `
    ${navHtml('songs')}
    <div class="songs-backdrop" aria-hidden="true"><canvas></canvas></div>
    <div class="page songs-page">
      <form class="toolbar" id="song-filter">
        <input name="q" value="${esc(q)}" placeholder="找一个歌手/歌名..." autofocus>
      </form>
      ${data ? `
      <p class="hint">${data.total} 首 · 第 ${data.page} / ${data.pages} 页</p>
      ${data.items.length ? `
      <div class="rows reveal">
        ${data.items.map((song, index) => `
          <a class="row reveal" data-stagger="${Math.min(index, 12)}" href="#/song/${encodeURIComponent(song.song_id)}">
            <span class="row-title">${esc(song.title)}</span>
            <span class="row-artist">${esc(song.artist)}</span>
            <span class="row-dur">${clockShort(song.duration_ms)}</span>
          </a>`).join('')}
      </div>` : ''}
      ${pagerHtml(data.page, data.pages, pageLink)}` : '<p class="empty">加载失败，确认 kg_web.py 正在运行。</p>'}
    </div>`);

  const form = root.querySelector('#song-filter') as HTMLFormElement;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fd = new FormData(form);
    const params = new URLSearchParams();
    const newQ = String(fd.get('q') ?? '').trim();
    if (newQ) params.set('q', newQ);
    window.location.hash = `#/songs?${params.toString()}`;
  });
  bindPager(root, pageLink);
  initConsoleFx(root, seq);
  const backdrop = root.querySelector<HTMLElement>('.songs-backdrop');
  if (backdrop) fxCleanups.push(mountSongsBackdrop(backdrop));
};

// ---------------------------------------------------------------------------
// 歌词检索
let lyricSearchRequest: AbortController | undefined;
let lastSemanticSearch: { q: string; data: SemanticLyricSearch } | undefined;

const lyricSearchHash = (q: string, semantic = false, page = 1) => {
  const params = new URLSearchParams();
  if (semantic) params.set('mode', 'semantic');
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  return params.size ? `#/search?${params.toString()}` : '#/search';
};

const semanticResultsHtml = (data: SemanticLyricSearch) => `
  ${data.warnings.length ? `<p class="hint">本次使用索引中的原词匹配。 ${esc(data.warnings.join(' · '))}</p>` : ''}
  ${data.mode === 'literal' ? '<p class="hint">按歌词原句匹配</p>' : ''}
  ${data.constraints_pending && data.results.length ? '<p class="hint">以下为片段候选，未复核附加要求或整首歌的立场。</p>' : ''}
  ${!data.results.length ? '<p class="empty">没有找到匹配的歌词片段。</p>' : `
    <div class="rows reveal">
      ${data.results.map((song, index) => {
        const at = song.evidence.find(line => line.start_ms !== null)?.start_ms;
        const params = new URLSearchParams({ from: 'semantic' });
        if (at !== undefined && at !== null) params.set('at', String(at));
        return `
          <a class="row semantic-result reveal" data-stagger="${Math.min(index, 12)}"
             href="#/song/${encodeURIComponent(song.song_id)}?${params.toString()}">
            <div class="semantic-result-title">
              <span class="row-title">${esc(song.title)}</span>
              <span class="row-artist">${esc(song.artist)}</span>
              ${song.clip ? `<span class="row-dur">${clock(song.clip.start_ms)}–${clock(song.clip.end_ms)}</span>` : ''}
            </div>
            <blockquote>${song.evidence.map(line => `<span>${esc(line.text)}</span>`).join('')}</blockquote>
            <p>${esc(song.reason)}</p>
          </a>`;
      }).join('')}
    </div>`}`;

const renderSearch = async (root: HTMLElement, query: URLSearchParams, seq: number, refresh: () => void) => {
  const q = query.get('q') ?? '';
  const semantic = query.get('mode') === 'semantic';
  const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1);
  commitConsolePage(root, `
    ${navHtml('search')}
    <div class="search-backdrop" aria-hidden="true"><canvas></canvas></div>
    <div class="page search-page">
      <form class="toolbar" id="lyric-search">
        <input name="q" value="${esc(q)}" aria-label="歌词检索内容" autofocus>
        <select name="mode" aria-label="检索方式">
          <option value="keyword"${semantic ? '' : ' selected'}>关键词</option>
          <option value="semantic"${semantic ? ' selected' : ''}>语义搜索</option>
        </select>
        <button type="submit">检索</button>
      </form>
      <div id="search-result" aria-live="polite"></div>
    </div>`);
  if (routeScroll === 0) restoreRouteScroll();

  const form = root.querySelector('#lyric-search') as HTMLFormElement;
  const input = form.querySelector('input')!;
  const mode = form.querySelector('select')!;
  const updatePlaceholder = () => {
    input.placeholder = mode.value === 'semantic' ? '想听有人陪我舍不得，别劝我放下…' : '找一个词…';
  };
  updatePlaceholder();
  mode.addEventListener('change', updatePlaceholder);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const next = lyricSearchHash(input.value.trim(), mode.value === 'semantic');
    lastSemanticSearch = undefined;
    if (window.location.hash === next) refresh();
    else window.location.hash = next;
  });

  // 无论有没有关键词/是否检索成功，都要走到 initConsoleFx（导航主题钮/时钟/页脚依赖它）
  if (q) {
    const result = root.querySelector('#search-result')!;
    const request = new AbortController();
    lyricSearchRequest = request;
    result.innerHTML = '<p class="hint" role="status">正在检索…</p>';

    if (semantic) {
      try {
        const data = lastSemanticSearch?.q === q ? lastSemanticSearch.data
          : await postJson<SemanticLyricSearch>('/api/lyric/semantic', { q }, request.signal);
        if (seq !== renderSeq) return;
        lastSemanticSearch = { q, data };
        result.innerHTML = semanticResultsHtml(data);
      } catch (error) {
        if (seq !== renderSeq) return;
        const message = error instanceof Error ? error.message : '语义检索失败，请重试。';
        result.innerHTML = `<p class="empty">${esc(message)}</p>
          <a class="search-fallback" href="${esc(lyricSearchHash(q))}">使用关键词检索</a>`;
      }
    } else {
      const data = await fetchJson<PagedSongs>(
        `/api/lyric?q=${encodeURIComponent(q)}&page=${page}`, { signal: request.signal },
      ).catch(() => null);
      if (seq !== renderSeq) return;
      const pageLink = (n: number) => lyricSearchHash(q, false, n);
      result.innerHTML = data ? `
    ${data.total ? `<p class="hint">「${esc(q)}」· ${data.total} 首 · 第 ${data.page} / ${data.pages} 页</p>` : ''}
    ${data.items.length ? `
    <div class="rows reveal">
      ${data.items.map((song, index) => `
        <a class="row reveal" data-stagger="${Math.min(index, 12)}" href="#/song/${encodeURIComponent(song.song_id)}?kw=${encodeURIComponent(q)}">
          <span class="row-title">${esc(song.title)}</span>
          <span class="row-artist">${esc(song.artist)}</span>
          <span class="badge badge-count">× ${song.matches}</span>
        </a>`).join('')}
    </div>` : '<p class="empty">没有找到包含该关键词的歌词。</p>'}
    ${pagerHtml(data.page, data.pages, pageLink)}` : '<p class="empty">检索失败，确认 kg_web.py 正在运行。</p>';
      if (data) bindPager(root, pageLink);
    }
    lyricSearchRequest = undefined;
  }
  initConsoleFx(root, seq);
  const backdrop = root.querySelector<HTMLElement>('.search-backdrop');
  if (backdrop) fxCleanups.push(mountSearchBackdrop(backdrop));
};

// 几何图标（网站自有语言：方/三角/红点，描边 currentColor）
const PLAY_SVG = '<svg class="ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.5 L19.5 12 L7.5 19.5 Z"/></svg>';
const PAUSE_SVG = '<svg class="ic-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.4" height="15"/><rect x="13.6" y="4.5" width="4.4" height="15"/></svg>';
const LOOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 8.5 V5.5 H16.5 V18.5 H7.5 V15.5"/><path d="M4.6 8.5 L7.5 5.2 L10.4 8.5"/><circle class="f" cx="12" cy="12" r="1.8"/></svg>';
// 相机（进入舞台播放）：机身矩形 + 顶部梯形凸起 + 镜头圆，纯几何描边
const CAMERA_SVG = '<svg class="ic-camera" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7.5" width="18" height="12"/><path d="M8.4 7.5 L9.9 4.8 H14.1 L15.6 7.5"/><circle cx="12" cy="13.5" r="3.3"/></svg>';
// 收藏标记：横着的三角形（朝内，指向歌词文字一侧），由 CSS 上红色
const FAV_SVG = '<svg class="line-fav" viewBox="0 0 10 10" aria-hidden="true"><path d="M8.8 1 L1 5 L8.8 9 Z"/></svg>';

// 页内播放的音频：路由切换时必须停掉
let detailAudio: HTMLAudioElement | null = null;

// 歌词高亮：模块级状态，跟着 detailAudio 的 currentTime 走（不滚动页面）
let lyricRows: HTMLElement[] = [];
let lyricStarts: number[] = [];
let lyricActive = -1;
let lyricRaf = 0;

const paintLyric = (ms: number) => {
  let idx = -1;
  for (let i = 0; i < lyricStarts.length; i += 1) {
    if (lyricStarts[i] <= ms) idx = i; else break;
  }
  if (idx === lyricActive) return;
  if (lyricActive >= 0) lyricRows[lyricActive]?.classList.remove('active');
  if (idx >= 0) lyricRows[idx]?.classList.add('active');
  lyricActive = idx;
};

const loopLyric = () => {
  if (!detailAudio) { lyricRaf = 0; return; }
  paintLyric(detailAudio.currentTime * 1000);
  lyricRaf = requestAnimationFrame(loopLyric);
};

const startLyricLoop = () => {
  if (lyricRaf || !detailAudio) return;
  lyricRaf = requestAnimationFrame(loopLyric);
};

const stopDetailAudio = () => {
  if (lyricRaf) { cancelAnimationFrame(lyricRaf); lyricRaf = 0; }
  lyricRows = [];
  lyricStarts = [];
  lyricActive = -1;
  if (detailAudio) {
    const audio = detailAudio;
    detailAudio = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
};

// ---------------------------------------------------------------------------
// 歌曲详情
const renderSong = async (root: HTMLElement, songId: string, query: URLSearchParams, seq: number) => {
  const initialKw = query.get('kw') ?? '';
  const fromSemantic = query.get('from') === 'semantic';
  const anchor = query.get('at');
  const evidenceStart = fromSemantic && anchor ? Number(anchor) : null;
  let song: SongDetail | null = null;
  try {
    song = await fetchJson<SongDetail>(`/api/song?song_id=${encodeURIComponent(songId)}`);
  } catch { song = null; }
  if (seq !== renderSeq) return;
  if (!song) {
    commitConsolePage(root, `${navHtml('')}<div class="page"><p class="empty">找不到这首歌（${esc(songId)}）。</p></div>`);
    initConsoleFx(root, seq);
    return;
  }

  const lines = song.timeline?.lines ?? [];
  // 制作信息/角色/歌名行不算歌词（服务端已按最新规则补判 credit）
  const lyricLines = lines.filter(line => !line.credit);
  commitConsolePage(root, `
    ${navHtml(initialKw || fromSemantic ? 'search' : 'songs')}
    <div class="page">
      <header class="song-head reveal">
        <h1>${esc(song.title)}
          <button class="play-toggle" id="detail-play" aria-label="播放 / 暂停">
            ${PLAY_SVG}${PAUSE_SVG}
          </button>
          <button class="play-toggle" id="detail-stage" type="button" aria-label="进入舞台播放（单曲循环）" title="进入舞台播放（单曲循环）">
            ${CAMERA_SVG}
          </button>
          <span class="loop-badge" id="detail-loop" hidden>${LOOP_SVG}LOOP × 1</span>
        </h1>
        <p class="hint">
          <button class="back-link" id="detail-back" type="button">← 返回</button>
          <span>${esc(song.artist)}${song.duration_ms ? ` · ${clockShort(song.duration_ms)}` : ''}</span>
          <span class="play-hint" id="detail-play-hint" hidden></span>
        </p>
      </header>

      ${initialKw ? `
      <section class="reveal" data-stagger="1">
        <h2>关键词定位</h2>
        <div id="occ-result"></div>
      </section>` : ''}

      ${lyricLines.length ? `
      <section class="reveal" data-stagger="2">
        <h2>歌词</h2>
        <div class="lyrics reveal" data-stagger="3">
          ${lyricLines.map(line => `
            <p class="line${line.start === evidenceStart ? ' search-hit' : ''}" data-start="${line.start}">
              <span class="line-time">${clock(line.start)}</span>
              <button class="line-play" type="button" aria-label="从这句开始播放">${PLAY_SVG}</button>
              <span class="line-text">${esc(line.text)}</span>
              ${FAV_SVG}
            </p>`).join('')}
        </div>
      </section>` : ''}
    </div>`);
  initConsoleFx(root, seq);
  const evidenceRow = root.querySelector('.line.search-hit');
  if (evidenceRow) requestAnimationFrame(() => {
    if (seq === renderSeq) evidenceRow.scrollIntoView({ block: 'center' });
  });

  // 页内播放（单曲循环，不跳舞台）
  const playBtn = root.querySelector<HTMLButtonElement>('#detail-play')!;
  const loopBadge = root.querySelector<HTMLElement>('#detail-loop')!;
  const playHint = root.querySelector<HTMLElement>('#detail-play-hint')!;
  const syncPlayUi = () => {
    const playing = !!(detailAudio && !detailAudio.paused);
    playBtn.classList.toggle('playing', playing);
    playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    if (loopBadge) loopBadge.hidden = !playing;
    if (playing) startLyricLoop();
  };
  const flashHint = (text: string) => {
    playHint.textContent = text;
    playHint.hidden = false;
    window.setTimeout(() => { playHint.hidden = true; }, 3200);
  };
  let detailNeedsFreshSrc = false;
  let detailStallHint = 0;
  let detailStallRetry = 0;
  let detailStallRecoveries = 0;
  let detailLastTime = -1;
  const clearDetailStall = () => {
    if (detailStallHint) { window.clearTimeout(detailStallHint); detailStallHint = 0; }
    if (detailStallRetry) { window.clearTimeout(detailStallRetry); detailStallRetry = 0; }
    if (playHint.textContent === '正在缓冲音频…' || playHint.textContent === '缓冲较慢，正在重新连接…') {
      playHint.hidden = true;
    }
  };
  const ensureAudio = () => {
    if (detailAudio) return detailAudio;
    const baseSrc = songStreamSrc(songId);
    const audio = new Audio(detailNeedsFreshSrc ? retryStreamSrc(baseSrc) : baseSrc);
    detailNeedsFreshSrc = false;
    detailStallRecoveries = 0;
    detailLastTime = -1;
    audio.loop = true;  // 页内播放固定单曲循环
    const scheduleDetailStall = () => {
      if (detailAudio !== audio || audio.paused || audio.ended || audio.error || seq !== renderSeq) return;
      if (!baseSrc.startsWith('/api/song/stream?')) return;
      const stuckAt = audio.currentTime;
      if (!detailStallHint) {
        detailStallHint = window.setTimeout(() => {
          detailStallHint = 0;
          if (detailAudio === audio && !audio.paused && !audio.error && seq === renderSeq
              && Math.abs(audio.currentTime - stuckAt) < 0.2) {
            playHint.textContent = '正在缓冲音频…';
            playHint.hidden = false;
          }
        }, 1200);
      }
      if (!detailStallRetry && detailStallRecoveries < 2) {
        detailStallRetry = window.setTimeout(() => {
          detailStallRetry = 0;
          if (detailAudio !== audio || audio.paused || audio.ended || audio.error || seq !== renderSeq) return;
          if (Math.abs(audio.currentTime - stuckAt) >= 0.25) { clearDetailStall(); return; }
          detailStallRecoveries += 1;
          const resumeAt = audio.currentTime;
          playHint.textContent = '缓冲较慢，正在重新连接…';
          playHint.hidden = false;
          audio.addEventListener('loadedmetadata', () => {
            if (detailAudio !== audio || seq !== renderSeq) return;
            const limit = Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration - 0.5 : resumeAt;
            if (resumeAt > 0.5) audio.currentTime = Math.min(resumeAt, Math.max(0, limit));
            detailLastTime = -1;
            void audio.play().catch(() => { clearDetailStall(); });
          }, { once: true });
          audio.src = retryStreamSrc(baseSrc);
          audio.load();
        }, 7000);
      }
    };
    audio.addEventListener('playing', () => { clearDetailStall(); syncPlayUi(); });
    audio.addEventListener('pause', () => { clearDetailStall(); syncPlayUi(); });
    audio.addEventListener('waiting', scheduleDetailStall);
    audio.addEventListener('stalled', scheduleDetailStall);
    audio.addEventListener('error', async () => {
      if (detailAudio !== audio) return;
      clearDetailStall();
      detailAudio = null;
      detailNeedsFreshSrc = true;
      syncPlayUi();
      const message = await songPlaybackError(songId);
      if (!detailAudio && seq === renderSeq && playBtn.isConnected) flashHint(message);
    }, { once: true });
    // rAF 之外的兜底：标签页失焦时也能跟上时间轴
    audio.addEventListener('timeupdate', () => {
      paintLyric(audio.currentTime * 1000);
      if (!audio.paused && !audio.error) {
        if (detailLastTime >= 0 && audio.currentTime - detailLastTime > 0.15) {
          if (audio.currentTime - detailLastTime > 1) detailStallRecoveries = 0;
          clearDetailStall();
        }
        detailLastTime = audio.currentTime;
      }
    });
    detailAudio = audio;
    return audio;
  };
  const seekTo = (audio: HTMLAudioElement, sec: number) => {
    if (audio.readyState >= 1) { audio.currentTime = sec; return; }
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = sec; }, { once: true });
  };

  const startAudio = (audio: HTMLAudioElement) => {
    playHint.hidden = true;
    void audio.play().catch(error => {
      if (detailAudio === audio && error.name === 'NotAllowedError') {
        flashHint('浏览器阻止了播放，请再点一次播放键。');
      }
    });
  };
  playBtn.addEventListener('click', () => {
    const audio = ensureAudio();
    if (audio.paused) startAudio(audio);
    else audio.pause();
    syncPlayUi();
  });

  // 相机按钮：进舞台播放。单曲进舞台时 playMode 默认就是「单曲循环」
  root.querySelector('#detail-stage')?.addEventListener('click', () => {
    window.location.href = songStageHref(songId);
  });

  // 歌词交互：唱到哪句哪句变红（不滚动页面）· 单击整行收藏 · 空白处小钮从该句起播
  lyricRows = Array.from(root.querySelectorAll<HTMLElement>('.lyrics .line'));
  lyricStarts = lyricRows.map(el => Number(el.dataset.start ?? 0));
  lyricActive = -1;

  const FAV_KEY = 'kg-fav-lines';
  type FavMap = Record<string, number[]>;
  const readFav = (): FavMap => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}') as FavMap; }
    catch { return {}; }
  };
  const favMap = readFav();
  const favs = new Set<number>(favMap[songId] ?? []);
  const paintFav = () => {
    lyricRows.forEach(el => el.classList.toggle('faved', favs.has(Number(el.dataset.start ?? -1))));
  };
  const saveFav = () => {
    const next = [...favs].sort((a, b) => a - b);
    if (next.length) favMap[songId] = next;
    else delete favMap[songId];
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favMap)); } catch { /* 隐私模式写不进去就只保留在内存 */ }
  };
  paintFav();

  root.querySelector<HTMLElement>('.lyrics')?.addEventListener('click', (event) => {
    const target = event.target as Element;
    const row = target.closest<HTMLElement>('.line');
    if (!row) return;
    const startMs = Number(row.dataset.start ?? -1);
    if (startMs < 0) return;
    // 时间与歌词之间的空白处：小播放钮，从这句起播（不收藏）
    if (target.closest('.line-play')) {
      event.preventDefault();
      const audio = ensureAudio();
      seekTo(audio, startMs / 1000);
      paintLyric(startMs);
      startAudio(audio);
      syncPlayUi();
      return;
    }
    if (favs.has(startMs)) favs.delete(startMs);
    else favs.add(startMs);
    row.classList.toggle('faved', favs.has(startMs));
    saveFav();
  });

  // 返回：站内点进来的就回上一条历史（分页、滚动位置一起回来）；直接打开详情页则回列表
  root.querySelector('#detail-back')?.addEventListener('click', () => {
    if (routeDepth > 0) {
      window.history.back();
      return;
    }
    window.location.hash = initialKw
      ? lyricSearchHash(initialKw)
      : fromSemantic ? lyricSearchHash('', true) : '#/songs';
  });

  const renderOccurrences = (kw: string, box: HTMLElement) => {
    if (!kw) return;
    void (async () => {
      const data = await fetchJson<{ occurrences: Occurrence[]; count: number }>(
        `/api/occ?song_id=${encodeURIComponent(songId)}&kw=${encodeURIComponent(kw)}`,
      ).catch(() => null);
      if (!box.isConnected) return;
      if (!data) {
        box.innerHTML = '<p class="empty">定位失败。</p>';
        return;
      }
      const duration = song?.duration_ms
        || Math.max(0, ...(song?.timeline?.lines ?? []).map(line => line.end ?? 0))
        || 0;
      box.innerHTML = data.count > 0 ? `
        <p class="hint">「${esc(kw)}」· ${data.count} 次</p>
        ${duration ? `
        <div class="tl-bar fade-in">
          ${data.occurrences.map((occ, index) => `
            <span class="tl-dot ${occ.approx ? 'approx' : ''}"
              style="left:${Math.min(100, ((occ.start_ms ?? 0) / duration) * 100).toFixed(2)}%; animation-delay:${Math.min(index * 80, 640)}ms"
              title="${clock(occ.start_ms)}"></span>`).join('')}
        </div>` : ''}
        <div class="occ-list fade-in">
          ${data.occurrences.map(occ => `
            <p class="occ">
              <b class="occ-time">${clock(occ.start_ms)}${occ.approx ? '<i>≈</i>' : ''}</b>
              <span>${highlight(occ.text, kw)}</span>
            </p>`).join('')}
        </div>` : '';
    })();
  };

  const box = root.querySelector('#occ-result') as HTMLElement | null;
  if (initialKw && box) renderOccurrences(initialKw, box);
};

// ---------------------------------------------------------------------------
// 缀字：输入词 → 选歌弹窗（浏览/删除/添加/拖拽排序）→ 后台任务
// 制作中只在「制作记录」里占一行（待制作 + 进度条），完成后点词进舞台
let createPoll = 0;
const stopCreatePoll = () => { if (createPoll) { clearInterval(createPoll); createPoll = 0; } };

interface PreviewSong {
  song_id: string;
  title: string;
  artist: string;
  occurrences: number;
}

/** 「同一个人唱的同一首歌」的归并键：曲库里同名同歌手常有多个版本（song_id 不同）。 */
const songKey = (s: { title: string; artist: string }) => `${s.title.trim()}||${s.artist.trim()}`;

/** 候选去重：同人同曲只留一条（出现次数多者优先，位置不乱）；异人同名保留，由列表标红。 */
const dedupeSongs = (list: PreviewSong[]) => {
  const best = new Map<string, { song: PreviewSong; index: number }>();
  list.forEach((song, index) => {
    const key = songKey(song);
    const cur = best.get(key);
    if (!cur || song.occurrences > cur.song.occurrences) {
      best.set(key, { song, index: cur?.index ?? index });
    }
  });
  return [...best.values()]
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.song);
};

let activeModalClose: (() => void) | null = null;
const closeActiveModal = () => {
  const close = activeModalClose;
  activeModalClose = null;
  close?.();
};

const openMakeModal = (host: HTMLElement, word: string, onStarted: () => void) => {
  closeActiveModal(); // 同一时间只开一个；先把上一个的 keydown/计时器释放掉
  host.querySelector('.mmask')?.remove();
  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const mask = document.createElement('div');
  mask.className = 'mmask';
  mask.innerHTML = `
    <div class="mmodal" role="dialog" aria-modal="true" aria-label="挑选要制作的歌曲">
      <header class="mm-head">
        <span class="mm-word">「${esc(word)}」</span>
        <span class="mm-count" data-count></span>
        <button type="button" class="mm-close" data-close aria-label="关闭">×</button>
      </header>
      <div class="mm-list" data-list></div>
      <div class="mm-add">
        <input data-add maxlength="40" placeholder="没找到想要的？搜索曲库手动添加…" autocomplete="off">
        <div class="mm-drop" data-drop hidden></div>
      </div>
      <footer class="mm-foot">
        <span class="mm-err" data-err></span>
        <span class="mm-acts">
          <button type="button" class="mm-cancel" data-close>取消</button>
          <button type="button" class="mm-go" data-go disabled>开始制作</button>
        </span>
      </footer>
    </div>`;
  host.appendChild(mask);

  const listEl = mask.querySelector('[data-list]') as HTMLElement;
  const countEl = mask.querySelector('[data-count]') as HTMLElement;
  const errEl = mask.querySelector('[data-err]') as HTMLElement;
  const goBtn = mask.querySelector('[data-go]') as HTMLButtonElement;
  const addInput = mask.querySelector('[data-add]') as HTMLInputElement;
  const dropEl = mask.querySelector('[data-drop]') as HTMLElement;

  let songs: PreviewSong[] = [];
  let dragSid: string | null = null;
  let addTimer = 0;
  let closed = false;
  // 点歌名后台试听制作时会选中的片段；同一时间只有一首在响
  let clipAudio: HTMLAudioElement | null = null;
  let clipFade = 0;
  let playingSid: string | null = null;

  // 双 rAF 保证可见时有过渡；定时器兜底，窗口被遮挡 rAF 冻结时也能正常显示
  let opened = false;
  const openModal = () => {
    if (opened || closed) return;
    opened = true;
    mask.classList.add('mopen');
    addInput.focus();
  };
  requestAnimationFrame(() => requestAnimationFrame(openModal));
  window.setTimeout(openModal, 80);

  const say = (msg: string) => { errEl.textContent = msg; };
  const syncFoot = () => {
    countEl.textContent = songs.length ? `已选 ${songs.length} 首` : '待添加';
    goBtn.disabled = songs.length === 0;
    goBtn.textContent = songs.length ? `开始制作 · ${songs.length} 首` : '开始制作';
  };
  const renderList = () => {
    syncFoot();
    // 重渲染会重置滚动：删掉一首同名歌时，另一首还在原位置，别让用户误以为也被删了
    const keepScroll = listEl.scrollTop;
    if (!songs.length) {
      listEl.innerHTML = '';
      return;
    }
    // 与列表里其他歌手版本同名的歌名：不去重，但标红提醒（同名歌 / 翻唱）
    const byTitle = new Map<string, Set<string>>();
    for (const s of songs) {
      const title = s.title.trim();
      const artists = byTitle.get(title) ?? new Set<string>();
      artists.add(s.artist.trim());
      byTitle.set(title, artists);
    }
    const dupTitles = new Set(
      [...byTitle].filter(([, artists]) => artists.size > 1).map(([title]) => title));
    listEl.innerHTML = songs.map((s, i) => `
      <div class="mrow${s.song_id === playingSid ? ' mrow-playing' : ''}" draggable="true" data-sid="${esc(s.song_id)}">
        <span class="mrow-grip" aria-hidden="true">⋮⋮</span>
        <span class="mrow-idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="mrow-name" title="点击试听选中的片段"><b${dupTitles.has(s.title.trim()) ? ' class="dup"' : ''}>${esc(s.title)}</b><i>${esc(s.artist)}</i></span>
        <span class="mrow-occ">${s.occurrences} 处</span>
        <button type="button" class="mrow-del" data-del="${esc(s.song_id)}" aria-label="移除">×</button>
      </div>`).join('');
    listEl.scrollTop = keepScroll;
  };

  /** 停掉试听音频并清掉行上的播放标记。 */
  const stopClip = () => {
    if (clipFade) { clearInterval(clipFade); clipFade = 0; }
    if (clipAudio) {
      clipAudio.pause();
      clipAudio.removeAttribute('src');
      clipAudio = null;
    }
    playingSid = null;
    listEl.querySelectorAll('.mrow-playing').forEach(el => el.classList.remove('mrow-playing'));
  };

  const playClip = (sid: string, row: HTMLElement) => {
    if (playingSid === sid) { stopClip(); return; }
    stopClip();
    void (async () => {
      const clip = await fetchJson<{ start_ms: number; end_ms: number }>(
        `/api/mashup/songclip?word=${encodeURIComponent(word)}&song_id=${encodeURIComponent(sid)}`,
      ).catch(() => null);
      if (closed) return;
      if (!clip || typeof clip.start_ms !== 'number') { say('这首歌没有可试听的片段。'); return; }
      const audio = new Audio(songStreamSrc(sid));
      clipAudio = audio;
      playingSid = sid;
      row.classList.add('mrow-playing');
      audio.addEventListener('loadedmetadata', () => {
        if (clipAudio !== audio) return;
        audio.currentTime = clip.start_ms / 1000;
        // 起播缓冲 2 秒：音量从 0 渐升，不一下子响起
        audio.volume = 0;
        void audio.play().catch(error => {
          if (clipAudio === audio && error.name === 'NotAllowedError') {
            say('浏览器阻止了试听，请再点一次歌名。');
            stopClip();
          }
        });
        const t0 = performance.now();
        clipFade = window.setInterval(() => {
          const t = Math.min(1, (performance.now() - t0) / 2000);
          audio.volume = t;
          if (t >= 1) { clearInterval(clipFade); clipFade = 0; }
        }, 60);
      }, { once: true });
      audio.addEventListener('timeupdate', () => {
        if (clipAudio === audio && audio.currentTime * 1000 >= clip.end_ms) stopClip();
      });
      audio.addEventListener('ended', () => { if (clipAudio === audio) stopClip(); });
      audio.addEventListener('error', async () => {
        if (clipAudio !== audio) return;
        const message = await songPlaybackError(sid);
        if (clipAudio === audio) { say(message); stopClip(); }
      }, { once: true });
    })();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    stopClip();
    if (activeModalClose === close) activeModalClose = null;
    window.clearTimeout(addTimer);
    document.removeEventListener('keydown', onKey);
    mask.classList.remove('mopen');
    window.setTimeout(() => mask.remove(), 340);
    if (restoreFocus?.isConnected) restoreFocus.focus();
  };
  activeModalClose = close;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));

  // 拖拽排序：直接移动 DOM 节点（不重建列表，拖拽过程不中断）
  const rowOf = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest?.('.mrow') as HTMLElement | null;
  listEl.addEventListener('dragstart', e => {
    const row = rowOf(e.target);
    if (!row) return;
    stopClip();
    dragSid = row.dataset.sid ?? null;
    row.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragSid ?? ''); } catch { /* 某些环境禁写 */ }
    }
  });
  listEl.addEventListener('dragover', e => {
    if (!dragSid) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const dragging = listEl.querySelector('.mrow.dragging') as HTMLElement | null;
    const over = rowOf(e.target);
    if (!dragging || !over || over === dragging) return;
    const rect = over.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    listEl.insertBefore(dragging, before ? over : over.nextSibling);
  });
  listEl.addEventListener('dragend', () => {
    dragSid = null;
    listEl.querySelector('.mrow.dragging')?.classList.remove('dragging');
    // 按当前 DOM 顺序回写数组并重编号
    const bySid = new Map(songs.map(s => [s.song_id, s]));
    const ordered = Array.from(listEl.querySelectorAll<HTMLElement>('.mrow'))
      .map(el => bySid.get(el.dataset.sid ?? '')).filter(Boolean) as PreviewSong[];
    if (ordered.length === songs.length) songs = ordered;
    renderList();
  });

  listEl.addEventListener('click', e => {
    const del = (e.target as HTMLElement).closest('.mrow-del') as HTMLElement | null;
    if (del?.dataset.del) {
      if (playingSid === del.dataset.del) stopClip();
      songs = songs.filter(s => s.song_id !== del.dataset.del);
      say('');
      renderList();
      return;
    }
    // 点歌名：后台试听这首歌会被选中的片段（不进舞台）；再点一次停
    const name = (e.target as HTMLElement).closest('.mrow-name') as HTMLElement | null;
    const row = name?.closest('.mrow') as HTMLElement | null;
    if (name && row?.dataset.sid) playClip(row.dataset.sid, row);
  });

  // 搜索曲库手动添加：先校验歌词里有没有这个词
  const closeDrop = () => { dropEl.hidden = true; dropEl.innerHTML = ''; };
  addInput.addEventListener('input', () => {
    window.clearTimeout(addTimer);
    const q = addInput.value.trim();
    if (!q) { closeDrop(); return; }
    addTimer = window.setTimeout(async () => {
      const res = await fetchJson<{ items: { song_id: string; title: string; artist: string }[] }>(
        `/api/songs?q=${encodeURIComponent(q)}`).catch(() => null);
      if (closed || !mask.isConnected || addInput.value.trim() !== q) return;
      const items = (res?.items ?? []).slice(0, 8);
      if (!items.length) {
        dropEl.hidden = true;
        dropEl.innerHTML = '';
        return;
      }
      dropEl.innerHTML = items.map(it => `
        <button type="button" class="mm-drop-item" data-sid="${esc(it.song_id)}">
          <b>${esc(it.title)}</b><i>${esc(it.artist)}</i>
        </button>`).join('');
      dropEl.hidden = false;
    }, 240);
  });
  dropEl.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest('.mm-drop-item') as HTMLElement | null;
    const sid = item?.dataset.sid;
    if (!sid) return;
    if (songs.some(s => s.song_id === sid)) { say('这首歌已经在列表里了。'); return; }
    say('');
    void (async () => {
      const info = await fetchJson<PreviewSong>(
        `/api/mashup/songcheck?word=${encodeURIComponent(word)}&song_id=${encodeURIComponent(sid)}`,
      ).catch(() => null);
      if (closed) return;
      // 慢请求期间可能已经加过同一首（双击 / 两次点击）
      if (songs.some(s => s.song_id === sid)) { say('这首歌已经在列表里了。'); return; }
      if (!info?.song_id) { say('查不到这首歌。'); return; }
      if (!info.occurrences) { say(`《${info.title}》的歌词里没有「${word}」，用不上。`); return; }
      if (songs.some(s => songKey(s) === songKey(info))) {
        say('同一个人唱的这首歌已经在列表里了。');
        return;
      }
      songs.push(info);
      addInput.value = '';
      closeDrop();
      renderList();
    })();
  });

  goBtn.addEventListener('click', () => {
    if (!songs.length) return;
    goBtn.disabled = true;
    say('');
    void (async () => {
      try {
        await postJson<{ task_id: string }>('/api/mashup/create',
          { word, song_ids: songs.map(s => s.song_id) });
        onStarted();
        close();
      } catch (e) {
        say((e as Error).message);
        goBtn.disabled = false;
      }
    })();
  });

  // 初始候选：和直接制作时一样的关键词选歌
  void (async () => {
    const res = await fetchJson<{ songs: PreviewSong[] }>(
      `/api/mashup/preview?word=${encodeURIComponent(word)}`).catch(() => null);
    if (closed) return;
    if (!res) {
      countEl.textContent = '待添加';
      listEl.innerHTML = '<p class="mm-hint">查询失败，请关掉重试。</p>';
      return;
    }
    const incoming = res.songs ?? [];
    // 预览可能很慢：期间手动添加的歌要保留在列表里，不能被响应覆盖
    const manual = songs.filter(s => !incoming.some(item => item.song_id === s.song_id));
    // 同人同曲（同名同歌手的多个版本）只留一条；异人同名保留，列表里标红
    songs = dedupeSongs([...incoming, ...manual]);
    renderList();
  })();
};

const createBackdropHtml = () => `
    <div class="create-backdrop" aria-hidden="true">
      <svg width="0" height="0" focusable="false">
        <filter id="create-rain-ink" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -.33 -1.11 -.11 1.235 0" result="dark-marks"/>
          <feFlood class="rain-dark-pigment" result="dark-pigment"/>
          <feComposite in="dark-pigment" in2="dark-marks" operator="in" result="dark-ink"/>
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6.5 0 6.5 0 -.04" result="blue-marks"/>
          <feFlood class="rain-blue-pigment" result="blue-pigment"/>
          <feComposite in="blue-pigment" in2="blue-marks" operator="in" result="blue-ink"/>
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.5 0 -4.5 0 -.35" result="warm-marks"/>
          <feFlood flood-color="#efcc82" result="warm-pigment"/>
          <feComposite in="warm-pigment" in2="warm-marks" operator="in" result="lamp-light"/>
          <feMerge>
            <feMergeNode in="dark-ink"/>
            <feMergeNode in="blue-ink"/>
            <feMergeNode in="lamp-light"/>
          </feMerge>
        </filter>
      </svg>
    </div>`;

function mountRecordRules(list: HTMLUListElement) {
  const tile = document.createElement('canvas');
  const ctx = tile.getContext('2d');
  if (!ctx) return () => {};

  const stripHeight = 8;
  const tileHeight = stripHeight * 4;
  list.style.setProperty('--record-rule-height', `${stripHeight}px`);
  let lastPaint = '';
  const paint = () => {
    const width = list.clientWidth;
    if (width < 8) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const color = document.documentElement.dataset.theme === 'night' ? '#a0a8a6' : '#3f4645';
    const signature = `${width}:${ratio}:${color}`;
    if (lastPaint === signature) return;
    lastPaint = signature;
    tile.width = Math.round(width * ratio);
    tile.height = Math.round(tileHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const random = seededRandom(9721);
    const lines = [.50, .47, .52, .48].map((opacity, i) => {
      const y = (i + .5) / 4;
      return makeStroke([y, 2 / width, 1 - 2 / width, opacity], width, tileHeight, random);
    });
    strokeLines(ctx, lines, color);
    list.style.setProperty('--record-rule-ink', `url("${tile.toDataURL()}")`);
  };

  const size = new ResizeObserver(paint);
  const theme = new MutationObserver(paint);
  size.observe(list);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  paint();
  return () => { size.disconnect(); theme.disconnect(); };
}

const renderCreate = async (root: HTMLElement, _query: URLSearchParams, seq: number) => {
  stopCreatePoll();
  commitConsolePage(root, `
    ${navHtml('create')}
    ${createBackdropHtml()}
    <main class="page create-page" aria-label="缀字">
      <form class="toolbar create-form reveal" data-stagger="1" id="create-form">
        <input name="word" maxlength="20" placeholder="输入一个词…" autofocus>
        <button type="submit">开始制作</button>
      </form>
      <section class="create-records reveal" data-stagger="2">
        <h2>制作记录</h2>
        <p class="record-feedback" role="status" hidden></p>
        <ul id="task-list" class="record-list" role="list" style="--work-swipe-distance:${WORK_SWIPE_OPEN}px"></ul>
      </section>
    </main>`);
  initConsoleFx(root, seq);

  const list = root.querySelector<HTMLUListElement>('#task-list')!;
  const feedback = root.querySelector<HTMLElement>('.record-feedback')!;
  fxCleanups.push(mountRecordRules(list));
  const progressBars = new Map<string, ReturnType<typeof createConstructionProgress>>();
  const clearProgressBars = () => { for (const bar of progressBars.values()) bar.destroy(); progressBars.clear(); };
  fxCleanups.push(clearProgressBars);

  const phaseLabel = (t: MashupTask) => t.phase === 'joining' ? '拼接音频中'
    : t.total_songs ? `已处理 ${t.processed}/${t.total_songs} 首` : '选歌中';
  const VIDEO_DL_ICON = '<svg class="video-dl-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v10.5m0 0-3.5-3.5M8 13l3.5-3.5"/></svg>';
  const videoExports = new Map<string, VideoExport>();
  const videoRequests = new Set<string>();
  const videoErrors = new Map<string, string>();
  const paintVideo = (controls: HTMLElement) => {
    const mid = controls.dataset.videoId!;
    const state = videoExports.get(mid);
    const message = controls.querySelector<HTMLElement>('.record-video-message')!;
    const bar = controls.querySelector<HTMLProgressElement>('progress')!;
    const action = controls.querySelector<HTMLButtonElement>('[data-video-action]')!;
    const download = controls.querySelector<HTMLAnchorElement>('[data-video-download]')!;
    const error = videoErrors.get(mid) || (state?.status === 'error' ? state.error || '导出失败' : '');
    const busy = state?.status === 'running' || state?.status === 'cancelling';
    const waiting = videoRequests.has(mid);
    const ready = state?.available ?? state?.status === 'done';
    const label = error || (waiting ? '处理中…' : state?.status === 'cancelling' ? '正在取消…'
      : state?.status === 'running' ? state.progress >= 98 ? '正在合成…'
        : state.progress ? `渲染 ${state.progress}%` : '正在准备…'
      : state?.status === 'cancelled' ? '已取消' : '');
    controls.toggleAttribute('data-error', !!error);
    if (message.textContent !== label) message.textContent = label;
    message.title = error;
    message.hidden = !label;
    bar.hidden = state?.status !== 'running' || !state.progress || state.progress >= 98;
    bar.value = state?.progress ?? 0;
    action.disabled = waiting || state?.status === 'cancelling';
    if (!busy && !error && !ready) {
      if (!action.querySelector('.video-dl-icon')) action.innerHTML = VIDEO_DL_ICON;
      action.setAttribute('aria-label', '导出视频');
      action.title = '导出视频';
    } else {
      const text = busy ? '取消' : error ? '重试' : '重新导出';
      if (action.textContent !== text) action.textContent = text;
      action.setAttribute('aria-label', text);
      action.title = text;
    }
    download.hidden = !ready || busy;
  };
  const rowHtml = (t: MashupTask) => {
    const id = esc(t.id);
    const word = esc(t.word);
    const title = `<span class="word" title="${word}">${word}</span>`;
    const date = `<span class="record-date" title="${esc(t.created)}">${esc(t.created.slice(5, 16))}</span>`;
    if (t.status === 'done' && t.meta_id && t.work_available) {
      return `
      <li class="mu-item record-has-video" data-swipe data-task="${id}">
        <div class="mu-card" data-swipe-card>
          <a class="record-preview" draggable="false" href="${esc(mashupHref(t.meta_id))}" title="进入舞台播放">
            ${title}
            <span class="meta record-meta"><span>${t.segments} 段 · ${clockShort(t.total_ms)}</span>${date}</span>
          </a>
          <div class="record-video" data-video-id="${esc(t.meta_id)}"${t.video_export === undefined ? ' data-older-server' : ''}>
            <span class="record-video-message" role="status" hidden></span>
            <progress max="100" aria-label="视频导出进度" hidden></progress>
            <a href="${videoExportUrl(t.meta_id)}" data-video-download download hidden>下载视频</a>
            <button type="button" data-video-action aria-label="导出视频" title="导出视频">${VIDEO_DL_ICON}</button>
          </div>
        </div>
        ${swipeButtonHtml(word)}
      </li>`;
    }
    if (t.status === 'running') {
      return `
      <li class="mu-item record-running" data-swipe data-task="${id}">
        <div class="mu-card" data-swipe-card>
          <span class="record-name">${title}<span class="meta record-status">${phaseLabel(t)}</span></span>
          <span class="row-progress" role="progressbar" aria-label="制作进度" aria-valuemin="0" aria-valuemax="100"><canvas aria-hidden="true"></canvas></span>
          <span class="meta">${date}</span>
        </div>
        ${swipeButtonHtml(word, 'cancel')}
      </li>`;
    }
    if (t.status === 'cancelling') {
      return `
      <li class="mu-item" data-task="${id}">
        <div class="mu-card">
          <span class="record-name">${title}<span class="meta record-status">取消中</span></span>
          <span class="meta">${date}</span>
        </div>
      </li>`;
    }
    const isError = t.status === 'error';
    const isCancelled = t.status === 'cancelled';
    const detail = esc(isError ? (t.error ?? '制作失败') : isCancelled ? '' : '作品已被删除，点不开了');
    return `
      <li class="mu-item record-unavailable${isError ? ' record-error' : ''}" data-swipe data-task="${id}">
        <div class="mu-card" data-swipe-card>
          <span class="record-name">${title}<span class="meta record-status">${isError ? '失败' : isCancelled ? '已取消' : '已删除'}</span></span>
          <span class="meta record-meta"><span class="record-detail" title="${detail}">${detail}</span>${date}</span>
        </div>
        ${swipeButtonHtml(word)}
      </li>`;
  };

  let lastSig = '';
  let watched = new Set<string>();

  const onRecordAction = (li: HTMLElement, btn: HTMLButtonElement) => {
    void (async () => {
      const id = li.dataset.task ?? '';
      if (!id) return;
      const isCancel = btn.dataset.swipeAction === 'cancel';
      const label = isCancel ? '取消' : '删除';
      feedback.hidden = true;
      btn.disabled = true;
      btn.textContent = `${label}中`;
      const endpoint = isCancel ? '/api/mashup/task/cancel' : '/api/mashup/task';
      try {
        await fetchJson(`${endpoint}?id=${encodeURIComponent(id)}`, { method: isCancel ? 'POST' : 'DELETE' });
      } catch (error) {
        if (!list.isConnected) return;
        feedback.textContent = `${label}失败 · ${error instanceof Error ? error.message : '请重试'}`;
        feedback.hidden = false;
        btn.disabled = false;
        btn.textContent = label;
        void refresh();
        return;
      }
      if (isCancel) {
        void refresh();
        return;
      }
      if (!li.isConnected) return;
      // 原地收尾：这一行滑出移除，不重渲染整页（避免闪屏）
      li.classList.add('gone');
      window.setTimeout(() => {
        if (!li.isConnected) return;
        li.remove();
        lastSig = '';
        void refresh();
      }, 420);
    })();
  };

  const renderRows = (tasks: MashupTask[]) => {
    clearProgressBars();
    list.innerHTML = tasks.map(rowHtml).join('');
    for (const t of tasks) {
      if (t.status !== 'running') continue;
      const host = list.querySelector<HTMLElement>(`[data-task="${CSS.escape(t.id)}"] .row-progress`);
      if (host) {
        const bar = createConstructionProgress(host);
        bar.setProgress(t.total_songs ? t.processed / t.total_songs : null, true);
        progressBars.set(t.id, bar);
      }
    }
    bindSwipeAction(list, onRecordAction);
  };

  // 原地更新数字和砌砖目标；保留工人与砖墙的动画状态。
  let refreshSeq = 0;
  const refresh = async () => {
    if (!list.isConnected) return;
    if (document.hidden && !videoRequests.size
      && ![...videoExports.values()].some(job => job.status === 'running' || job.status === 'cancelling')) return;
    const seq = ++refreshSeq;
    const tasks = await fetchJson<MashupTask[]>('/api/mashup/tasks').catch(() => null);
    if (seq !== refreshSeq) return; // 已有更新的请求，丢弃旧快照
    if (!tasks || !list.isConnected) return;
    if (list.querySelector('.gone')) return; // 删除动画进行中，先别重建
    // 只把影响行结构的字段算进签名：进行中的 segments/processed 每首都会变，
    // 若也算进来会整行重建（进度条回跳 = 跳闪），它们走下面的原地更新
    const sig = tasks.map(t => [
      t.id, t.status, t.meta_id ?? '', t.error ?? '',
      t.status === 'done' ? `${t.segments}:${t.total_ms}:${t.work_available}:${t.video_export !== undefined}` : '',
    ].join(':')).join('|');
    const runningNow = new Set(tasks.filter(t => t.status === 'running').map(t => t.id));
    if (sig !== lastSig) {
      lastSig = sig;
      renderRows(tasks);
      // 只有真的做完才撒花：失败/被删/在别的标签页删掉都不算
      const justFinished = tasks.some(t => watched.has(t.id) && t.status === 'done' && t.work_available);
      if (justFinished) burstConfetti(list.parentElement);
    }
    watched = runningNow;
    for (const t of tasks) {
      if (t.work_available && t.meta_id) {
        if (t.video_export) videoExports.set(t.meta_id, t.video_export);
        else videoExports.delete(t.meta_id);
      }
      if (t.status !== 'running') continue;
      progressBars.get(t.id)?.setProgress(t.total_songs ? t.processed / t.total_songs : null);
      const status = list.querySelector<HTMLElement>(`[data-task="${CSS.escape(t.id)}"] .record-status`);
      const label = phaseLabel(t);
      if (status && status.textContent !== label) status.textContent = label;
    }
    list.querySelectorAll<HTMLElement>('.record-video').forEach(paintVideo);
  };

  list.addEventListener('click', async event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-video-action]');
    const controls = action?.closest<HTMLElement>('.record-video');
    const mid = controls?.dataset.videoId;
    if (!controls || !mid || videoRequests.has(mid)) return;
    if (controls.hasAttribute('data-older-server')) {
      videoErrors.set(mid, '请重启本地网站后导出视频。');
      paintVideo(controls);
      return;
    }
    const state = videoExports.get(mid);
    videoRequests.add(mid);
    videoErrors.delete(mid);
    paintVideo(controls);
    try {
      if (state?.status === 'running' && state.id) {
        await fetchJson(`${videoExportUrl(mid, '/cancel')}&job=${encodeURIComponent(state.id)}`, { method: 'POST' });
        videoExports.set(mid, { ...state, status: 'cancelling' });
      } else {
        const job = await fetchJson<VideoExport>(`${videoExportUrl(mid)}&theme=${readStageTheme()}`, { method: 'POST' });
        videoExports.set(mid, job);
        if (job.id) watchVideoDownload(mid, job.id);
      }
    } catch (error) {
      videoErrors.set(mid, error instanceof Error ? error.message : '导出失败，请重试。');
    } finally {
      videoRequests.delete(mid);
      if (controls.isConnected) paintVideo(controls);
      void refresh();
    }
  });

  createPoll = window.setInterval(() => void refresh(), 1200);
  const refreshOnReturn = () => { if (!document.hidden) void refresh(); };
  document.addEventListener('visibilitychange', refreshOnReturn);
  fxCleanups.push(() => document.removeEventListener('visibilitychange', refreshOnReturn));
  void refresh();

  const form = root.querySelector('#create-form') as HTMLFormElement;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const word = String(new FormData(form).get('word') ?? '').trim();
    if (!word) return;
    openMakeModal(root, word, () => { lastSig = ''; void refresh(); });
  });
};

// ---------------------------------------------------------------------------
// 收藏收藏
const renderFavorites = (root: HTMLElement) => {
  document.querySelector('.preloader')?.remove();
  commitConsolePage(root, `
    ${navHtml('favorites')}
    <main class="favorites-page">
      <iframe src="/assets/favorites/index.html" title="收藏收藏"></iframe>
    </main>`);
  restoreRouteScroll();
  initConsoleNav(root);
};

// ---------------------------------------------------------------------------
// 路由
const parseHash = () => {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return {
    segments,
    query: new URLSearchParams(queryPart ?? ''),
  };
};

/** 手输坏的 % 转义（#/song/%）不能让整个路由渲染抛错。 */
const safeDecode = (value: string) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export const startConsole = (root: HTMLElement) => {
  window.addEventListener('scroll', scheduleScrollBar, { passive: true });
  // 页内回退的滚动位置由路由还原，避免浏览器提前滚动尚未换掉的旧页面。
  const originalScrollRestoration = history.scrollRestoration;
  history.scrollRestoration = 'manual';
  window.addEventListener('pagehide', () => { history.scrollRestoration = originalScrollRestoration; });
  window.addEventListener('pageshow', () => { history.scrollRestoration = 'manual'; });
  if (parseHash().segments[0] !== 'favorites') runPreloader();
  root.innerHTML = '<main class="page"><p class="hint" role="status">正在加载歌词库…</p></main>';
  const render = async (scrollY?: number) => {
    const seq = ++renderSeq;
    routeScroll = scrollY;
    root.setAttribute('aria-busy', 'true');
    lyricSearchRequest?.abort();
    lyricSearchRequest = undefined;
    stopCreatePoll();
    stopDetailAudio();
    closeActiveModal();
    try {
      const { segments, query } = parseHash();
      const route = segments[0] ?? '';
      document.title = route === 'songs' ? '歌曲库 · 觅字'
        : route === 'search' ? '歌词检索 · 觅字'
          : route === 'favorites' ? '收藏收藏 · 觅字'
            : route === 'create' ? '缀字 · 觅字'
              : route === 'song' ? '歌曲 · 觅字'
                : '觅字 · 歌词库';
      if (route === 'songs') await renderSongs(root, query, seq);
      else if (route === 'search') await renderSearch(root, query, seq, () => void render());
      else if (route === 'favorites') renderFavorites(root);
      else if (route === 'create') await renderCreate(root, query, seq);
      else if (route === 'song' && segments[1]) await renderSong(root, safeDecode(segments[1]), query, seq);
      else await renderHome(root, seq);
    } catch (error) {
      if (seq !== renderSeq) return;
      console.error(error);
      commitConsolePage(root, `${navHtml('')}<div class="page"><p class="empty">页面出错了，返回首页再试。</p></div>`);
      initConsoleFx(root, seq);
    } finally {
      if (seq === renderSeq) root.removeAttribute('aria-busy');
    }
  };
  // 切页直接换内容（无转场动画）。点进新页回页顶；回退则还原到离开时的位置。
  // 用站内路由栈判断方向：新 hash 正好是栈里倒数第二个，说明这是一次「回退」。
  const routeStack = [window.location.hash || '#/'];
  window.addEventListener('hashchange', () => {
    const next = window.location.hash || '#/';
    if (displayedHash) scrollMemo.set(displayedHash, window.scrollY);
    const back = routeStack.length >= 2 && routeStack[routeStack.length - 2] === next;
    if (back) routeStack.pop();
    else routeStack.push(next);
    routeDepth = routeStack.length - 1;
    void render(back ? scrollMemo.get(next) ?? 0 : 0);
  });
  void render();
};
