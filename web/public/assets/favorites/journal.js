(() => {
  'use strict';

  const book = document.getElementById('book');
  const leaf = document.getElementById('leaf');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pageIds = ['first', 'second', 'third', 'fourth'];
  const pages = pageIds.map(id => document.getElementById(id));
  const frames = pages.map(page => page.querySelector('iframe'));
  const [seasons, pond, record, garden] = frames;
  const favoritesKey = 'kg-fav-lines';
  const legacyNotesKey = 'paper-record:notes';
  const songNotesKey = 'paper-record:song-notes';
  const heartTabs = document.getElementById('heart-tabs');
  const heartTabButtons = Array.from(heartTabs?.querySelectorAll('[data-tab]') ?? []);
  let songs = [];
  let selected = null;
  let currentSongId = null;
  let heartTab = 'lyrics';
  let clipCursor = 0;
  let clipLyrics = [];
  let loadRevision = 0;
  let spread = 'index';
  let turning = false;

  const demoFetch = (() => {
    try {
      return typeof window.parent?.__miziDemoFetch === 'function' ? window.parent.__miziDemoFetch : null;
    } catch {
      return null;
    }
  })();
  const apiFetch = url => demoFetch ? demoFetch(url) : fetch(url);

  try { localStorage.removeItem(legacyNotesKey); } catch { /* ignore */ }

  function readSongNotesMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(songNotesKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeSongNotesMap(map) {
    try {
      localStorage.setItem(songNotesKey, JSON.stringify(map));
    } catch { /* ignore */ }
  }

  function getSongNote(songId) {
    if (!songId) return '';
    const value = readSongNotesMap()[songId];
    return typeof value === 'string' ? value : '';
  }

  function broadcastSongNote(songId) {
    const note = getSongNote(songId);
    message(garden, 'song-note', { songId, note });
    return note;
  }

  function syncHeartTabs(focus = false) {
    heartTabButtons.forEach(btn => {
      const active = btn.dataset.tab === heartTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    message(garden, 'heart-tab', { tab: heartTab, focus });
  }

  function setHeartTab(tab, focus = false) {
    const next = tab === 'notes' ? 'notes' : 'lyrics';
    heartTab = next;
    syncHeartTabs(focus);
  }

  heartTabButtons.forEach(btn => {
    btn.addEventListener('click', () => setHeartTab(btn.dataset.tab, btn.dataset.tab === 'notes'));
  });

  const profileKey = 'paper-record:profile';
  const avatarBtn = document.getElementById('journal-avatar');
  const avatarImg = document.getElementById('journal-avatar-img');
  const avatarInput = document.getElementById('journal-avatar-input');
  const nameInput = document.getElementById('journal-profile-name');
  const bioInput = document.getElementById('journal-profile-bio');

  function readProfile() {
    try {
      const parsed = JSON.parse(localStorage.getItem(profileKey) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveProfile(patch) {
    try {
      const next = { ...readProfile(), ...patch };
      localStorage.setItem(profileKey, JSON.stringify(next));
    } catch { /* ignore */ }
  }

  function applyAvatar(src) {
    if (!avatarBtn || !avatarImg) return;
    if (src) {
      avatarImg.src = src;
      avatarImg.hidden = false;
      avatarBtn.classList.add('has-image');
    } else {
      avatarImg.removeAttribute('src');
      avatarImg.hidden = true;
      avatarBtn.classList.remove('has-image');
    }
  }

  function initProfile() {
    const saved = readProfile();
    if (typeof saved.avatar === 'string' && saved.avatar) applyAvatar(saved.avatar);
    if (nameInput && typeof saved.name === 'string') nameInput.value = saved.name;
    if (bioInput && typeof saved.bio === 'string') bioInput.value = saved.bio;

    nameInput?.addEventListener('input', () => saveProfile({ name: nameInput.value }));
    bioInput?.addEventListener('input', () => saveProfile({ bio: bioInput.value }));
    avatarBtn?.addEventListener('click', () => avatarInput?.click());
    avatarInput?.addEventListener('change', () => {
      const file = avatarInput.files?.[0];
      avatarInput.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) return;
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
        let dataUrl = canvas.toDataURL('image/webp', 0.88);
        if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        applyAvatar(dataUrl);
        saveProfile({ avatar: dataUrl });
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    });
  }

  initProfile();

  // Sync day/night theme from parent window so the journal transitions into midnight desk-lamp mode
  function syncThemeFromParent() {
    try {
      const parentRoot = window.parent?.document?.documentElement;
      if (!parentRoot || parentRoot === document.documentElement) return;
      const apply = () => {
        const isNight = parentRoot.dataset.theme === 'night';
        document.documentElement.dataset.theme = isNight ? 'night' : 'day';
      };
      apply();
      const observer = new MutationObserver(apply);
      observer.observe(parentRoot, { attributes: true, attributeFilter: ['data-theme'] });
      window.addEventListener('unload', () => observer.disconnect(), { once: true });
    } catch { /* ignore cross-origin */ }
  }
  syncThemeFromParent();

  const pageLoads = new Map();

  function warmPage(frame) {
    if (!pageLoads.has(frame)) {
      pageLoads.set(frame, new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
        frame.src = frame.dataset.src;
      }));
    }
    return pageLoads.get(frame);
  }

  function message(frame, type, data) {
    frame.contentWindow?.postMessage({ channel: 'lyrics-journal', type, ...data }, '*');
  }

  function syncPage(page, i) {
    const visible = (i < 2) === (spread === 'index');
    page.inert = turning || !visible;
    page.setAttribute('aria-hidden', String(page.inert));
    message(frames[i], 'visibility', { visible: visible && !turning });
  }

  function showSongs() {
    message(pond, 'songs', {
      songs: songs.map(({ id, title, artist, clips }) => ({
        id,
        title,
        artist,
        clips: clips.map(clip => clip.lines),
      })),
      selectedId: selected?.id,
    });
  }

  frames.forEach((frame, i) => frame.addEventListener('load', () => {
    syncPage(pages[i], i);
    if (frame === pond) showSongs();
    if (frame === garden) {
      message(garden, 'clip-lyrics', { lines: clipLyrics });
      if (currentSongId) message(garden, 'song-note', { songId: currentSongId, note: getSongNote(currentSongId) });
      message(garden, 'heart-tab', { tab: heartTab, focus: false });
    }
  }));
  pages.forEach(syncPage);

  function readMarks() {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(favoritesKey) || '{}') ?? {})
        .filter(([, starts]) => Array.isArray(starts) && starts.some(Number.isFinite));
    } catch {
      return [];
    }
  }

  function collectClips(song, starts) {
    const marked = new Set(starts);
    const clips = [];
    let clip;
    for (const line of song.timeline?.lines ?? []) {
      if (!line || line.credit || !Number.isFinite(line.start)) continue;
      if (!marked.has(line.start)) {
        clip = undefined;
        continue;
      }
      if (!clip) {
        clip = { start: line.start, end: line.start, lines: [] };
        clips.push(clip);
      }
      clip.lines.push(line.text);
      if (Number.isFinite(line.end)) clip.end = Math.max(clip.end, line.end);
    }
    return clips.filter(clip => clip.end > clip.start);
  }

  async function getMarkedSong(id, starts) {
    try {
      const response = await apiFetch(`/api/song?song_id=${encodeURIComponent(id)}`);
      if (!response.ok) return null;
      const song = await response.json();
      const clips = collectClips(song, starts);
      return clips.length ? { id, title: song.title, artist: song.artist, clips } : null;
    } catch {
      return null;
    }
  }

  async function loadSongs() {
    const revision = ++loadRevision;
    const marks = readMarks();
    const loaded = [];
    for (let i = 0; i < marks.length; i += 8) {
      const batch = await Promise.all(marks.slice(i, i + 8).map(([id, starts]) => getMarkedSong(id, starts)));
      if (revision !== loadRevision) return;
      loaded.push(...batch.filter(Boolean));
    }
    if (revision !== loadRevision) return;
    songs = loaded;
    const current = songs.find(song => song.id === selected?.id) ?? songs[0] ?? null;
    if (current?.id !== selected?.id || JSON.stringify(current?.clips) !== JSON.stringify(selected?.clips)) {
      clipCursor = 0;
      message(seasons, 'reset-clips');
    }
    selected = current;
    showSongs();
  }

  const covers = new Map();
  if (readMarks().length) loadCovers();
  function loadCovers() {
    return apiFetch('/api/covers').then(response => response.json()).then(groups => {
      for (const group of groups) {
        for (const { song_id } of group.items) covers.set(song_id, group.file);
      }
    }).catch(() => {});
  }

  function drawTurn(progress) {
    const lift = Math.sin(Math.PI * progress);
    const drift = lift * (progress < .5 ? progress * 2 : (1 - progress) * 2);
    const outside = [0, 17, 34, 51, 68, 84, 100];
    const outline = edge => {
      const top = outside.map(x => `${edge(x)}% ${(lift * 2.15 * (x / 100) ** 2.6).toFixed(2)}%`);
      const bottom = outside.map(x => `${edge(x)}% ${(100 - lift * 4 * (x / 100) ** 2.6).toFixed(2)}%`).reverse();
      return `polygon(${[...top, ...bottom].join(',')})`;
    };
    leaf.style.transform = `rotateY(${-180 * progress}deg) rotateZ(${-2.25 * drift}deg) scaleX(${1 - .034 * lift})`;
    leaf.style.setProperty('--front-outline', outline(x => x));
    leaf.style.setProperty('--back-outline', outline(x => 100 - x));
    book.style.setProperty('--flex', lift.toFixed(3));
    book.style.setProperty('--shade-left', (.22 + .52 * progress).toFixed(3));
    book.style.setProperty('--shade-right', (.22 + .52 * (1 - progress)).toFixed(3));
  }

  function finish(target, moveFocus) {
    spread = target;
    book.dataset.spread = target;
    delete book.dataset.turning;
    leaf.removeAttribute('style');
    book.style.removeProperty('--flex');
    turning = false;
    pages.forEach(syncPage);
    if (moveFocus) {
      if (target === 'index') message(seasons, 'focus-clip');
      else record.contentWindow.JournalPlayer?.focus();
    }
  }

  function turnTo(target, moveFocus) {
    if (turning || spread === target) return;
    if (reducedMotion.matches) {
      finish(target, moveFocus);
      return;
    }
    turning = true;
    book.dataset.turning = '';
    pages.forEach(syncPage);
    const forwards = target === 'lyrics';
    const duration = 960;
    const start = performance.now();
    function animate(now) {
      const time = Math.min(1, (now - start) / duration);
      const motion = time * time * (3 - 2 * time);
      drawTurn(forwards ? motion : 1 - motion);
      if (time < 1 && !reducedMotion.matches) requestAnimationFrame(animate);
      else finish(target, moveFocus);
    }
    requestAnimationFrame(animate);
  }

  window.FavoritesJournal = {
    selectSong(id, clipIndex) {
      if (turning || spread !== 'index') return;
      const song = songs.find(item => item.id === id);
      if (!song) return;
      const nextCursor = Number.isInteger(clipIndex) && clipIndex >= 0 && clipIndex < song.clips.length ? clipIndex : 0;
      if (selected?.id === id && (clipIndex === undefined || clipCursor === nextCursor)) return;
      selected = song;
      clipCursor = nextCursor;
      void warmPage(record);
      void warmPage(garden);
      message(pond, 'selection', { selectedId: id });
      message(seasons, 'reset-clips');
    },
    nextClip() {
      if (!selected || turning || spread !== 'index') return null;
      const index = clipCursor++ % selected.clips.length;
      return { songId: selected.id, index, lines: selected.clips[index].lines };
    },
    playClip({ songId, index }, moveFocus) {
      function open() {
        if (turning || spread !== 'index' || selected?.id !== songId || !selected.clips[index]) return;
        const player = record.contentWindow.JournalPlayer;
        if (!player) return;
        currentSongId = songId;
        heartTab = 'lyrics';
        syncHeartTabs(false);
        void warmPage(garden);
        player.open(selected, index, covers.get(songId));
        broadcastSongNote(songId);
        turnTo('lyrics', moveFocus);
      }
      if (record.contentWindow.JournalPlayer) open();
      else void warmPage(record).then(open);
    },
    showClipLyrics(lines) {
      clipLyrics = lines;
      message(garden, 'clip-lyrics', { lines });
    },
    setHeartTab(tab, focus = false) {
      setHeartTab(tab, focus);
    },
    openNotes() {
      setHeartTab('notes', true);
    },
    getSongNote(songId) {
      return getSongNote(songId);
    },
    saveSongNote(songId, text) {
      if (!songId) return '';
      const value = String(text ?? '');
      const map = readSongNotesMap();
      if (value.trim()) map[songId] = value;
      else delete map[songId];
      writeSongNotesMap(map);
      return value;
    },
    back(moveFocus) {
      if (turning || spread !== 'lyrics') return;
      record.contentWindow.JournalPlayer?.leave();
      turnTo('index', moveFocus);
    },
    clearFavorites() {
      try { localStorage.removeItem(favoritesKey); } catch { /* ignore */ }
      loadRevision++;
      songs = [];
      selected = null;
      currentSongId = null;
      clipLyrics = [];
      if (spread === 'lyrics') {
        record.contentWindow?.JournalPlayer?.stop();
        turnTo('index', false);
      }
      message(seasons, 'reset-clips');
      message(garden, 'clip-lyrics', { lines: [] });
      showSongs();
    },
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.FavoritesJournal.back(true);
  });
  window.addEventListener('storage', event => {
    if (event.key !== favoritesKey && event.key !== null) return;
    void loadSongs();
    if (!covers.size && readMarks().length) void loadCovers();
  });
  window.addEventListener('pagehide', () => record.contentWindow.JournalPlayer?.stop());
  void loadSongs();
})();
