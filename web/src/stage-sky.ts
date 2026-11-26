export const STAGE_STACKED_QUERY = '(max-width:759px),(max-width:999px) and (orientation:portrait)';

export function dayLandscapeBounds(width: number, height: number, stacked: boolean) {
  const sceneHeight = stacked ? Math.min(height, height * .29 + 40) : height;
  return { width, height: sceneHeight, horizon: sceneHeight * .55, stacked };
}

type LandscapeBounds = ReturnType<typeof dayLandscapeBounds>;

/** 天空、水色和动态水纹共用同一片信纸留白。 */
export function maskDayLandscape(
  c: CanvasRenderingContext2D, width: number, height: number, scene: LandscapeBounds,
  clearing?: HTMLCanvasElement,
) {
  c.save();
  if (scene.stacked) {
    const fade = c.createLinearGradient(0, scene.height * .82, 0, scene.height);
    fade.addColorStop(0, '#000');
    fade.addColorStop(.55, 'rgba(0,0,0,.42)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = fade;
    c.fillRect(0, 0, width, height);
  }
  if (clearing) {
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(clearing, 0, 0, scene.width, scene.height);
  }
  c.restore();
}

/** 绘制纸面上的天空与水色，并返回供动画共用的留白遮罩。 */
export function paintDayLandscape(
  target: CanvasRenderingContext2D, width: number, height: number, dpr: number, stacked: boolean,
  drawPaperMask: (matte: CanvasRenderingContext2D) => void,
) {
  if (width <= 0 || height <= 0) return;
  const scene = dayLandscapeBounds(width, height, stacked);
  const image = document.createElement('canvas');
  image.width = Math.ceil(scene.width * dpr);
  image.height = Math.ceil(scene.height * dpr);
  const c = image.getContext('2d')!;
  const horizon = scene.horizon / scene.height;
  c.setTransform(image.width, 0, 0, image.height, 0, 0);

  // 天光与水色在远处分别淡出，露出同一张带纹理的纸面。
  const skyEnd = horizon - .035;
  const sky = c.createLinearGradient(0, 0, 0, skyEnd);
  sky.addColorStop(0, '#a7c9df');
  sky.addColorStop(.46, 'rgba(193,216,230,.88)');
  sky.addColorStop(.80, 'rgba(220,232,233,.44)');
  sky.addColorStop(1, 'rgba(233,239,234,0)');
  c.fillStyle = sky;
  c.fillRect(0, 0, 1, skyEnd);

  for (const [x, y, rx, ry, opacity] of [
    [.14, .13, .16, .032, .48], [.39, .19, .13, .025, .40],
    [.64, .30, .19, .035, .38], [.87, .105, .15, .027, .50],
  ]) {
    c.save();
    c.translate(x, y);
    c.scale(rx, ry);
    const cloud = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    cloud.addColorStop(0, `rgba(250,251,243,${opacity})`);
    cloud.addColorStop(1, 'rgba(250,251,243,0)');
    c.fillStyle = cloud;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }

  const water = c.createLinearGradient(0, horizon, 0, 1);
  water.addColorStop(0, 'rgba(219,230,223,0)');
  water.addColorStop(.20, 'rgba(209,225,221,.59)');
  water.addColorStop(.56, 'rgba(178,204,204,.90)');
  water.addColorStop(1, '#9ebdbd');
  c.fillStyle = water;
  c.fillRect(0, horizon, 1, 1 - horizon);

  const clearing = document.createElement('canvas');
  clearing.width = image.width;
  clearing.height = image.height;
  const matte = clearing.getContext('2d')!;
  matte.setTransform(image.width / scene.width, 0, 0, image.height / scene.height, 0, 0);
  drawPaperMask(matte);

  c.setTransform(image.width / scene.width, 0, 0, image.height / scene.height, 0, 0);
  maskDayLandscape(c, scene.width, scene.height, scene, clearing);
  target.drawImage(image, 0, 0, scene.width, scene.height);
  return clearing;
}
