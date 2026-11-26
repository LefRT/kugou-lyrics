export function retryStreamSrc(src: string): string {
  if (!src.startsWith('/api/song/stream?')) return src;
  const clean = src.replace(/[&?]_r=\d+/, '');
  return `${clean}&_r=${Date.now()}`;
}

export async function songPlaybackError(songId: string): Promise<string> {
  try {
    const response = await fetch(`/api/song/url?song_id=${encodeURIComponent(songId)}&diag=1`, { cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      if (data.error) return data.error;
    }
  } catch { /* 音频服务不可用时使用通用提示 */ }
  return '音频暂时无法播放，请重试。';
}
