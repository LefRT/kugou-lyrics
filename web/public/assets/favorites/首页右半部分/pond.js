const painting = document.querySelector(".painting");
const scene = document.querySelector(".scene");
const water = document.querySelector(".water");
const brush = water.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

if (window.JournalPage) {
  const songList = document.querySelector(".favorite-songs");
  const searchInput = document.querySelector(".song-search-input");
  const searchClear = document.querySelector(".song-search-clear");
  const clearAll = document.querySelector(".song-clear-all");
  const clearStatus = document.querySelector(".song-clear-status");
  let clearArmed = false;
  let clearTimer = 0;
  let allSongs = [];
  let currentSelectedId = null;
  let buttons = [];
  let selectedButton;
  let scrollFrame = 0;
  let suppressScrollUntil = 0;
  let wheelDistance = 0;
  let lastWheelTime = -Infinity;

  function paintSelection(id) {
    currentSelectedId = id;
    selectedButton?.setAttribute("aria-pressed", "false");
    selectedButton = buttons.find(button => button.dataset.songId === id);
    selectedButton?.setAttribute("aria-pressed", "true");
  }

  function centerY(element) {
    const { top, height } = element.getBoundingClientRect();
    return top + height / 2;
  }

  function centerSong(button, suppressScroll = false) {
    if (button) {
      if (suppressScroll) suppressScrollUntil = performance.now() + 120;
      songList.scrollTop += centerY(button) - centerY(songList);
    }
  }

  function songAtCenter() {
    const center = centerY(songList);
    let nearest;
    let distance = Infinity;
    for (const button of buttons) {
      const gap = Math.abs(centerY(button) - center);
      if (gap >= distance) break;
      nearest = button;
      distance = gap;
    }
    return nearest;
  }

  function fitSongList() {
    if (!buttons.length || !songList.clientHeight) {
      songList.style.setProperty("--song-list-start", "2px");
      songList.style.setProperty("--song-list-end", "2px");
      return;
    }
    const halfHeight = songList.clientHeight / 2;
    // Leave enough room for the first and last songs to reach the center.
    songList.style.setProperty("--song-list-start", `${Math.max(0, halfHeight - buttons[0].offsetHeight / 2)}px`);
    songList.style.setProperty("--song-list-end", `${Math.max(0, halfHeight - buttons.at(-1).offsetHeight / 2)}px`);
    centerSong(selectedButton, true);
  }

  function matchSong(song, terms) {
    if (!terms.length) return { matched: true, clipIndex: undefined };
    const title = String(song.title || "").toLowerCase();
    const artist = String(song.artist || "").toLowerCase();
    const clips = Array.isArray(song.clips) ? song.clips : [];
    const clipTexts = clips.map(lines => (Array.isArray(lines) ? lines.join("\n") : "").toLowerCase());
    const combined = `${title}\n${artist}\n${clipTexts.join("\n")}`;
    if (!terms.every(term => combined.includes(term))) return { matched: false, clipIndex: undefined };
    let clipIndex = clipTexts.findIndex(text => terms.every(term => text.includes(term)));
    if (clipIndex < 0) clipIndex = clipTexts.findIndex(text => terms.some(term => text.includes(term)));
    return { matched: true, clipIndex: clipIndex >= 0 ? clipIndex : undefined };
  }

  function renderSongs({ autoSelect = false } = {}) {
    const focused = document.activeElement?.dataset.songId;
    const rawQuery = searchInput ? searchInput.value : "";
    const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (searchClear) searchClear.hidden = !rawQuery;

    const matchedEntries = [];
    for (const song of allSongs) {
      const result = matchSong(song, terms);
      if (result.matched) matchedEntries.push({ song, clipIndex: result.clipIndex });
    }

    buttons = [];
    const items = matchedEntries.map(({ song: { id, title, artist }, clipIndex }) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.songId = id;
      if (clipIndex !== undefined) button.dataset.clipIndex = String(clipIndex);
      button.textContent = title;
      button.setAttribute("aria-label", artist ? `${title} · ${artist}` : title);
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        centerSong(button, true);
        const idx = button.dataset.clipIndex !== undefined ? Number(button.dataset.clipIndex) : undefined;
        window.JournalPage.favorites?.selectSong(id, idx);
      });
      buttons.push(button);
      item.append(button);
      return item;
    });

    if (!items.length && terms.length) {
      const empty = document.createElement("li");
      empty.className = "favorite-empty";
      empty.textContent = "—";
      empty.setAttribute("aria-label", "没有匹配的收藏");
      items.push(empty);
    } else if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "favorite-empty";
      empty.textContent = "还没有收藏的歌词";
      empty.setAttribute("aria-label", "还没有收藏的歌词");
      items.push(empty);
    }
    if (clearAll) clearAll.hidden = !allSongs.length;

    songList.replaceChildren(...items);
    const activeEntry = matchedEntries.find(entry => entry.song.id === currentSelectedId) ?? matchedEntries[0] ?? null;
    paintSelection(activeEntry ? activeEntry.song.id : null);
    fitSongList();
    if (autoSelect && activeEntry) {
      window.JournalPage.favorites?.selectSong(activeEntry.song.id, activeEntry.clipIndex);
    }
    if (focused) {
      buttons.find(button => button.dataset.songId === focused)?.focus({ preventScroll: true });
    }
  }

  window.addEventListener("journal:songs", ({ detail }) => {
    allSongs = Array.isArray(detail.songs) ? detail.songs : [];
    currentSelectedId = detail.selectedId ?? null;
    renderSongs();
  });
  window.addEventListener("journal:selection", event => paintSelection(event.detail));
  new ResizeObserver(fitSongList).observe(songList);

  if (searchInput) {
    searchInput.addEventListener("input", () => renderSongs({ autoSelect: true }));
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Escape" && searchInput.value) {
        event.preventDefault();
        event.stopPropagation();
        searchInput.value = "";
        renderSongs({ autoSelect: true });
      } else if (event.key === "Enter" && buttons.length) {
        const target = selectedButton ?? buttons[0];
        const idx = target.dataset.clipIndex !== undefined ? Number(target.dataset.clipIndex) : undefined;
        centerSong(target);
        window.JournalPage.favorites?.selectSong(target.dataset.songId, idx);
      }
    });
  }
  if (searchClear && searchInput) {
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      renderSongs({ autoSelect: true });
      searchInput.focus();
    });
  }

  function resetClearConfirm() {
    clearArmed = false;
    clearTimeout(clearTimer);
    if (!clearAll) return;
    clearAll.classList.remove("is-armed");
    clearAll.textContent = "清空收藏";
    clearAll.setAttribute("aria-label", "清空全部收藏的歌词");
  }

  if (clearAll) {
    clearAll.addEventListener("click", () => {
      if (!allSongs.length) return;
      if (!clearArmed) {
        clearArmed = true;
        clearAll.classList.add("is-armed");
        clearAll.textContent = "确定";
        clearAll.setAttribute("aria-label", "确定清空全部收藏的歌词");
        clearTimeout(clearTimer);
        clearTimer = setTimeout(resetClearConfirm, 4000);
        return;
      }
      resetClearConfirm();
      if (searchInput) searchInput.value = "";
      window.JournalPage.favorites?.clearFavorites?.();
      if (clearStatus) {
        clearStatus.textContent = "已清空收藏";
        clearStatus.classList.add("is-visible");
        setTimeout(() => clearStatus.classList.remove("is-visible"), 2200);
      }
    });
  }

  songList.closest(".note-sheet").addEventListener("wheel", event => {
    const { deltaMode, deltaX, deltaY, timeStamp } = event;
    if (!buttons.length || event.ctrlKey || Math.abs(deltaY) <= Math.abs(deltaX)) return;
    event.preventDefault();
    if (timeStamp - lastWheelTime > 150 || wheelDistance * deltaY < 0) wheelDistance = 0;
    lastWheelTime = timeStamp;
    wheelDistance += deltaY;
    // Accumulate small trackpad deltas. One mouse wheel step moves one song.
    if (deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(wheelDistance) < 30) return;
    const next = buttons.indexOf(songAtCenter()) + Math.sign(wheelDistance);
    const target = buttons[clamp(next, 0, buttons.length - 1)];
    if (target) {
      centerSong(target, true);
      const idx = target.dataset.clipIndex !== undefined ? Number(target.dataset.clipIndex) : undefined;
      window.JournalPage.favorites?.selectSong(target.dataset.songId, idx);
    }
    wheelDistance = 0;
  }, { passive: false });

  songList.addEventListener("scroll", () => {
    if (scrollFrame || performance.now() < suppressScrollUntil) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (performance.now() < suppressScrollUntil) return;
      const nearest = songAtCenter();
      if (nearest && nearest !== selectedButton) {
        const idx = nearest.dataset.clipIndex !== undefined ? Number(nearest.dataset.clipIndex) : undefined;
        window.JournalPage.favorites?.selectSong(nearest.dataset.songId, idx);
      }
    });
  });
}

const width = 1000;
const height = 665;
brush.scale(water.width / width, water.height / height);
const garden = new FlowerGarden(scene.querySelector(".flowers"), width, height, { ...pondGarden, fps: 15 });
const swimmers = [
  { x: 650, y: 289, rx: 125, ry: 59, phase: 2.37, speed: 0.7, size: 1, color: "#e8a14f", light: "#ffe0a0" },
  { x: 657, y: 316, rx: 99, ry: 47, phase: 0.7, speed: 0.83, size: 0.83, color: "#df7861", light: "#ffca91" },
  { x: 695, y: 317, rx: 94, ry: 49, phase: 5.07, speed: -0.62, size: 0.74, color: "#edc474", light: "#fff1bf" },
  { x: 629, y: 295, rx: 108, ry: 61, phase: 4.15, speed: -0.73, size: 0.59, color: "#c69465", light: "#f4d19d" },
  { x: 669, y: 302, rx: 135, ry: 73, phase: 1.35, speed: -0.59, size: 0.97, color: "#68d9b3", light: "#cfffdf" },
  { x: 660, y: 289, rx: 110, ry: 51, phase: 3.48, speed: 0.94, size: 0.89, color: "#c197e5", light: "#f0dbff" },
  { x: 676, y: 319, rx: 131, ry: 64, phase: -0.87, speed: -0.79, size: 0.79, color: "#bddce8", light: "#fff6e8" },
];
const glints = [
  [436, 262, 14], [481, 297, 12], [513, 232, 15], [553, 362, 19],
  [602, 209, 9], [623, 387, 20], [685, 180, 11], [723, 368, 14],
  [753, 296, 10], [800, 253, 16], [837, 321, 13], [879, 293, 10],
];
// The mask follows the open water, leaving the flower-bearing shoreline behind it.
const waterOutline = [
  [353, 228], [363, 200], [389, 170], [432, 150], [466, 132], [487, 96], [521, 84],
  [550, 72], [579, 76], [608, 68], [637, 62], [661, 85], [675, 111],
  [687, 153], [716, 154], [747, 154], [777, 183], [801, 213], [842, 227],
  [893, 254], [909, 292], [880, 324], [832, 334], [820, 365], [803, 376],
  [777, 365], [752, 376], [727, 377], [708, 387], [709, 426], [733, 447],
  [701, 473], [673, 489], [621, 484], [586, 458], [553, 436], [514, 430],
  [492, 418], [449, 416], [416, 394], [413, 371], [391, 365], [395, 347],
  [389, 327], [380, 316], [373, 294], [380, 259],
];

let waves = [];
let elapsed = 0;
let previousFrame;
let frameId;
let disturbance;
let view = { scale: 1, left: 0, top: 0 };
let pageVisible = !window.JournalPage;

function maskOriginalWater() {
  const originalWater = scene.querySelector('.original-water');
  const artwork = originalWater.querySelector('.artwork');
  for (const layer of originalWater.querySelectorAll('.water-patch')) layer.append(artwork.cloneNode());

  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const fill = mask.getContext("2d");
  fill.filter = "blur(7px)";
  fill.beginPath();
  fill.moveTo(...waterOutline[0]);
  for (const point of waterOutline.slice(1)) fill.lineTo(...point);
  fill.closePath();
  fill.fill();
  originalWater.style.maskImage = `url("${mask.toDataURL()}")`;
}

function fitPainting() {
  const { clientWidth, clientHeight } = painting;
  if (!clientWidth || !clientHeight) return;
  const scale = Math.min(clientWidth / width, clientHeight / height);
  const left = (clientWidth - width * scale) / 2;
  const top = (clientHeight - height * scale) / 2;
  view = { scale, left, top };
  scene.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fishPosition(fish, time) {
  const angle = fish.phase + time * fish.speed;
  let x = fish.x + Math.cos(angle) * fish.rx;
  let y = fish.y + Math.sin(angle) * fish.ry + 3 * Math.sin(angle * 3);

  if (disturbance) {
    const timeSinceSplash = Math.max(0, time - disturbance.time);
    const dx = x - disturbance.x;
    const dy = y - disturbance.y;
    const distance = Math.hypot(dx, dy);
    const dart = clamp(1 - distance / 110, 0, 1)
      * Math.sin(Math.min(timeSinceSplash * 5, Math.PI / 2))
      * Math.exp(-timeSinceSplash / 0.65) * 55;
    x += dx * dart / Math.max(distance, 1);
    y += dy * dart / Math.max(distance, 1);
  }

  return { x, y };
}

function drawFish(fish) {
  const point = fishPosition(fish, elapsed);
  const ahead = fishPosition(fish, elapsed + 0.035);
  const heading = Math.atan2(ahead.y - point.y, ahead.x - point.x);
  const tail = 4 * Math.sin(elapsed * 13 + fish.phase);

  brush.save();
  brush.translate(point.x, point.y);
  brush.rotate(heading);
  brush.scale(fish.size, fish.size);
  brush.globalAlpha = 0.7;
  brush.fillStyle = fish.color;
  brush.beginPath();
  brush.moveTo(-5, 0);
  brush.quadraticCurveTo(-11, -4 + tail * 0.4, -17, -5 + tail);
  brush.quadraticCurveTo(-14, tail, -17, 5 + tail);
  brush.quadraticCurveTo(-11, 4 + tail * 0.4, -5, 1);
  brush.fill();
  brush.beginPath();
  brush.moveTo(-9, 0);
  brush.bezierCurveTo(-1, -6, 8, -6, 12, -1);
  brush.bezierCurveTo(12, 3, 3, 5, -3, 3);
  brush.closePath();
  brush.fill();
  brush.fillStyle = fish.light;
  brush.beginPath();
  brush.moveTo(-4, -1);
  brush.quadraticCurveTo(5, -6, 10, -2);
  brush.quadraticCurveTo(7, 1, -4, -1);
  brush.fill();
  brush.fillStyle = "#392d29";
  brush.fillRect(8, -1, 1.2, 1.2);
  brush.restore();
}

function drawGlints() {
  brush.lineCap = "round";
  brush.strokeStyle = "#d7f3ef";
  for (const [x, y, length] of glints) {
    const shimmer = Math.sin(elapsed * 1.9 + x);
    brush.globalAlpha = (1 + shimmer) * 0.13;
    brush.lineWidth = 1 + (1 + shimmer) * 0.6;
    brush.beginPath();
    brush.moveTo(x - length * 0.55, y + 1);
    brush.quadraticCurveTo(x, y - 2, x + length * 0.45, y);
    brush.stroke();
  }
  brush.globalAlpha = 1;
}

function drawWave(wave) {
  const age = clamp((elapsed - wave.time) / 1.55, 0, 1);
  const light = (1 - age) * wave.strength;
  const radius = 5 + age * wave.radius;
  brush.strokeStyle = "#d1f3f4";

  for (let ring = 0; ring < 2; ring++) {
    const spread = radius * (1 - ring * 0.42);
    brush.lineWidth = 1.4 + (1 - age) * 1.6;
    for (let stroke = 0; stroke < 7; stroke++) {
      const angle = stroke * 0.9 + ring * 0.6;
      brush.globalAlpha = light * (0.34 + 0.18 * Math.sin(stroke * 2.1 + ring));
      brush.beginPath();
      brush.ellipse(wave.x, wave.y, spread, spread * 0.52, -0.07, angle, angle + 0.53);
      brush.stroke();
    }
  }

  if (wave.splash && age < 0.42) {
    const jump = age / 0.42;
    brush.fillStyle = "#e4f7ef";
    for (let drop = 0; drop < 7; drop++) {
      const arc = 4 * jump * (1 - jump) * (8 + (drop * 7) % 20) * wave.splash;
      const spread = (drop - 3) * (2 + jump * 9) * wave.splash;
      brush.globalAlpha = light * (1 - jump) * 0.9;
      brush.beginPath();
      brush.ellipse(wave.x + spread, wave.y - arc + drop % 2 * 4, 1.3, 2.4, (drop - 3) * 0.17, 0, Math.PI * 2);
      brush.fill();
    }
  }
  brush.globalAlpha = 1;
}

function render() {
  brush.clearRect(0, 0, width, height);
  drawGlints();
  swimmers.forEach(drawFish);
  waves = waves.filter(wave => elapsed - wave.time < 1.55);
  waves.forEach(drawWave);
}

function animate(now) {
  frameId = requestAnimationFrame(animate);
  if (previousFrame !== undefined && now - previousFrame < 1000 / 30 - 1) return;
  const delta = previousFrame === undefined ? 0 : Math.min((now - previousFrame) / 1000, 0.05);
  previousFrame = now;
  elapsed += delta;
  render();
  garden.draw(elapsed);
}

function syncMotion() {
  cancelAnimationFrame(frameId);
  previousFrame = undefined;
  if (reducedMotion.matches || document.hidden || !pageVisible) {
    render();
  } else {
    frameId = requestAnimationFrame(animate);
  }
}

painting.addEventListener("click", event => {
  let x = 654;
  let y = 308;
  if (event.detail) {
    // The tilted print and its bounding box share the same center.
    const frame = painting.getBoundingClientRect();
    const { transform } = getComputedStyle(painting);
    const inverse = new DOMMatrixReadOnly(transform === "none" ? undefined : transform).inverse();
    const point = inverse.transformPoint({
      x: event.clientX - (frame.left + frame.width / 2),
      y: event.clientY - (frame.top + frame.height / 2),
    });
    x = (point.x + painting.offsetWidth / 2 - painting.clientLeft - view.left) / view.scale;
    y = (point.y + painting.offsetHeight / 2 - painting.clientTop - view.top) / view.scale;
  }
  const distanceFromPond = Math.max(1, Math.hypot((x - 654) / 216, (y - 308) / 129));
  const splashX = 654 + (x - 654) / distanceFromPond;
  const splashY = 308 + (y - 308) / distanceFromPond;

  if (reducedMotion.matches) {
    waves = [{ x: splashX, y: splashY, time: elapsed - 0.56, strength: 1.2, radius: 105 }];
    render();
    return;
  }

  disturbance = { x: splashX, y: splashY, time: elapsed };
  waves.push({ ...disturbance, strength: 1.2, radius: 105, splash: 0.9 });
});

fitPainting();
maskOriginalWater();
garden.draw(elapsed);
new ResizeObserver(fitPainting).observe(painting);
reducedMotion.addEventListener("change", syncMotion);
document.addEventListener("visibilitychange", syncMotion);
window.addEventListener('journal:visibility', event => {
  pageVisible = event.detail;
  syncMotion();
});
syncMotion();
