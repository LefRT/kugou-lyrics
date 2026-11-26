import './console-theme.css';

let settleTimer = 0;

/** Interpolate the shared palette once; every surface and label uses that same frame. */
export function changeConsoleTheme(night: boolean) {
  const root = document.documentElement;
  window.clearTimeout(settleTimer);
  // 拖动预览写入的内联调色板先清掉：过渡从当前插值出发，补完剩下的距离
  if (previewing) {
    PALETTE_TOKENS.forEach(token => root.style.removeProperty(token));
    previewing = false;
  }
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches
    && typeof CSS.registerProperty === 'function';
  root.classList.toggle('console-theme-changing', animate);
  if (animate) getComputedStyle(root).getPropertyValue('--bg');
  root.dataset.theme = night ? 'night' : 'day';
  root.style.backgroundColor = 'var(--bg, #fff)';
  try { localStorage.setItem('kg-theme', root.dataset.theme); } catch { /* Theme also works without storage. */ }
  if (animate) settleTimer = window.setTimeout(() => root.classList.remove('console-theme-changing'), 450);
}

/** 拖动昼夜开关时实时预览的调色板令牌（与 console-theme.css 的 @property 一一对应）。 */
const PALETTE_TOKENS = [
  '--bg', '--bg-elev', '--bg-section', '--text', '--text-2', '--text-3',
  '--border', '--border-soft', '--accent', '--accent-hover', '--accent-soft',
  '--mark-bg', '--nav-bg', '--nav-border', '--sheen', '--input-bg', '--row-hover',
  '--dot', '--card-outline',
] as const;

let previewing = false;
let palettes: { day: string[]; night: string[] } | null = null;

/** 读一次昼夜两套令牌值（同一任务内翻转 data-theme 再翻回，不会闪烁）。 */
function readPalettes(): { day: string[]; night: string[] } {
  if (palettes) return palettes;
  const root = document.documentElement;
  const prev = root.dataset.theme ?? 'day';
  const read = () => {
    const cs = getComputedStyle(root);
    return PALETTE_TOKENS.map(token => cs.getPropertyValue(token).trim());
  };
  root.dataset.theme = 'day';
  const day = read();
  root.dataset.theme = 'night';
  const night = read();
  root.dataset.theme = prev;
  palettes = { day, night };
  return palettes;
}

function parseColor(value: string): { rgb: [number, number, number]; a: number } | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(n => Number.isNaN(n))) return null;
  return { rgb: [parts[0], parts[1], parts[2]], a: parts[3] ?? 1 };
}

/** 拖动像素开关时的实时预览：按拖动进度在昼夜两套调色板间线性插值（p=0 白天，1 黑夜）。 */
export function previewConsoleTheme(p: number) {
  const root = document.documentElement;
  if (p === 0 || p === 1) {
    // 拖动落回端点（回弹结束/起点抖动）：清掉内联调色板交还样式表，不长期残留内联值
    PALETTE_TOKENS.forEach(token => root.style.removeProperty(token));
    previewing = false;
    root.dataset.theme = p === 1 ? 'night' : 'day';
    return;
  }
  const { day, night } = readPalettes();
  PALETTE_TOKENS.forEach((token, i) => {
    const a = parseColor(day[i]);
    const b = parseColor(night[i]);
    if (!a || !b) return;
    const mix = (x: number, y: number) => Math.round((x + (y - x) * p) * 100) / 100;
    const alpha = Math.round((a.a + (b.a - a.a) * p) * 1000) / 1000;
    root.style.setProperty(token, `rgba(${mix(a.rgb[0], b.rgb[0])},${mix(a.rgb[1], b.rgb[1])},${mix(a.rgb[2], b.rgb[2])},${alpha})`);
  });
  previewing = true;
  // 纯色写死的主题细节（夜间光晕/滚动条等）在拖过中点时跟随切换
  root.dataset.theme = p >= 0.5 ? 'night' : 'day';
}
