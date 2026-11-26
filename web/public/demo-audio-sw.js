// 仅在演示版注册：给 /audio/*.mp3 补上 Range 支持。
// 静态托管若不支持断点请求，浏览器会把音频标记为不可 seek，收藏册的片段播放就无法定位。
const CACHE = 'mizi-demo-audio-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/audio/')) return;
  event.respondWith(respond(event.request, url));
});

async function fullBody(url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url.pathname);
  if (hit) return hit.arrayBuffer();
  const response = await fetch(url.pathname);
  if (!response.ok) return null;
  await cache.put(url.pathname, response.clone());
  return response.arrayBuffer();
}

async function respond(request, url) {
  const body = await fullBody(url).catch(() => null);
  if (!body) return fetch(request);
  const total = body.byteLength;
  const headers = new Headers({
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  });
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(total));
    return new Response(null, { status: 200, headers });
  }
  const range = request.headers.get('range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    // 媒体元素的首个请求通常不带 Range；直接给 206，浏览器才会把整段标为可 seek。
    headers.set('Content-Range', `bytes 0-${total - 1}/${total}`);
    headers.set('Content-Length', String(total));
    return new Response(body, { status: 206, headers });
  }
  let start = match[1] === '' ? NaN : Number(match[1]);
  let end = match[2] === '' ? NaN : Number(match[2]);
  if (Number.isNaN(start)) {
    start = Math.max(0, total - (Number.isNaN(end) ? 0 : end));
    end = total - 1;
  } else if (Number.isNaN(end) || end >= total) {
    end = total - 1;
  }
  if (start >= total || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
