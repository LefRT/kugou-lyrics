(() => {
  'use strict';

  const page = new URLSearchParams(location.search).get('journal');
  if (window.parent === window || !['seasons', 'pond', 'player', 'dedication'].includes(page)) return;

  document.documentElement.dataset.journal = page;
  const channel = 'lyrics-journal';

  window.JournalPage = {
    get favorites() { return window.parent.FavoritesJournal; },
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.channel !== channel) return;
    const { type, visible, selectedId, lines, note, songId, tab, focus } = event.data;
    if (type === 'visibility') window.dispatchEvent(new CustomEvent('journal:visibility', { detail: visible }));
    if (type === 'songs') window.dispatchEvent(new CustomEvent('journal:songs', { detail: event.data }));
    if (type === 'selection') window.dispatchEvent(new CustomEvent('journal:selection', { detail: selectedId }));
    if (type === 'reset-clips') window.dispatchEvent(new Event('journal:reset-clips'));
    if (type === 'focus-clip') window.dispatchEvent(new Event('journal:focus-clip'));
    if (type === 'clip-lyrics') window.dispatchEvent(new CustomEvent('journal:clip-lyrics', { detail: lines }));
    if (type === 'song-note') window.dispatchEvent(new CustomEvent('journal:song-note', { detail: { songId, note } }));
    if (type === 'heart-tab') window.dispatchEvent(new CustomEvent('journal:heart-tab', { detail: { tab, focus: Boolean(focus) } }));
  });
})();
