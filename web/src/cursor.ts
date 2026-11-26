// 自定义光标：红方块即时跟随 + 方环 lerp 拖尾，交互元素上旋转放大（A24 同款 cursor:none）。
// 控制台与舞台共用；只对精确指针（鼠标）且未开启「减少动态效果」的环境启用。

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const initCursor = () => {
  if (reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
  if (document.querySelector('.cursor-dot')) return;
  const dot = document.createElement('i');
  const ring = document.createElement('i');
  dot.className = 'cursor-dot';
  ring.className = 'cursor-ring';
  dot.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  document.body.append(ring, dot);
  document.documentElement.classList.add('cursor-on');

  let x = 0, y = 0, ringX = 0, ringY = 0;
  let frame = 0;
  let visible = false;
  let positionChanged = false;
  let target: EventTarget | null = null;
  dot.style.opacity = ring.style.opacity = '0';
  const draw = () => {
    frame = 0;
    if (!visible) {
      visible = true;
      ringX = x;
      ringY = y;
      dot.style.opacity = ring.style.opacity = '';
    }
    if (positionChanged) {
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      positionChanged = false;
    }
    ringX += (x - ringX) * 0.24;
    ringY += (y - ringY) * 0.24;
    const moving = Math.abs(x - ringX) + Math.abs(y - ringY) > 0.25;
    ring.style.transform = moving
      ? `translate3d(${ringX.toFixed(2)}px, ${ringY.toFixed(2)}px, 0)`
      : dot.style.transform;
    if (moving) frame = requestAnimationFrame(draw);
  };
  window.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    x = event.clientX;
    y = event.clientY;
    positionChanged = true;
    if (target !== event.target) {
      target = event.target;
      const hot = target instanceof Element && !!target.closest(
        'a, button, input, select, textarea, summary, .row, [role="button"]',
      );
      ring.classList.toggle('hot', hot);
      dot.classList.toggle('hot', hot);
    }
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: true });
  window.addEventListener('mousedown', () => ring.classList.add('press'));
  window.addEventListener('mouseup', () => ring.classList.remove('press'));
  const hide = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    visible = false;
    target = null;
    dot.style.opacity = ring.style.opacity = '0';
    ring.classList.remove('press');
  };
  document.documentElement.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
};
