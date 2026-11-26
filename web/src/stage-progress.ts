const crest = [
  [-1, 0], [-.81, -.14], [-.61, .15], [-.41, -.19], [-.17, -.38], [0, -1],
  [.21, .60], [.4, -.27], [.59, .12], [.81, -.07], [1, 0],
] as const;

function swell(x: number) {
  for (let i = 1; i < crest.length; i++) {
    const [left, a] = crest[i - 1], [right, b] = crest[i];
    if (x < left || x > right) continue;
    const t = (x - left) / (right - left);
    // Keep the smaller ripples rounded while giving the main crest a steeper rise and fall.
    const blend = right === 0 ? t * t : left === 0 ? t * (2 - t) : t * t * (3 - 2 * t);
    return a + (b - a) * blend;
  }
  return 0;
}

let progressId = 0;

/** Both strokes use the same curve and the native slider's thumb travel. */
export class StageProgress {
  private curve: SVGSVGElement;
  private track: SVGPathElement;
  private elapsed: SVGPathElement;
  private fill: SVGRectElement;
  private box = new DOMRect();
  private inset = 0;
  private span = 0;
  private climax: number | null | undefined;

  constructor(private rail: HTMLElement, private seek: HTMLInputElement) {
    const clip = `letter-progress-clip-${++progressId}`;
    rail.insertAdjacentHTML('afterbegin', `
      <svg class="letter-progress-curve" aria-hidden="true">
        <defs><clipPath id="${clip}"><rect y="-12" height="78"/></clipPath></defs>
        <path class="letter-progress-track"/>
        <path class="letter-progress-elapsed" clip-path="url(#${clip})"/>
      </svg>`);
    this.curve = rail.querySelector('svg')!;
    this.track = this.curve.querySelector('.letter-progress-track')!;
    this.elapsed = this.curve.querySelector('.letter-progress-elapsed')!;
    this.fill = this.curve.querySelector('rect')!;
  }

  measure() {
    this.box = this.rail.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(this.seek).getPropertyValue('--seek-thumb')) || 32;
    this.inset = Math.min(this.box.width, thumb) / 2;
    this.span = this.box.width - this.inset * 2;
    this.curve.setAttribute('viewBox', `0 0 ${Math.max(1, this.box.width)} ${Math.max(1, this.box.height)}`);
    this.climax = undefined;
  }

  private y(progress: number) {
    const x = progress * this.span;
    const baseline = this.box.height / 2 + Math.sin(progress * Math.PI) *
      (Math.sin(x * .085) * .9 + Math.sin(x * .157 + .8) * .38);
    if (this.climax == null) return baseline;
    const offset = x - this.climax * this.span;
    const radius = Math.max(17, Math.min(68, this.span * (offset < 0 ? .24 : .31)));
    return baseline + swell(offset / radius) * Math.min(18.5, 9 + this.span * .03);
  }

  draw(progress: number, duration: number, climaxMs: number | null) {
    const peak = climaxMs != null && climaxMs >= 0 && climaxMs < duration * 1000 ? climaxMs / (duration * 1000) : null;
    if (peak !== this.climax) {
      this.climax = peak;
      const count = Math.max(1, Math.ceil(this.span / 1.4));
      const points = Array.from({ length: count + 1 }, (_, i) => i / count);
      if (peak != null) points.push(peak);
      const path = points.sort((a, b) => a - b).map(p => `${(this.inset + this.span * p).toFixed(2)} ${this.y(p).toFixed(2)}`).join('L');
      this.track.setAttribute('d', 'M' + path);
      this.elapsed.setAttribute('d', 'M' + path);
    }
    this.fill.setAttribute('width', (this.inset + progress * this.span).toFixed(2));
  }
}
