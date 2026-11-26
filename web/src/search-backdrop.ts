import searchTreeUrl from './assets/search-tree.webp';
import searchTreeNightUrl from './assets/search-tree-night.webp';
import { mountTreeBackdrop } from './tree-backdrop';

export function mountSearchBackdrop(scene: HTMLElement): () => void {
  return mountTreeBackdrop(scene, {
    src: searchTreeUrl,
    nightSrc: searchTreeNightUrl,
    coreWidth: 771,
    coreOffsetX: 514,
    splitNy: 0.57,
    strips: 28,
    swayAmp: 3.6,
    windDirection: 1,
    palette: ['#206fc0', '#2ca260', '#aebbe0', '#fad098', '#f6c4b8', '#84c592'],
    nightPalette: ['#7fa2d6', '#a8c4f0', '#5a76a8', '#e6c88a', '#9eb0d8', '#6885b8'],
    spawnXRange: [0.12, 0.92],
    spawnYRange: [0.10, 0.78],
    seed: 20261124,
  });
}
