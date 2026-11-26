// 公网演示版：构建时带 VITE_DEMO=1 才启用。
// 拦截本页的 /api/* 请求，返回标注清楚的示例数据；不联网、不读本地歌词库、不带音频。
export const demoEnabled = import.meta.env.VITE_DEMO === '1';

// 公版录音（Wikimedia Commons，Public domain，美国军乐队/合唱团）：帕赫贝尔《卡农》（空军乐队）、
// 布吕克纳《圣母颂》（海军 Sea Chanters）、Shenandoah 与美国颂（空军 Singing Sergeants）。
// 每首截取 62 秒并淡出。
const AUDIO_TRACKS = {
  canon: '/audio/pachelbel-canon.mp3',
  aveMaria: '/audio/ave-maria.mp3',
  shenandoah: '/audio/shenandoah.mp3',
  america: '/audio/america-the-beautiful.mp3',
} as const;

// 按 demo 歌曲顺序排布，尽量贴合各自的气质。
const SONG_AUDIO = [
  'canon', 'aveMaria', 'aveMaria', 'shenandoah', 'shenandoah', 'canon', 'aveMaria',
  'shenandoah', 'aveMaria', 'america', 'canon', 'america', 'shenandoah', 'aveMaria',
] as const;

interface DemoSong { id: string; title: string; artist: string; lines: string[] }

const SONGS: DemoSong[] = [
  { id: 'demo-01', title: '风过旧桥', artist: '林间电台', lines: [
    '风从旧桥那边吹过来', '吹动你衣袖上的褶皱', '我把名字写进桥栏的霜里', '等一个夏天慢慢经过',
    '桥下的水替我说了', '那些没能寄出的话', '风过旧桥 你也正好回头',
  ] },
  { id: 'demo-02', title: '海的一半', artist: '南岸少年', lines: [
    '海的一半是浪 一半是灯', '我在灯塔下数你的回声', '风把船歌卷成一行字', '搁浅在手掌的纹路里',
    '如果你听见潮水退去', '那是我把想念轻轻放回海里',
  ] },
  { id: 'demo-03', title: '星子落在琴上', artist: '苏禾', lines: [
    '夜里有人把星子落在琴上', '每一个音都亮成一盏小灯', '我数到第七颗就想起你', '想起那年夏天很轻的风',
    '星子落在琴上 也落在心上', '我们隔着一首曲子说话',
  ] },
  { id: 'demo-04', title: '把春天寄给你', artist: '白露乐队', lines: [
    '我把春天叠成一只纸船', '顺着雨后的街角寄给你', '信封里放了一片新叶', '和一句没有说完的话',
    '若你也听见花开的声音', '就当我站在你的门口',
  ] },
  { id: 'demo-05', title: '念旧的人', artist: '陈小舟', lines: [
    '念旧的人总把窗留着', '等一阵风把旧时光吹回来', '桌上的信纸换了新颜色', '字迹还停在从前的夏天',
    '我不急着把灯关掉', '怕你回来找不到路',
  ] },
  { id: 'demo-06', title: '纸上的远方', artist: '无声诗笺', lines: [
    '远方是未曾抵达的地方', '也是心里的一束光', '我把地图折成一只鸟', '让它替我飞过山与海',
    '你读到这里 春天就到了', '愿你看见的天空都有飞鸟',
  ] },
  { id: 'demo-07', title: '四季来信', artist: '慢慢走乐队', lines: [
    '春寄来一树细小的花', '夏寄来一整片海', '秋天把思念染成金色', '冬天附上一片雪',
    '四季轮流替我写信', '每一封都写到你的名字',
  ] },
  { id: 'demo-08', title: '桥上的黄昏', artist: '林间电台', lines: [
    '黄昏落在桥的肩上', '把影子拉得很长', '风把一天的故事收好', '放进远处的灯里',
    '我在桥上站了一会儿', '等夜色慢慢把桥点亮',
  ] },
  { id: 'demo-09', title: '雪落无声', artist: '苏禾', lines: [
    '雪落在没有名字的街', '落进你走后的那段空白', '我把围巾绕得更紧', '像留住你留下的温度',
    '雪落无声 心却有声', '每一片都在说想你',
  ] },
  { id: 'demo-10', title: '长风过境', artist: '白露乐队', lines: [
    '长风过境 吹散一场雨', '我在窗边替你收好晴天', '纸条上的字被风翻动', '像有人在轻轻喊我',
    '如果你也抬头看云', '我们就算见过一面',
  ] },
  { id: 'demo-11', title: '灯下读信', artist: '陈小舟', lines: [
    '灯下读一封旧信', '读到一半就笑了', '那些认真写下的字', '还在纸上发着光',
    '我把灯留到很晚', '等一个很久以前的晚安',
  ] },
  { id: 'demo-12', title: '雨后的海', artist: '南岸少年', lines: [
    '雨停之后海更蓝了', '云把光还给了浪', '我沿着堤岸慢慢走', '脚步惊起一群海鸟',
    '如果你也在看海', '就当我们在同一个下午',
  ] },
  { id: 'demo-13', title: '候鸟的地址', artist: '林间电台', lines: [
    '候鸟记得很远的地方', '我只记得你家的窗', '风每年都会捎来消息', '说你那里也正好是春天',
    '我把地址写进一首歌', '托候鸟年年带回',
  ] },
  { id: 'demo-14', title: '把星子别在衣襟', artist: '慢慢走乐队', lines: [
    '夜里出门带上一点风', '把星子别在衣襟上', '走过桥 走过旧街', '心里装着一盏不灭的灯',
    '等你回头的时候', '满天都是说给你的话',
  ] },
];

export const demoAudioFor = (songId: string) => {
  const index = SONGS.findIndex(song => song.id === songId);
  return AUDIO_TRACKS[SONG_AUDIO[index < 0 ? 0 : index] ?? 'canon'];
};

export const songStreamSrc = (songId: string) => demoEnabled
  ? demoAudioFor(songId)
  : `/api/song/stream?song_id=${encodeURIComponent(songId)}`;

const COVER_FILES = ['demo-01.webp', 'demo-02.webp', 'demo-03.webp', 'demo-04.webp', 'demo-05.webp', 'demo-06.webp'];
const WORD_LIST = ['风', '桥', '海', '春', '星', '念'];
const PAGE_SIZE = 8;

const covers = (() => {
  const groups = COVER_FILES.map(file => ({ file, items: [] as { song_id: string; title: string }[] }));
  SONGS.forEach((song, index) => groups[index % groups.length].items.push({ song_id: song.id, title: song.title }));
  return groups;
})();

const timelineOf = (song: DemoSong) => song.lines.map((text, i) => ({
  start: 14000 + i * 5000,
  end: 14000 + i * 5000 + 4400,
  text,
}));

const durationOf = (song: DemoSong) => 14000 + (song.lines.length - 1) * 5000 + 8000;

/** 关键词出现次数与所在行的起始时间；英文按小写比较，中文原样。 */
const occurrencesOf = (song: DemoSong, kw: string) => {
  if (!kw) return [];
  const needle = kw.toLowerCase();
  const out: { start_ms: number; text: string; approx: boolean }[] = [];
  song.lines.forEach((line, i) => {
    const hay = line.toLowerCase();
    let from = hay.indexOf(needle);
    while (from >= 0) {
      out.push({ start_ms: 14000 + i * 5000, text: line, approx: false });
      from = hay.indexOf(needle, from + needle.length);
    }
  });
  return out;
};

const paged = <T>(items: T[], page: number) => {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return { total: items.length, page: current, pages, items: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE) };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

const tasks = [
  {
    id: 'task-demo-3', word: '海', status: 'done', created: '2026-11-24T21:15:00', total_songs: 3, processed: 3,
    segments: 3, total_ms: 78000, meta_id: '海', error: null, phase: null, work_available: true, video_export: null,
  },
  {
    id: 'task-demo-2', word: '桥', status: 'error', created: '2026-11-23T19:42:00', total_songs: 3, processed: 2,
    segments: 0, total_ms: 0, meta_id: null, error: '有 1 首歌未取到音源（VIP），已跳过', phase: null,
    work_available: false, video_export: null,
  },
  {
    id: 'task-demo-1', word: '风', status: 'done', created: '2026-11-22T20:08:00', total_songs: 5, processed: 5,
    segments: 5, total_ms: 126000, meta_id: '风', error: null, phase: null, work_available: true, video_export: null,
  },
];

const previewSongs = (word: string) => SONGS
  .map(song => ({ song_id: song.id, title: song.title, artist: song.artist, occurrences: occurrencesOf(song, word).length }))
  .filter(song => song.occurrences > 0)
  .sort((a, b) => b.occurrences - a.occurrences);

const route = (url: URL, method: string, body: unknown): Response => {
  const path = url.pathname;
  const q = url.searchParams.get('q') ?? url.searchParams.get('kw') ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);

  if (path === '/api/stats') return json({ total: SONGS.length });
  if (path === '/api/covers') return json(covers);
  if (path === '/api/mashups') return json(WORD_LIST.map(word => {
    const hits = previewSongs(word).length;
    return { id: word, word, count: hits, total_ms: hits * 26000 };
  }).filter(work => work.count > 0));

  if (path === '/api/songs') {
    const needle = q.trim().toLowerCase();
    const list = SONGS
      .filter(song => !needle || song.title.toLowerCase().includes(needle) || song.artist.toLowerCase().includes(needle))
      .map(song => ({ song_id: song.id, title: song.title, artist: song.artist, duration_ms: durationOf(song) }));
    return json(paged(list, page));
  }

  if (path === '/api/lyric') {
    const list = SONGS
      .map(song => ({ song, matches: occurrencesOf(song, q).length }))
      .filter(entry => entry.matches > 0)
      .map(({ song, matches }) => ({
        song_id: song.id, title: song.title, artist: song.artist, duration_ms: durationOf(song), matches,
      }));
    return json(paged(list, page));
  }

  if (path === '/api/lyric/semantic') {
    const asked = String((body as { q?: string } | null)?.q ?? '').trim();
    const results = previewSongs(asked).slice(0, 6).map(song => {
      const detail = SONGS.find(item => item.id === song.song_id)!;
      const occ = occurrencesOf(detail, asked);
      return {
        song_id: song.song_id, title: song.title, artist: song.artist,
        reason: '示例数据：按歌词原句匹配，未做语义复核。',
        evidence: occ.slice(0, 2).map(item => ({ text: item.text, start_ms: item.start_ms })),
        clip: occ.length ? { start_ms: occ[0].start_ms, end_ms: occ[0].start_ms + 12000 } : null,
      };
    });
    return json({ results, mode: 'literal', warnings: ['公网演示版没有接入语义模型'], constraints_pending: false });
  }

  if (path === '/api/song') {
    const song = SONGS.find(item => item.id === url.searchParams.get('song_id'));
    if (!song) return json({ error: '找不到这首歌' }, 404);
    return json({
      song_id: song.id, title: song.title, artist: song.artist, duration_ms: durationOf(song),
      playlist: '示例歌单', lyrics_text: song.lines.join('\n'), timeline: { lines: timelineOf(song) },
    });
  }
  if (path === '/api/occ') {
    const song = SONGS.find(item => item.id === url.searchParams.get('song_id'));
    if (!song) return json({ error: '找不到这首歌' }, 404);
    const occurrences = occurrencesOf(song, q);
    return json({ occurrences, count: occurrences.length });
  }
  if (path === '/api/song/climax') return json({ climax: null });
  if (path === '/api/song/url') return json({ url: demoAudioFor(url.searchParams.get('song_id') ?? '') });
  if (path === '/api/song/stream') {
    return json({ error: '演示版直接用公版录音 /audio/pachelbel-canon.mp3' }, 404);
  }

  if (path === '/api/mashup/preview') return json({ songs: previewSongs(url.searchParams.get('word') ?? '') });
  if (path === '/api/mashup/songcheck') {
    const word = url.searchParams.get('word') ?? '';
    const found = previewSongs(word).find(song => song.song_id === url.searchParams.get('song_id'));
    return found ? json(found) : json({ error: '查不到这首歌' }, 404);
  }
  if (path === '/api/mashup/songclip') {
    const word = url.searchParams.get('word') ?? '';
    const song = SONGS.find(item => item.id === url.searchParams.get('song_id'));
    const first = song ? occurrencesOf(song, word)[0] : undefined;
    if (!first) return json({ error: '这首歌没有可试听的片段' }, 404);
    return json({ start_ms: first.start_ms, end_ms: first.start_ms + 12000 });
  }
  if (path === '/api/mashup/create') {
    return json({ error: '公网演示版只展示选歌流程，不执行音频制作；请在本机运行 kg_web.py 体验完整流程。' }, 400);
  }
  if (path === '/api/mashup/tasks') return json(tasks);
  if (path === '/api/mashup/task' || path === '/api/mashup/task/cancel') return json({ ok: true });
  if (path === '/api/mashup/video' || path.startsWith('/api/mashup/video/')) {
    return json({ error: '公网演示版不导出视频。' }, 404);
  }
  if (path === '/api/mashup') {
    if (method === 'DELETE') return json({ ok: true });
    return json({ error: '演示版没有内置这份作品' }, 404);
  }

  return json({ error: '演示版接口未实现' }, 404);
};

const installApi = () => {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL;
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    } catch {
      return realFetch(input, init);
    }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    return Promise.resolve(route(url, method, body));
  };
};

/** 收藏册 iframe 有自己的 fetch，通过 window 上的这个入口拿到同一套示例数据。 */
const demoFetch = (input: string): Promise<Response> => {
  try {
    const url = new URL(input, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(route(url, 'GET', null));
    }
  } catch { /* 交给真实 fetch */ }
  return window.fetch(input);
};

const seedJournal = () => {
  try {
    if (localStorage.getItem('kg-fav-lines') === null) {
      localStorage.setItem('kg-fav-lines', JSON.stringify({
        'demo-01': [39000],
        'demo-03': [14000, 24000],
        'demo-07': [19000, 34000],
      }));
    }
    if (localStorage.getItem('paper-record:song-notes') === null) {
      localStorage.setItem('paper-record:song-notes', JSON.stringify({
        'demo-07': '读到夏天那一句，想起小时候的海。',
      }));
    }
  } catch { /* 隐私模式写不进去就留空 */ }
};

const installBadge = () => {
  const style = document.createElement('style');
  style.textContent = `
    .demo-badge{position:fixed;left:16px;bottom:14px;z-index:90;max-width:min(78vw,420px);
      padding:6px 10px;border:1px solid currentColor;background:var(--bg,#fff);color:var(--ink,#111);
      font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;opacity:.82;pointer-events:none}
    .demo-badge b{font-weight:700}
    body.paper-mode .demo-badge{display:none}`;
  document.head.append(style);
  const badge = document.createElement('div');
  badge.className = 'demo-badge';
  badge.innerHTML = '<b>演示数据</b> · 示例音频为公版古典录音 · 本机运行 kg_web.py 接入真实歌词库';
  document.body.append(badge);
};

declare global {
  interface Window {
    __miziDemoFetch?: (input: string) => Promise<Response>;
    __miziDemoEnabled?: boolean;
    __miziDemoAudioFor?: (songId: string) => string;
  }
}

if (demoEnabled) {
  installApi();
  seedJournal();
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/demo-audio-sw.js', { scope: '/' }).catch(() => {});
  }
  window.__miziDemoFetch = demoFetch;
  window.__miziDemoEnabled = true;
  window.__miziDemoAudioFor = demoAudioFor;
  if (document.body) installBadge();
  else document.addEventListener('DOMContentLoaded', installBadge, { once: true });
}

/** 演示版没有作品音频，合成作品统一进入无声的「四季来信」舞台；单曲用公版录音正常进舞台。 */
export const mashupHref = (id: string) => demoEnabled
  ? `${location.pathname}?stage=paper`
  : `/?mashup=${encodeURIComponent(id)}`;

export const songStageHref = (songId: string) => `/?song=${encodeURIComponent(songId)}`;
