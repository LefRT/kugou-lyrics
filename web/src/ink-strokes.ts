export type InkLine = readonly [y: number, start: number, end: number, opacity: number];

export function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function makeStroke([y, start, end, opacity]: InkLine, width: number, height: number, random: () => number) {
  const path = new Path2D();
  const x = start * width;
  const length = (end - start) * width;
  const baseline = y * height;
  const phase = random() * Math.PI * 2;
  const smallerPhase = random() * Math.PI * 2;
  const finePhase = random() * Math.PI * 2;
  const bendRate = .026 + random() * .017;
  const weight = .82 + random() * .16;
  // 按经过的像素距离取笔迹，长短线使用相同的起伏尺度。
  const heightAt = (distance: number) => baseline
    + Math.sin(distance * bendRate + phase) * 1.38
    + Math.sin(distance * .083 + smallerPhase) * .63
    + Math.sin(distance * .179 + finePhase) * .24;
  path.moveTo(x, heightAt(0));
  for (let distance = 6; distance < length; distance += 6) {
    path.lineTo(x + distance, heightAt(distance));
  }
  path.lineTo(x + length, heightAt(length));
  return { path, phase, opacity, weight };
}

export function strokeLines(ctx: CanvasRenderingContext2D, lines: ReturnType<typeof makeStroke>[], color: string) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { path, opacity, weight } of lines) {
    ctx.globalAlpha = opacity;
    ctx.lineWidth = weight;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
}
