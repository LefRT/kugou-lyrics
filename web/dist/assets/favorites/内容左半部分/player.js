const player = document.querySelector(".player");
const audio = document.querySelector("#audio");
const seek = document.querySelector("#seek");
const elapsed = document.querySelector("#elapsed");
const duration = document.querySelector("#duration");
const cover = document.querySelector(".cover");
const title = document.querySelector("#track-title");
const artist = document.querySelector("#track-artist");
const status = document.querySelector("#status");
const record = document.querySelector(".record-button");
const play = document.querySelector(".play");
const previous = document.querySelector(".previous");
const next = document.querySelector(".next");
const repeat = document.querySelector(".repeat");
const lamp = document.querySelector(".lamp");
const favorite = document.querySelector(".favorite");
const queueButton = document.querySelector(".queue");
const commentButton = document.querySelector(".comments");
const shareButton = document.querySelector(".share");
const tracks = document.querySelector("#tracks");
const messages = document.querySelector("#messages");
const commentForm = document.querySelector("#comment-form");
const commentText = document.querySelector("#comment-text");

const journalMode = document.documentElement.dataset.journal === "player";
const demoAudioFor = songId => {
  try {
    const pick = window.top?.__miziDemoAudioFor;
    return (typeof pick === "function" ? pick(songId) : "") || window.top?.__miziDemoAudio || "";
  } catch {
    return "";
  }
};
const playlist = journalMode ? [] : [{
  title: title.textContent,
  artist: artist.textContent,
  label: "特别的人 · 界面演示音频",
  source: null,
  duration: 259,
}];

let trackIndex = 0;
let pendingTime = 66;
let openSlip = null;
let openTrigger = null;
let clipSelection = 0;
let currentSongId = journalMode ? null : "demo";
let editingNoteId = null;
const clipPlayback = journalMode ? window.createJournalClipPlayback(audio, {
  update() {
    renderTime();
    renderPlayback();
  },
  end() {},
  error() {
    status.textContent = audioErrorText("无法播放这段音频。");
  },
}) : null;

function audioErrorText(fallback) {
  try {
    if (window.top?.__miziDemoEnabled) return "公网演示版不含音频，本机运行 kg_web.py 可播放原曲。";
  } catch {
    // 跨域读取 top 失败时按普通错误处理。
  }
  return fallback;
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  const minutes = String(Math.floor(whole / 60)).padStart(2, "0");
  const remainder = String(whole % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function renderTime() {
  const length = clipPlayback ? clipPlayback.duration
    : Number.isFinite(audio.duration) ? audio.duration : playlist[trackIndex].duration;
  const time = clipPlayback ? clipPlayback.position : pendingTime ?? audio.currentTime;
  seek.max = clipPlayback ? length || 1 : Math.max(1, length);
  seek.value = time;
  seek.disabled = !length;
  seek.setAttribute("aria-valuetext", `${Math.floor(time / 60)} 分 ${Math.floor(time % 60)} 秒`);
  player.style.setProperty("--played", length ? Math.min(time / length * 100, 100) : 0);
  elapsed.textContent = formatTime(time);
  duration.textContent = formatTime(length);
}

function jumpTo(time) {
  if (clipPlayback) {
    clipPlayback.seek(time);
    return;
  }
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    audio.currentTime = Math.min(time, audio.duration);
    pendingTime = null;
  } else {
    pendingTime = time;
  }
  renderTime();
}

function renderPlayback() {
  const playing = clipPlayback ? clipPlayback.active : !audio.paused && !audio.ended;
  player.classList.toggle("is-playing", playing);
  play.setAttribute("aria-label", playing ? "暂停" : "播放");
  record.setAttribute("aria-label", playing ? "暂停唱片" : "播放唱片");
}

async function loadDemo() {
  let source = audio.dataset.src;
  if (location.protocol !== "file:") {
    // 用完整的音频支持定位进度，兼容只返回完整文件的静态服务。
    try {
      const response = await fetch(source);
      if (response.ok) {
        const data = await response.arrayBuffer();
        source = URL.createObjectURL(new Blob([data], { type: "audio/mpeg" }));
      }
    } catch {
      // 保留浏览器直接加载音频的路径。
    }
  }
  playlist[0].source = source;
  if (trackIndex === 0) audio.src = source;
}

async function startPlayback() {
  const index = trackIndex;
  status.textContent = "";
  if (clipPlayback) {
    clipPlayback.play();
    return;
  }
  try {
    if (index === 0) await demoReady;
    if (trackIndex !== index) return;
    await audio.play();
  } catch (error) {
    if (error.name !== "AbortError") status.textContent = audioErrorText("无法播放这段音频，请从播放列表选择其他音频。");
  }
}

function togglePlayback() {
  if (clipPlayback) {
    if (clipPlayback.active) void clipPlayback.pause();
    else startPlayback();
    return;
  }
  if (audio.paused || audio.ended) startPlayback();
  else audio.pause();
}

function selectTrack(index, shouldPlay) {
  const track = playlist[index];
  if (clipPlayback) {
    const selection = ++clipSelection;
    const select = () => {
      if (selection !== clipSelection || !track) return;
      trackIndex = index;
      title.textContent = track.title;
      artist.textContent = track.artist;
      status.textContent = "";
      clipPlayback.load(track);
      syncClipLyrics();
      if (shouldPlay) startPlayback();
    };
    if (clipPlayback.active) void clipPlayback.pause().then(select);
    else select();
    return;
  }
  if (index !== trackIndex) {
    trackIndex = index;
    pendingTime = 0;
    title.textContent = track.title;
    artist.textContent = track.artist;
    if (track.source) audio.src = track.source;
    else {
      audio.removeAttribute("src");
      audio.load();
    }
    renderQueue();
    renderTime();
  } else {
    jumpTo(0);
  }
  status.textContent = "";
  if (shouldPlay) startPlayback();
}

function stepTrack(direction) {
  if (!playlist.length) return;
  const index = (trackIndex + direction + playlist.length) % playlist.length;
  selectTrack(index, journalMode || !audio.paused);
}

function syncClipLyrics() {
  const lines = playlist[trackIndex]?.lines ?? [];
  window.JournalPage.favorites?.showClipLyrics(lines);
}

function renderQueue() {
  tracks.replaceChildren(...playlist.map((track, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "queue-track";
    button.textContent = track.label;
    if (index === trackIndex) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      selectTrack(index, true);
      closeSlip();
    });
    item.append(button);
    return item;
  }));
}

function closeSlip(restoreFocus = true) {
  if (!openSlip) return;
  openSlip.hidden = true;
  openTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) openTrigger.focus();
  openSlip = null;
  openTrigger = null;
}

function toggleSlip(trigger, focusTarget) {
  const panel = document.getElementById(trigger.getAttribute("aria-controls"));
  if (panel === openSlip) {
    closeSlip();
    return;
  }
  closeSlip(false);
  openSlip = panel;
  openTrigger = trigger;
  panel.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  (focusTarget ?? panel.querySelector(".close-slip")).focus();
}

function readSaved(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`paper-record:${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(`paper-record:${key}`, JSON.stringify(value));
  } catch {
    // File URLs and privacy settings can prevent storage.
  }
}

function clearLegacyNotes() {
  try {
    localStorage.removeItem("paper-record:notes");
  } catch {
    // Ignore storage access errors.
  }
}

clearLegacyNotes();

function readSongNotesMap() {
  const saved = readSaved("song-notes", {});
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

function getCurrentNotes() {
  if (!currentSongId) return [];
  const api = window.JournalPage?.favorites;
  if (api?.getSongNotes) return api.getSongNotes(currentSongId);
  const list = readSongNotesMap()[currentSongId];
  return Array.isArray(list) ? list : [];
}

function addCurrentNote(text) {
  if (!currentSongId) return;
  const api = window.JournalPage?.favorites;
  if (api?.addSongNote) {
    api.addSongNote(currentSongId, text);
    return;
  }
  const map = readSongNotesMap();
  const list = Array.isArray(map[currentSongId]) ? map[currentSongId] : [];
  map[currentSongId] = [...list.slice(-39), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text }];
  save("song-notes", map);
  renderMessages(map[currentSongId]);
}

function updateCurrentNote(id, text) {
  if (!currentSongId) return;
  const api = window.JournalPage?.favorites;
  if (api?.updateSongNote) {
    api.updateSongNote(currentSongId, id, text);
    return;
  }
  const map = readSongNotesMap();
  const list = Array.isArray(map[currentSongId]) ? map[currentSongId] : [];
  map[currentSongId] = list.map(item => (item.id === id ? { ...item, text } : item));
  save("song-notes", map);
  renderMessages(map[currentSongId]);
}

function deleteCurrentNote(id) {
  if (!currentSongId) return;
  const api = window.JournalPage?.favorites;
  if (api?.deleteSongNote) {
    api.deleteSongNote(currentSongId, id);
    return;
  }
  const map = readSongNotesMap();
  const list = Array.isArray(map[currentSongId]) ? map[currentSongId] : [];
  map[currentSongId] = list.filter(item => item.id !== id);
  save("song-notes", map);
  renderMessages(map[currentSongId]);
}

function renderMessages(notes) {
  if (!notes.length) {
    const empty = document.createElement("li");
    empty.className = "notes-empty";
    empty.textContent = "这首歌还没有留言";
    messages.replaceChildren(empty);
    return;
  }
  messages.replaceChildren(...notes.map(note => {
    const item = document.createElement("li");
    item.className = "note-item";
    if (editingNoteId === note.id) {
      const form = document.createElement("form");
      form.className = "note-edit-form";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "note-edit-input";
      input.maxLength = 100;
      input.required = true;
      input.value = note.text;
      const saveBtn = document.createElement("button");
      saveBtn.type = "submit";
      saveBtn.className = "note-btn";
      saveBtn.textContent = "保存";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "note-btn";
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => {
        editingNoteId = null;
        renderMessages(getCurrentNotes());
      });
      input.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          editingNoteId = null;
          renderMessages(getCurrentNotes());
        }
      });
      form.addEventListener("submit", event => {
        event.preventDefault();
        const nextText = input.value.trim();
        if (!nextText) return;
        editingNoteId = null;
        updateCurrentNote(note.id, nextText);
      });
      form.append(input, saveBtn, cancelBtn);
      item.append(form);
      queueMicrotask(() => { input.focus(); input.select(); });
      return item;
    }

    const body = document.createElement("span");
    body.className = "note-body";
    body.textContent = note.text;

    const actions = document.createElement("span");
    actions.className = "note-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "note-btn";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => {
      editingNoteId = note.id;
      renderMessages(getCurrentNotes());
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "note-btn note-btn--del";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      if (editingNoteId === note.id) editingNoteId = null;
      deleteCurrentNote(note.id);
    });

    actions.append(editBtn, delBtn);
    item.append(body, actions);
    return item;
  }));
}

let liked = readSaved("liked", true);

audio.addEventListener("loadedmetadata", () => {
  if (clipPlayback) renderTime();
  else jumpTo(pendingTime ?? audio.currentTime);
});
audio.addEventListener("timeupdate", renderTime);
audio.addEventListener("durationchange", renderTime);
audio.addEventListener("play", renderPlayback);
audio.addEventListener("pause", renderPlayback);
audio.addEventListener("emptied", renderPlayback);
audio.addEventListener("ended", () => {
  renderPlayback();
  if (!clipPlayback && trackIndex < playlist.length - 1) selectTrack(trackIndex + 1, true);
});
audio.addEventListener("error", () => {
  renderPlayback();
  if (!clipPlayback) status.textContent = audioErrorText("无法读取这段音频。");
});

seek.addEventListener("input", () => jumpTo(Number(seek.value)));
play.addEventListener("click", togglePlayback);
record.addEventListener("click", togglePlayback);
previous.addEventListener("click", () => stepTrack(-1));
next.addEventListener("click", () => stepTrack(1));
if (repeat) {
  repeat.addEventListener("click", () => {
    const loop = repeat.getAttribute("aria-pressed") !== "true";
    if (!clipPlayback) audio.loop = loop;
    repeat.setAttribute("aria-pressed", String(loop));
  });
}
lamp.addEventListener("click", () => {
  lamp.setAttribute("aria-pressed", String(!player.classList.toggle("is-dim")));
});
favorite.addEventListener("click", () => {
  liked = !liked;
  favorite.setAttribute("aria-pressed", String(liked));
  save("liked", liked);
});

if (!journalMode) {
  if (queueButton) queueButton.addEventListener("click", () => toggleSlip(queueButton));
  commentButton.addEventListener("click", () => toggleSlip(commentButton, commentText));
}
document.querySelectorAll(".close-slip").forEach(button => {
  button.addEventListener("click", () => closeSlip());
});
document.addEventListener("click", event => {
  if (openSlip && !openSlip.contains(event.target) && !openTrigger.contains(event.target)) closeSlip(false);
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (openSlip) closeSlip();
  else if (journalMode) window.JournalPage.favorites?.back(true);
});
commentForm.addEventListener("submit", event => {
  event.preventDefault();
  const text = commentText.value.trim();
  if (!text) return;
  editingNoteId = null;
  addCurrentNote(text);
  commentForm.reset();
  commentText.focus();
});
window.addEventListener("journal:song-notes", ({ detail }) => {
  if (!detail || detail.songId !== currentSongId) return;
  renderMessages(detail.notes ?? []);
});
document.querySelector("#audio-files").addEventListener("change", event => {
  for (const file of event.target.files) {
    const name = file.name.replace(/\.[^.]+$/, "");
    playlist.push({ title: name, artist: "", label: name, source: URL.createObjectURL(file), duration: 0 });
  }
  event.target.value = "";
  renderQueue();
});

favorite.setAttribute("aria-pressed", String(liked));
renderMessages(getCurrentNotes());
if (!journalMode) renderQueue();
const demoReady = journalMode ? null : loadDemo();
if (clipPlayback) {
  const back = document.querySelector(".journal-back");
  back.hidden = false;
  back.addEventListener("click", event => window.JournalPage.favorites?.back(!event.detail));
  commentButton.removeAttribute("aria-controls");
  commentButton.removeAttribute("aria-expanded");
  commentButton.addEventListener("click", () => {
    window.JournalPage.favorites?.openNotes?.();
  });
  if (shareButton) {
    shareButton.addEventListener("click", async () => {
      if (!currentSongId || shareButton.getAttribute("aria-busy") === "true") return;
      try {
        if (window.top?.__miziDemoEnabled) {
          status.textContent = "演示版不支持导出歌词页，请在本机运行 kg_web.py。";
          return;
        }
      } catch { /* ignore */ }
      shareButton.setAttribute("aria-busy", "true");
      status.textContent = "正在生成分享页…";
      try {
        let favStarts = [];
        try {
          const all = JSON.parse(localStorage.getItem("kg-fav-lines") || "{}");
          if (Array.isArray(all[currentSongId])) favStarts = all[currentSongId].filter(Number.isFinite);
        } catch { /* ignore */ }
        const qs = new URLSearchParams({ song_id: currentSongId });
        if (favStarts.length) qs.set("favs", favStarts.join(","));
        const resp = await fetch(`/api/song/share?${qs.toString()}`, { cache: "no-store" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          status.textContent = err.error || "导出分享页失败，请重试。";
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const name = [title.textContent, artist.textContent].filter(Boolean).join(" - ") || "lyric-share";
        link.href = url;
        link.download = `${name.replace(/[<>:"/\\|?*]/g, "_")}.html`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        status.textContent = "";
      } catch {
        status.textContent = "导出分享页失败，请重试。";
      } finally {
        shareButton.removeAttribute("aria-busy");
      }
    });
  }
  cover.addEventListener("error", () => { cover.hidden = true; });
  previous.setAttribute("aria-label", "上一个片段");
  next.setAttribute("aria-label", "下一个片段");
  seek.step = .01;
  window.JournalPlayer = {
    open(song, index, coverFile) {
      currentSongId = song.id;
      editingNoteId = null;
      const source = demoAudioFor(song.id) || `/api/song/stream?song_id=${encodeURIComponent(song.id)}`;
      const { title, artist } = song;
      playlist.splice(0, playlist.length, ...song.clips.map(clip => ({
        title, artist, source,
        lines: clip.lines,
        start: clip.start / 1000,
        end: clip.end / 1000,
      })));
      previous.disabled = next.disabled = playlist.length < 2;
      cover.hidden = !coverFile;
      if (coverFile) cover.src = `/covers/${encodeURIComponent(coverFile)}`;
      else cover.removeAttribute("src");
      renderMessages(getCurrentNotes());
      selectTrack(index, true);
    },
    focus() { back.focus({ preventScroll: true }); },
    leave() {
      clipSelection++;
      editingNoteId = null;
      closeSlip(false);
      void clipPlayback.pause();
    },
    stop() {
      clipSelection++;
      clipPlayback.stop();
    },
  };
  window.addEventListener("pagehide", window.JournalPlayer.stop);
  renderTime();
} else if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) jumpTo(pendingTime);
else renderTime();
