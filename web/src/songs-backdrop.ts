import songsTreeUrl from './assets/songs-tree.webp';
import { mountTreeBackdrop } from './tree-backdrop';

export function mountSongsBackdrop(scene: HTMLElement): () => void {
  return mountTreeBackdrop(scene, {
    src: songsTreeUrl,
    coreWidth: 782,
    coreOffsetX: 509,
    splitNy: 0.755,
    strips: 32,
    swayAmp: 3.4,
    windDirection: -1,
    palette: ['#0d6bc2', '#1e8a45', '#aebbe0', '#f7b79e', '#f8cd8d', '#b8db9f'],
    spawnXRange: [0.18, 0.94],
    spawnYRange: [0.14, 0.78],
    seed: 202611249,
  });
}
