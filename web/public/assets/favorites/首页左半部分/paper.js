(() => {
  'use strict';

  function makeRandom(seed) {
    return () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  const grain = document.createElement('canvas');
  grain.width = grain.height = 256;
  const grainContext = grain.getContext('2d');
  const grainImage = grainContext.createImageData(grain.width, grain.height);
  const grainRandom = makeRandom(412);
  for (let i = 0; i < grainImage.data.length; i += 4) {
    const light = grainRandom() < .52 ? 255 : 33;
    grainImage.data[i] = light;
    grainImage.data[i + 1] = light;
    grainImage.data[i + 2] = light;
    grainImage.data[i + 3] = grainRandom() * 30;
  }
  grainContext.putImageData(grainImage, 0, 0);

  function paintGrain(context, width, height, opacity) {
    context.save();
    context.globalAlpha = opacity;
    context.fillStyle = context.createPattern(grain, 'repeat');
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  function wash(context, width, height, colors) {
    const color = context.createLinearGradient(width * .12, 0, width * .72, height);
    colors.forEach((stop, index) => color.addColorStop(index / (colors.length - 1), stop));
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }

  function paintPaper(context, width, height) {
    wash(context, width, height, ['#fffefa', '#fffdf5', '#fbf5e6']);
    const random = makeRandom(261);
    for (let i = 0; i < 1350; i++) {
      const x = random() * width;
      const y = random() * height;
      context.strokeStyle = random() < .55 ? '#8c7e5d09' : '#ffffff66';
      context.lineWidth = .25 + random() * .6;
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(x - .5, y + 5, x + random() * 1.5, y + 2 + random() * 13);
      context.stroke();
    }
    paintGrain(context, width, height, .36);
    context.strokeStyle = '#fffcf0b8';
    context.strokeRect(1, 1, width - 2, height - 2);
  }

  window.SeasonsPaper = { makeRandom, paintGrain, wash, paintPaper };
})();
