// @ts-nocheck
import { STAGE_STACKED_QUERY } from '../stage-sky';
import type { StageTheme } from '../stage-theme';
import { drawRainBlossom } from './rain-blossom';
// Direct adaptation of /four-seasons/scene.js. Original washes, branches, leaves,
// flowers, snow, drifting particles and paper retain the reference's drawing logic.
// The middle frames extend downward; the composition fits above the playback bar.
export function createSeasonArtwork(canvas: HTMLCanvasElement, controls: HTMLElement, decodedCovers?: Map<string,HTMLImageElement>) {
  const ctx=canvas.getContext('2d');
  const coverSlots=[];let activeSlot=0,night=false;
  const W = 900, H = 1204, TAU = Math.PI * 2;
  const panels = [
    { x: 81, y: 232, w: 175, h: 342, birth: .12, colors: [[237,191,197],[247,239,226]] },
    { x: 272, y: 291, w: 182, h: 504, birth: .72, colors: [[177,215,137],[185,218,153]] },
    { x: 469, y: 398, w: 175, h: 482, birth: 1.30, colors: [[237,184,105],[246,242,228]] },
    { x: 661, y: 346, w: 189, h: 384, birth: 1.88, colors: [[125,187,225],[136,192,224]] },
  ];
  const branches = [], foliage = [], flowers = [], snowcaps = [], motes = [];
  let width = 0, height = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let time = 0, previous = 0, frameId = 0, paused = false;
  let seed = 491719, gust = 0, pointer = { x: -1000, y: -1000 };
  const random = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  const range = (a,b) => a + random() * (b-a);
  const clamp = (n,a=0,b=1) => Math.max(a,Math.min(b,n));
  const smooth = n => { n = clamp(n); return n*n*(3-2*n); };
  const mod = (n,d) => ((n%d)+d)%d;
  const lerp = (a,b,t) => a+(b-a)*t;

  // Multiscale pigment variation gives the washes a paper texture without images.
  function noiseField(columns,rows) {
    const values = Float32Array.from({length:columns*rows},random);
    return (x,y) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x-ix), fy = smooth(y-iy);
      const at = (a,b) => values[mod(b,rows)*columns+mod(a,columns)];
      return lerp(lerp(at(ix,iy),at(ix+1,iy),fx),lerp(at(ix,iy+1),at(ix+1,iy+1),fx),fy)-.5;
    };
  }
  function makeWash(panel) {
    const image = document.createElement('canvas');
    image.width = Math.round(panel.w*1.6); image.height = Math.round(panel.h*1.6);
    const c = image.getContext('2d'), pixels = c.createImageData(image.width,image.height);
    const cloud = noiseField(32,40), grain = noiseField(80,100);
    for (let y=0;y<image.height;y++) for (let x=0;x<image.width;x++) {
      const t = smooth(y/image.height), i = (y*image.width+x)*4;
      const n = cloud(x/53,y/53)*19 + cloud(x/19+7,y/19+8)*7 + grain(x/5,y/5)*4 + range(-3,3);
      for (let channel=0;channel<3;channel++) pixels.data[i+channel] = lerp(panel.colors[0][channel],panel.colors[1][channel],t)+n;
      pixels.data[i+3] = 255;
    }
    c.putImageData(pixels,0,0);
    return image;
  }
  panels.forEach(p => { p.wash = makeWash(p); });
  // Reusable, uneven watercolor leaf impressions; each color has several shapes.
  const leafSprites = [[],[]];
  const leafColors = [
    [[143,191,84],[157,198,100],[133,185,75],[166,203,116]],
    [[58,151,16],[75,166,20],[102,173,41],[87,164,34]],
  ];
  for (let season=0;season<2;season++) for (let variant=0;variant<12;variant++) {
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 80;
    const c = sprite.getContext('2d'), color = leafColors[season][variant%4];
    const count = 8+Math.floor(random()*5), points = [];
    for (let i=0;i<count;i++) {
      const a = i/count*TAU, radius = range(23,31);
      points.push([40+Math.cos(a)*radius,40+Math.sin(a)*radius]);
    }
    const contour = new Path2D(); contour.moveTo(...points[0]);
    points.slice(1).forEach(p => contour.lineTo(...p)); contour.closePath();
    c.fillStyle = `rgba(${color},.43)`; c.fill(contour);
    c.save(); c.clip(contour);
    for (let i=0;i<80;i++) {
      const x = range(10,70), y = range(10,70), radius = range(2,9);
      c.fillStyle = `rgba(${color},${range(.015,.07)})`;
      c.beginPath(); c.arc(x,y,radius,0,TAU); c.fill();
    }
    c.strokeStyle = `rgba(${color},.12)`; c.lineWidth = 1.8; c.stroke(contour);
    c.restore(); leafSprites[season].push(sprite);
  }
  const blossomSprites = [];
  for (let variant=0;variant<4;variant++) {
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    const c = sprite.getContext('2d'); c.translate(32,32); c.rotate(variant*.5);
    for (let i=0;i<5;i++) {
      const a = i/5*TAU;
      const x = Math.cos(a)*10, y = Math.sin(a)*10;
      const wash = c.createRadialGradient(x,y,1,x,y,12);
      wash.addColorStop(0,'#ec9caec9'); wash.addColorStop(.72,'#eaa1acc0'); wash.addColorStop(1,'#eaa1ac00');
      c.fillStyle = wash; c.beginPath(); c.arc(x,y,12,0,TAU); c.fill();
    }
    c.fillStyle = '#cf7c7b91'; c.beginPath(); c.arc(0,0,4.5,0,TAU); c.fill();
    for (let i=0;i<5;i++) {
      const a = i/5*TAU; c.fillStyle = '#dfba6e'; c.beginPath(); c.arc(Math.cos(a)*3,Math.sin(a)*3,.7,0,TAU); c.fill();
    }
    blossomSprites.push(sprite);
  }

  function pathSamples(points) {
    const nodes = [{x:points[0][0],y:points[0][1],distance:0}];
    let length = 0;
    for (let i=0;i<points.length-1;i++) {
      const a=points[Math.max(0,i-1)], b=points[i], c=points[i+1], d=points[Math.min(points.length-1,i+2)];
      for (let j=1;j<=10;j++) {
        const t=j/10, t2=t*t, t3=t2*t;
        const coord = k => .5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3);
        const x=coord(0), y=coord(1), last=nodes[nodes.length-1];
        length+=Math.hypot(x-last.x,y-last.y); nodes.push({x,y,distance:length});
      }
    }
    return {nodes,length};
  }
  function branch(points,season,delay=0,duration=.62,weight=1.05) {
    const b = {...pathSamples(points),season,birth:panels[season].birth+delay,duration,weight};
    branches.push(b); return b;
  }
  const springMain = branch([[-18,458],[28,480],[76,497],[117,513],[146,538],[189,554],[225,571],[240,600],[254,648],[260,694]],0,.02,.68,1.35);
  branch([[144,537],[174,520],[195,499],[219,484],[247,462],[258,425],[248,383],[232,352],[225,319],[215,290],[194,273]],0,.08,.62,1.12);
  branch([[191,553],[206,529],[209,506],[228,484],[250,480]],0,.17,.48,.85);
  branch([[226,353],[216,336],[217,314]],0,.26,.34,.65);
  branch([[244,379],[238,358],[251,344],[262,330]],0,.29,.34,.7);
  branch([[216,289],[203,282],[197,264]],0,.3,.26,.6);
  branch([[116,513],[115,499],[105,485]],0,.16,.34,.65);
  branch([[147,538],[136,536],[122,540]],0,.25,.27,.65);
  const summerMain = branch([[250,481],[279,479],[306,496],[341,515],[378,525],[412,547],[443,576],[468,590]],1,0,.60,1.22);
  branch([[256,475],[278,448],[293,417],[303,381],[310,350],[310,333]],1,.03,.53,1.05);
  branch([[279,446],[300,438],[318,432],[340,426]],1,.13,.41,.78);
  branch([[291,421],[320,404],[340,379],[356,342],[366,309],[379,284]],1,.08,.57,.86);
  branch([[326,398],[346,391],[363,389]],1,.26,.27,.6);
  branch([[340,514],[363,527],[390,534],[400,558],[414,582],[435,607],[457,631],[474,648]],1,.19,.53,.95);
  branch([[390,534],[391,558],[402,583],[410,592]],1,.3,.32,.7);
  branch([[276,641],[291,659],[315,677],[327,702],[334,733]],1,.2,.53,1.02);
  branch([[254,636],[275,641],[290,637]],1,.28,.22,.7);
  branch([[437,609],[439,626],[454,629],[465,629]],1,.4,.24,.65);
  const autumnMain = branch([[468,590],[494,599],[520,603],[540,610],[567,594],[594,581],[619,574],[643,570],[662,571]],2,0,.57,1.2);
  branch([[505,600],[532,611],[552,625],[577,634],[606,649],[619,676],[638,700]],2,.16,.55,1.05);
  branch([[543,608],[557,586],[577,567],[594,551],[604,526],[605,503],[608,486]],2,.09,.58,1.1);
  branch([[584,563],[609,554],[632,540],[653,539]],2,.27,.34,.75);
  branch([[606,649],[623,654],[643,650]],2,.35,.25,.75);
  branch([[539,607],[537,587],[537,577]],2,.29,.26,.65);
  const winterUpper = branch([[660,571],[685,561],[710,548],[733,533],[756,517],[777,505],[793,496]],3,.02,.59,1.1);
  const winterLower = branch([[678,565],[697,589],[718,608],[745,615],[775,623],[799,633],[824,639]],3,.16,.54,1.1);
  const winterFork = branch([[710,548],[736,550],[750,544],[762,533]],3,.19,.39,.8);
  branch([[777,505],[793,512],[813,507]],3,.34,.25,.75);
  branch([[745,615],[758,623],[766,641]],3,.42,.24,.7);
  branch([[693,588],[697,602],[703,609]],3,.31,.24,.6);

  function addBroadLeaf(x,y,season,size,delay=0) {
    foliage.push({x,y,season,size,birth:panels[season].birth+.21+delay,rotation:range(0,TAU),phase:range(0,TAU),variant:Math.floor(random()*12)});
  }
  const springClusters = [[190,255],[213,274],[231,302],[222,323],[242,334],[231,352],[246,382],[245,408],[245,434],[229,455],[215,477],[200,496],[189,512],[175,530],[155,541],[133,538],[114,516],[99,497],[88,491],[223,565],[245,562]];
  springClusters.forEach(([x,y],i) => {
    addBroadLeaf(x,y,0,range(15,24),range(0,.34));
    if (i%3!==0) addBroadLeaf(x+range(-12,11),y+range(-9,10),0,range(10,18),range(.05,.38));
  });
  const summerClusters = [[300,340],[325,345],[314,365],[295,391],[290,413],[311,428],[343,425],[363,385],[375,362],[357,316],[342,379],[353,391],[304,494],[339,516],[369,530],[391,533],[416,566],[404,586],[431,616],[441,634],[333,721],[307,678],[282,648],[277,662]];
  summerClusters.forEach(([x,y],i) => {
    const size = i<20 ? range(16,24) : range(9,14);
    addBroadLeaf(x,y,1,size,range(0,.42));
    if (i<20 && random()<.7) addBroadLeaf(x+range(-9,10),y+range(-8,9),1,size*.75,range(.1,.44));
  });
  const flowerLocations = [[167,303],[205,315],[213,343],[234,370],[244,439],[228,455],[213,470],[202,476],[172,532],[158,529],[142,505],[116,494],[94,490],[186,267],[222,329],[247,353]];
  flowerLocations.forEach(([x,y]) => {
    flowers.push({x,y,size:range(6,9),birth:range(.43,.90),phase:range(0,TAU),variant:Math.floor(random()*4)});
    if (random()<.38) flowers.push({x:x+range(-7,7),y:y+range(-7,7),size:range(3.5,5.5),birth:range(.5,.98),phase:range(0,TAU),variant:Math.floor(random()*4)});
  });
  const fallColors = ['#c86243','#cb6147','#d5794b','#d49b49','#c47b59','#dc926b'];
  const fallLeaves = [
    [478,605,-2.15,13,3],[500,594,-.65,12,0],[516,603,.52,15,3],[537,586,-1.55,20,0],
    [569,588,-.75,15,0],[586,600,1.4,16,5],[589,558,-1.9,12,3],[606,540,-.65,13,0],
    [615,525,-.9,12,1],[620,548,-.2,12,3],[605,488,-1.7,8,0],[585,625,-1.15,12,0],
    [602,658,.08,16,3],[630,653,-.1,12,0],[634,679,1.55,15,5],[641,578,1.5,14,5],
    [636,552,-1.4,13,0],[567,571,-2,14,3],[510,603,-2.5,12,3],[614,531,-.6,10,0],
  ];
  fallLeaves.forEach(([x,y,rotation,size,color]) => foliage.push({x,y,rotation,size,color,season:2,birth:range(1.57,2.11),phase:range(0,TAU)}));
  function pointOn(b,t) {
    const distance = b.length*t;
    return b.nodes.find(n=>n.distance>=distance) || b.nodes[b.nodes.length-1];
  }
  for (const b of [winterUpper,winterLower,winterFork]) {
    for (let t=.04;t<.85;t+=.027) {
      const n=pointOn(b,t);
      snowcaps.push({x:n.x+range(-1.5,1.5),y:n.y-range(2,6),rx:range(2.3,5.6),ry:range(2.1,5.1),birth:b.birth+b.duration*t+.13,phase:range(0,TAU)});
    }
  }
  for (let season=0;season<4;season++) {
    const count = [9,11,14,46][season];
    for (let i=0;i<count;i++) motes.push({season,u:random(),v:random(),speed:range(.025,.075),size:season===3 ? range(.65,1.8) : range(1.5,3.1),phase:range(0,TAU),rotation:range(0,TAU)});
  }
  const dust = Array.from({length:75},()=>({x:random(),y:random(),size:range(.5,2),speed:range(.002,.009),phase:range(0,TAU)}));
  // 角花从框的两条边折入画面，两道线留空，像镂刻的窗棂。
  const cornerFret = new Path2D('M36 0H31L24 7H18V12L12 18H7V24L0 31V36 M18 0V3.5H10L3.5 10V18H0');
  const frameColors = [
    { day: '#966758', night: '#cea4ad' },
    { day: '#61765c', night: '#a6c4b4' },
    { day: '#956c46', night: '#d4b497' },
    { day: '#5a7480', night: '#a9c5dd' },
  ];
  const frames = panels.map(({x,y,w,h},index)=>{
    const left=x-4.5, top=y-4.5, right=x+w+4.5, bottom=y+h+4.5, bevel=3;
    const rim = new Path2D();
    rim.moveTo(left+bevel,top);
    rim.lineTo(right-bevel,top);
    rim.lineTo(right,top+bevel);
    rim.lineTo(right,bottom-bevel);
    rim.lineTo(right-bevel,bottom);
    rim.lineTo(left+bevel,bottom);
    rim.lineTo(left,bottom-bevel);
    rim.lineTo(left,top+bevel);
    rim.closePath();
    const inner = new Path2D();
    inner.rect(x,y,w,h);
    const surround = new Path2D(rim);
    surround.addPath(inner);
    const corners = new Path2D();
    for (const sx of [1,-1]) for (const sy of [1,-1]) {
      corners.addPath(cornerFret,new DOMMatrix([sx,0,0,sy,sx===1?left:right,sy===1?top:bottom]));
    }
    return {rim,inner,surround,corners,colors:frameColors[index]};
  });

  function clipPanel(index) { const p=panels[index];ctx.beginPath();ctx.rect(p.x,p.y,p.w,p.h);ctx.clip(); }
  function drawWashes() {
    panels.forEach((p,index)=>{
      const growth=smooth((time-p.birth)/.45); if(growth<=0)return;
      ctx.save();clipPanel(index);ctx.globalAlpha=growth;ctx.drawImage(p.wash,p.x,p.y,p.w,p.h);
      const entry=coverSlots[index];
      if(entry?.image?.complete&&entry.image.naturalWidth){
        const image=entry.image;
        // slice：一张封面按比例分成 parts 块、第 part 块填进这一格（单曲/少曲目时拼回整图）
        const sx=entry.slice?image.naturalWidth*entry.slice.part/entry.slice.parts:0;
        const sw=entry.slice?image.naturalWidth/entry.slice.parts:image.naturalWidth;
        const fit=Math.max(p.w/sw,p.h/image.naturalHeight);
        const w=sw*fit,h=image.naturalHeight*fit;
        ctx.globalAlpha=growth*smooth((time-entry.birth)/.85)*(night?.9:1);
        ctx.drawImage(image,sx,0,sw,image.naturalHeight,p.x+(p.w-w)/2,p.y+(p.h-h)/2,w,h);
        ctx.fillStyle=night?'rgba(13,30,54,.17)':'rgba(241,238,219,.10)';ctx.fillRect(p.x,p.y,p.w,p.h);
      }
      ctx.restore();
    });ctx.globalAlpha=1;
  }
  function drawFrames() {
    ctx.save();
    ctx.lineJoin='round';
    ctx.lineCap='round';
    for (const {rim,inner,surround,corners,colors} of frames) {
      ctx.fillStyle=night?'#263b60':'#eddfca';
      ctx.fill(surround,'evenodd');
      ctx.strokeStyle=night?colors.night:colors.day;
      ctx.lineWidth=1.45;
      ctx.stroke(rim);
      ctx.lineWidth=.9;
      ctx.stroke(inner);
      ctx.strokeStyle=night?'rgba(15,25,50,.88)':'rgba(65,47,35,.82)';
      ctx.lineWidth=2.6;
      ctx.stroke(corners);
      ctx.strokeStyle=night?'#ece1e8':'#f5e0bd';
      ctx.lineWidth=1.05;
      ctx.stroke(corners);
    }
    ctx.restore();
  }
  function drawBranches() {
    ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=night?'rgba(10,17,47,.88)':'rgba(36,43,34,.92)';
    for (const b of branches) {
      const progress=smooth((time-b.birth)/b.duration);
      if(progress<=0)continue;
      const end=b.length*progress;
      for(let i=1;i<b.nodes.length;i++) {
        const a=b.nodes[i-1],n=b.nodes[i];
        if(a.distance>=end)break;
        const t=clamp((end-a.distance)/(n.distance-a.distance));
        ctx.lineWidth=b.weight*(1-.43*n.distance/b.length);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(lerp(a.x,n.x,t),lerp(a.y,n.y,t));ctx.stroke();
      }
    }
  }
  function narrowLeaf(x,y,size,rotation,color,opacity=1) {
    ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha=opacity;
    ctx.beginPath();ctx.moveTo(-size*.5,0);ctx.bezierCurveTo(-size*.1,-size*.34,size*.35,-size*.2,size*.6,0);
    ctx.bezierCurveTo(size*.22,size*.25,-size*.1,size*.29,-size*.5,0);
    const gradient=ctx.createLinearGradient(0,-size*.2,0,size*.2);gradient.addColorStop(0,color+'d9');gradient.addColorStop(1,color+'94');
    ctx.fillStyle=gradient;ctx.fill();ctx.restore();
  }
  function drawFoliage() {
    for(let season=0;season<3;season++) {
      ctx.save();clipPanel(season);
      for(const leaf of foliage) {
        if(leaf.season!==season)continue;
        const growth=smooth((time-leaf.birth)/.34);
        if(growth<=0)continue;
        const sway=Math.sin(time*.75+leaf.phase)*.024+gust*.055*Math.sin(leaf.phase);
        if(season===2) {narrowLeaf(leaf.x,leaf.y,leaf.size*growth,leaf.rotation+sway,fallColors[leaf.color],.91);continue;}
        ctx.save();ctx.translate(leaf.x,leaf.y);ctx.rotate(leaf.rotation+sway);ctx.globalAlpha=.88*growth;
        const size=leaf.size*2.35;ctx.drawImage(leafSprites[season][leaf.variant],-size/2,-size/2,size,size);ctx.restore();
      }
      ctx.restore();
    }
    ctx.save();if(!night)clipPanel(0);
    for(const flower of flowers) {
      const growth=smooth((time-flower.birth)/.33),size=flower.size*2.8*growth;
      if(size<=0)continue;
      if(night){drawRainBlossom(ctx,{...flower,size:flower.size*.72*growth,pink:flower.variant===0,speed:.6+flower.variant*.3,rotation:flower.phase,shape:flower.variant},time);continue;}
      ctx.save();ctx.translate(flower.x,flower.y);ctx.rotate(Math.sin(time*.6+flower.phase)*.025);ctx.globalAlpha=.93;
      ctx.drawImage(blossomSprites[flower.variant],-size/2,-size/2,size,size);ctx.restore();
    }
    ctx.restore();
  }
  function drawSnowcaps() {
    ctx.save();clipPanel(3);
    for(const cap of snowcaps) {
      const growth=smooth((time-cap.birth)/.28);
      if(growth<=0)continue;
      ctx.fillStyle='#faffff';ctx.beginPath();
      for(let i=0;i<9;i++) {
        const a=i/9*TAU,r=1+Math.sin(i*2.8+cap.phase)*.18;
        const x=cap.x+Math.cos(a)*cap.rx*r*growth,y=cap.y+Math.sin(a)*cap.ry*r*growth;
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }
  function drawMotes() {
    for(let season=0;season<4;season++) {
      const p=panels[season],opacity=smooth((time-p.birth-.28)/.55);
      if(opacity<=0)continue;
      ctx.save();clipPanel(season);
      for(const m of motes) {
        if(m.season!==season)continue;
        const drift=Math.sin(time*.46+m.phase)*8+gust*Math.sin(m.phase)*10;
        const x=p.x+mod(m.u*p.w+Math.sin(time*.3+m.phase)*5+drift,p.w);
        const y=p.y+mod(m.v*p.h+time*m.speed*p.h,p.h);
        const blink=.45+.55*Math.pow(Math.sin(time*.6+m.phase),2);
        if(season===3) {
          ctx.globalAlpha=opacity*blink*.87;ctx.fillStyle='#ffffff';
          ctx.beginPath();ctx.arc(x,y,m.size,0,TAU);ctx.fill();
          if(m.size>1.55) {ctx.globalAlpha=opacity*.15;ctx.beginPath();ctx.arc(x,y,m.size*2.7,0,TAU);ctx.fill();}
        } else if(season===2) {
          narrowLeaf(x,y,m.size*2.4,m.rotation+time*.7,'#bd6041',opacity*.8);
        } else {
          ctx.save();ctx.translate(x,y);ctx.rotate(m.rotation+time*.5);ctx.globalAlpha=opacity*.45;
          ctx.fillStyle=season===0?'#da96a3':'#66a738';
          ctx.beginPath();ctx.ellipse(0,0,m.size,m.size*.5,0,0,TAU);ctx.fill();ctx.restore();
        }
      }
      ctx.restore();
    }
  }
  function drawDust() {
    ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
    for(const p of dust) {
      const x=mod(p.x+Math.sin(time*.2+p.phase)*.007,1)*width;
      const y=mod(p.y+time*p.speed,1)*height;
      const radius=p.size*Math.min(width/900,height/1204);
      ctx.globalAlpha=night?.10+Math.sin(time*.8+p.phase)**2*.24:.25+Math.sin(time*.8+p.phase)**2*.48;ctx.fillStyle=night?'#cbd8e1':'#ffffff';
      ctx.beginPath();ctx.arc(x,y,Math.max(.35,radius),0,TAU);ctx.fill();
    }
    ctx.restore();
  }
  function render() {
    if(!width||!height)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*ox,dpr*oy);
    drawWashes();drawFrames();drawBranches();drawFoliage();drawSnowcaps();drawMotes();drawDust();
    const p=panels[activeSlot];
    if(p){ctx.strokeStyle=night?'#f7cce6':'#963c35';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(p.x,p.y+p.h+12);ctx.lineTo(p.x+p.w,p.y+p.h+12);ctx.stroke();}
  }
  function resize() {
    const box=canvas.getBoundingClientRect();width=box.width;height=box.height;dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const stacked=matchMedia(STAGE_STACKED_QUERY).matches;
    if(stacked){
      const contentHeight=height-28;
      scale=Math.min(width/900,contentHeight/740);ox=(width-900*scale)/2;oy=28+(contentHeight-740*scale)/2-200*scale;
    }else{
      const lowest=Math.max(...panels.map(p=>p.y+p.h));
      const topmost=Math.min(...panels.map(p=>p.y));
      const targetBottom=controls.getBoundingClientRect().top-box.top-80;
      const topMargin=Math.min(110,height*.14);
      scale=Math.min(Math.min(width/W,height/H)*1.15,(targetBottom-topMargin)/(lowest-topmost),(width-28)/769);
      scale=Math.max(.1,scale);ox=(width-W*scale)/2;oy=targetBottom-lowest*scale;
    }
    render();
  }

  const observer=new ResizeObserver(resize);observer.observe(canvas);observer.observe(controls);resize();
  return {
    setTheme(theme:StageTheme){night=theme==='night';render();},
    panelRect(index:number){const p=panels[index];return{x:ox+p.x*scale,y:oy+p.y*scale,w:p.w*scale,h:p.h*scale};},
    draw(dt:number,playing:boolean){if(playing||time<4)time+=dt;gust*=Math.exp(-dt*1.7);render();},
    setCovers(entries:{src:string;title:string;slice?:{part:number;parts:number}}[],active:number){
      activeSlot=active;
      entries.forEach((entry,i)=>{
        const prev=coverSlots[i];
        if(prev?.src===entry.src&&prev?.slice?.part===entry.slice?.part&&prev?.slice?.parts===entry.slice?.parts)return;
        const image=decodedCovers?.get(entry.src)??new Image();
        if(entry.src&&!image.src)image.src=entry.src;
        coverSlots[i]={...entry,image,birth:time-.05};
      });
    },
    destroy(){observer.disconnect();}
  };
}
