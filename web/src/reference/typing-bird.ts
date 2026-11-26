// @ts-nocheck
import type { StageTheme } from '../stage-theme';
import { paintRainBackdrop } from './rain-blossom';
import { paintDayLandscape, STAGE_STACKED_QUERY } from '../stage-sky';
import { keyboardRows, type TypingLanguage } from '../typing-language';
// Directly reused from /typing-bird/scene.js: paper/pigment texture generation,
// round keys, key press, bird creation, flock physics and both original bird shapes.
// The player supplies timed Chinese characters and their cached pinyin keys.
export function createTypingBird(canvas:HTMLCanvasElement,ground:HTMLCanvasElement,keyboard:HTMLElement,readout:HTMLElement,letter:HTMLElement,
  drawLetterMask:(matte:CanvasRenderingContext2D)=>void,frameClock=false){
  const ctx=canvas.getContext('2d'),W=1600,H=1000,TAU=Math.PI*2;
  const keys=new Map(),birds=[],rays=[],keyTimers=new Map(),usedTimers=new Map();
  let width=0,height=0,dpr=1,scale=1,ox=0,oy=0,time=0,seed=914732;
  let hunt=null,manual=null,night=false,language:TypingLanguage='en';
  let landscapeClearing:HTMLCanvasElement|undefined;
  const random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let n=Math.imul(seed^seed>>>15,1|seed);n=n+Math.imul(n^n>>>7,61|n)^n;return((n^n>>>14)>>>0)/4294967296;};
  const range=(a,b)=>a+random()*(b-a);
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  const mix=(a,b,t)=>a+(b-a)*t;
  const mod=(n,d)=>((n%d)+d)%d;
  const sceneBounds=()=>({left:-ox/scale-35,right:(width-ox)/scale+35,top:-oy/scale-35,bottom:(height-oy)/scale+35});
  function clearKeyTimers(){
    for(const timers of [keyTimers,usedTimers]){
      if(!frameClock)for(const timer of timers.values())clearTimeout(timer);
      timers.clear();
    }
  }
  function lightKey(key,timers,style,ms){
    key.button.classList.add(style);
    if(frameClock)timers.set(key.char,time+ms/1000);
    else{
      clearTimeout(timers.get(key.char));
      timers.set(key.char,setTimeout(()=>{key.button.classList.remove(style);timers.delete(key.char);},ms));
    }
  }
  function buildKeyboard(next:TypingLanguage){
   language=next;keyboard.dataset.language=next;keyboard.replaceChildren();keys.clear();rays.length=0;
   clearKeyTimers();
   for(const row of keyboardRows(next)){
    const group=document.createElement('div');group.className='key-row';
    for(const char of row){
      const button=document.createElement('button');button.type='button';button.className='key';button.textContent=char;button.dataset.key=char;button.setAttribute('aria-label','输入 '+char);
      const key={char,button,x:0,y:0,count:0};keys.set(char,key);
      button.onclick=()=>{const value=button.dataset.glyph||char;const point=manual?.(value,language);if(point)type(value,value,point,true,0,language);else{pressKey(char);spawnBird(key.x,key.y-20);}};
      group.append(button);
    }keyboard.append(group);
   }
  }
  buildKeyboard('en');
  function noiseField(cols,rows){
    const grid=Float32Array.from({length:cols*rows},random);
    return(x,y)=>{const a=Math.floor(x),b=Math.floor(y),u=smooth(x-a),v=smooth(y-b);const at=(i,j)=>grid[mod(j,rows)*cols+mod(i,cols)];return mix(mix(at(a,b),at(a+1,b),u),mix(at(a,b+1),at(a+1,b+1),u),v)-.5;};
  }
  const paper=document.createElement('canvas');paper.width=900;paper.height=1204;
  {
    const c=paper.getContext('2d'),data=c.createImageData(900,1204),cloud=noiseField(48,64);
    for(let y=0;y<1204;y++)for(let x=0;x<900;x++){
      const i=(y*900+x)*4;
      const n=cloud(x/120,y/120)*15+cloud(x/26+8,y/26+7)*8+range(-5.5,5.5);
      data.data[i]=243+n;data.data[i+1]=242+n;data.data[i+2]=234+n;data.data[i+3]=255;
    }
    c.putImageData(data,0,0);
    for(let i=0;i<4200;i++){
      const x=range(0,W),y=range(0,H),a=range(.025,.13);
      c.strokeStyle=`rgba(52,65,45,${a})`;c.lineWidth=range(.25,.75);c.beginPath();c.moveTo(x,y);c.lineTo(x+range(-1,1),y+range(.3,2.3));c.stroke();
    }
    for(let i=0;i<240;i++){
      c.fillStyle=`rgba(34,46,29,${range(.1,.32)})`;c.beginPath();c.ellipse(range(0,W),range(0,H),range(.3,.9),range(.25,1.1),range(0,TAU),0,TAU);c.fill();
    }
    for(let i=0;i<40;i++){
      const x=range(0,W),y=range(0,H),r=range(8,31);const stain=c.createRadialGradient(x,y,0,x,y,r);
      stain.addColorStop(0,'rgba(110,125,92,.05)');stain.addColorStop(1,'rgba(110,125,92,0)');c.fillStyle=stain;c.fillRect(x-r,y-r,r*2,r*2);
    }
  }
  function brushPatch(x,y,w,h,r,color,opacity){
    const image=document.createElement('canvas');image.width=w+24;image.height=h+24;
    const c=image.getContext('2d'),pixels=c.createImageData(image.width,image.height),cloud=noiseField(32,40);
    const mask=document.createElement('canvas');mask.width=image.width;mask.height=image.height;
    const maskContext=mask.getContext('2d'),silhouette=maskContext.createImageData(mask.width,mask.height);
    for(let yy=0;yy<image.height;yy++)for(let xx=0;xx<image.width;xx++){
      const px=xx-12,py=yy-12,dx=Math.abs(px-w/2)-w/2+r,dy=Math.abs(py-h/2)-h/2+r;
      const distance=Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)-r;
      const edge=cloud(xx/5,yy/5)*4+range(-1.8,1.8),a=clamp((-distance+edge)*.38+.45);
      if(a===0)continue;
      const i=(yy*image.width+xx)*4,n=cloud(xx/34,yy/34)*14+range(-4,4);
      pixels.data[i]=color[0]+n;pixels.data[i+1]=color[1]+n;pixels.data[i+2]=color[2]+n;
      pixels.data[i+3]=a*opacity*255*(.84+random()*.16);
      if(pixels.data[i+3]>0)silhouette.data[i+3]=255;
    }
    c.putImageData(pixels,0,0);
    maskContext.putImageData(silhouette,0,0);
    return{x:x-12,y:y-12,image,mask};
  }
  const patches=[
    brushPatch(120,378,451,313,35,[143,153,103],.34),
    brushPatch(524,308,264,198,28,[99,139,126],.27),
    brushPatch(414,475,214,264,30,[101,143,105],.36),
    brushPatch(149,670,198,110,23,[105,150,144],.28),
  ];
  function pressKey(char,animate=true){
    const key=keys.get(char);if(!key||!animate)return;
    lightKey(key,keyTimers,'pressed',105);
  }
  function spawnBird(x,y,initial=false){
    if(birds.length>=85)birds.shift();
    birds.push({x,y,vx:initial?range(-50,50):range(-47,47),vy:initial?range(-70,-15):range(-125,-75),
      size:range(.62,1.32),phase:range(0,TAU),speed:range(48,91),white:random()>.45,side:random()>.53,age:initial?range(2,9):0});
  }
  function drawBird(b){
    const flap=Math.sin(time*8.7+b.phase),heading=Math.atan2(b.vy,b.vx),size=b.size;
    ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.side?heading:heading+Math.PI/2);ctx.scale(size,size);
    ctx.fillStyle=night?(b.white?'#fff3ff':'#aebfeb'):(b.white?'#fffff5':'#283021');ctx.globalAlpha=night?.84:.94;ctx.beginPath();
    if(b.side){
      ctx.moveTo(8,0);ctx.quadraticCurveTo(6,-2,3,-1);ctx.lineTo(0,-2);
      ctx.quadraticCurveTo(-1,-5-flap*8,-5,-13-flap*3);ctx.lineTo(-4,-4);ctx.lineTo(-2,0);
      ctx.lineTo(-10,-3);ctx.lineTo(-7,0);ctx.lineTo(-11,5);ctx.lineTo(-3,2);
      ctx.quadraticCurveTo(1,6+flap*5,4,10+flap*3);ctx.lineTo(2,2);ctx.lineTo(5,1);ctx.closePath();
    }else{
      const spread=.8+.2*Math.abs(flap),tip=-3-flap*5;
      ctx.moveTo(0,-4);ctx.lineTo(-2,-1);ctx.quadraticCurveTo(-8,-6,-16*spread,tip);
      ctx.lineTo(-11*spread,tip+3);ctx.quadraticCurveTo(-6,0,-2,2);ctx.lineTo(-1,7);ctx.lineTo(1,4);ctx.lineTo(2,7);ctx.lineTo(2,2);
      ctx.quadraticCurveTo(7,0,12*spread,tip+2);ctx.lineTo(16*spread,tip);ctx.quadraticCurveTo(8,-6,2,-1);ctx.closePath();
    }
    ctx.fill();ctx.restore();
  }

  function type(char:string,pinyin:string,target:{x:number;y:number},animate=true,elapsed=0,locale:TypingLanguage='en'){
    if(locale!==language){buildKeyboard(locale);measureKeys();}
    rays.length=0;
    for(const key of keys.values())if(key.button.dataset.glyph){delete key.button.dataset.glyph;key.button.textContent=key.char;}
    const point={x:(target.x-ox)/scale,y:(target.y-oy)/scale};
    for(const c of new Set(pinyin.toUpperCase())){
      let key=keys.get(c);
      if(!key){
        const slot=keys.get(locale==='ja'?'文':/[\p{Punctuation}\p{Number}]/u.test(c)?'?':'');
        if(slot){key=slot;slot.button.textContent=c;slot.button.dataset.glyph=c;slot.button.setAttribute('aria-label','输入 '+c);}
      }
      if(!key)continue;key.count++;
      // 变色提示只亮 0.7 秒，随后回到白键；重复敲击时计时重新起算
      lightKey(key,usedTimers,'used',700);
      if(animate)pressKey(c,true);
      if(readout.textContent?.trim())rays.push({key,bend:range(-12,12)});
    }
    if(animate){const last=keys.get(pinyin.toUpperCase().slice(-1));const x=last?.x??point.x,y=last?.y??(height-oy)/scale-50;spawnBird(x,y-20);if(random()<.44)spawnBird(x+range(-8,8),y-4);}
  }
  function paintGround(){
    const g=ground.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,width,height);
    if(night){landscapeClearing=undefined;paintRainBackdrop(g,width,height);return;}
    g.drawImage(paper,0,0,width,height);
    const kb=keyboard.getBoundingClientRect();
    const patchScale=kb.width/680;
    const patchX=kb.left+kb.width/2-450*patchScale,patchY=kb.top-80-600*patchScale;
    landscapeClearing=paintDayLandscape(g,width,height,dpr,matchMedia(STAGE_STACKED_QUERY).matches,matte=>{
      drawLetterMask(matte);
      matte.translate(patchX,patchY);matte.scale(patchScale,patchScale);
      for(const patch of patches)matte.drawImage(patch.mask,patch.x,patch.y);
    });
    g.save();g.translate(patchX,patchY);g.scale(patchScale,patchScale);
    for(const patch of patches)g.drawImage(patch.image,patch.x,patch.y);
    g.restore();
  }
  function measureKeys(){
    for(const key of keys.values()){const r=key.button.getBoundingClientRect();key.x=(r.left+r.width/2-ox)/scale;key.y=(r.top+r.height/2-oy)/scale;}
  }
  function resize(){
    const box=canvas.getBoundingClientRect();width=box.width;height=box.height;dpr=Math.min(devicePixelRatio||1,2);scale=Math.min(width/W,height/H);ox=(width-W*scale)/2;oy=(height-H*scale)/2;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ground.width=canvas.width;ground.height=canvas.height;
    paintGround();
    measureKeys();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);observer.observe(keyboard);observer.observe(letter);resize();
  letter.addEventListener('letterstackchange',paintGround);
  spawnBird(1240,170,true);spawnBird(1460,450,true);spawnBird(980,230,true);
  return {
    type,
    get landscapeClearing(){return landscapeClearing;},
    setLanguage(next:TypingLanguage){if(next!==language){buildKeyboard(next);measureKeys();}},
    clearThreads(){rays.length=0;},
    setTheme(theme:StageTheme){night=theme==='night';paintGround();},
    reset(){rays.length=0;for(const k of keys.values()){k.count=0;k.button.classList.remove('used','pressed');}clearKeyTimers();},
    setManualHandler(fn){manual=fn;},
    disturb(fn){hunt=fn;for(const b of birds)b.target=null;},
    points(){return birds.map(b=>({x:b.x*scale+ox,y:b.y*scale+oy,vx:b.vx*scale,vy:b.vy*scale}));},
    draw(dt:number,playing:boolean){
      if(playing){time+=dt;
    if(frameClock){
      for(const [timers,style] of [[keyTimers,'pressed'],[usedTimers,'used']]){
        for(const [char,expires] of timers)if(time>=expires){keys.get(char)?.button.classList.remove(style);timers.delete(char);}
      }
    }
    const bounds=sceneBounds();
    for(const b of birds){
      b.age+=dt;
      let sx=0,sy=0,neighbors=0,avx=0,avy=0;
      for(const other of birds){
        if(other===b)continue;const dx=b.x-other.x,dy=b.y-other.y,d2=dx*dx+dy*dy;
        if(d2>1&&d2<1350){sx+=dx/d2;sy+=dy/d2;}
        if(d2<14000){neighbors++;avx+=other.vx;avy+=other.vy;}
      }
      const targetX=Math.sin(time*.34+b.phase)*b.speed*.85+Math.cos(time*.12+b.phase)*12;
      const targetY=-b.speed*.52+Math.sin(time*.43+b.phase)*b.speed*.44;
      b.vx+=(targetX-b.vx)*dt*.48+sx*dt*100;
      b.vy+=(targetY-b.vy)*dt*.38+sy*dt*100;
      if(neighbors>0){b.vx+=(avx/neighbors-b.vx)*dt*.08;b.vy+=(avy/neighbors-b.vy)*dt*.08;}
      b.x+=b.vx*dt;b.y+=b.vy*dt;
      if(b.x<bounds.left)b.x=bounds.right;if(b.x>bounds.right)b.x=bounds.left;
      if(b.y<bounds.top)b.y=bounds.bottom;if(b.y>bounds.bottom)b.y=bounds.top;
    }

        if(hunt)for(const b of birds){
          b.targetAge=(b.targetAge||0)+dt;
          if(!b.target||b.targetAge>.8){const p=hunt();b.target=p?{x:(p.x-ox)/scale,y:(p.y-oy)/scale}:null;b.targetAge=0;}
          if(b.target){const dx=b.target.x-b.x,dy=b.target.y-b.y,d=Math.max(1,Math.hypot(dx,dy));b.vx+=(dx/d*200-b.vx)*dt*2.8;b.vy+=(dy/d*200-b.vy)*dt*2.8;}
        }
      }
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*ox,dpr*oy);
      ctx.save();ctx.lineWidth=.66;ctx.strokeStyle=night?'rgba(214,193,241,.24)':'rgba(145,58,48,.27)';
      if(readout.textContent?.trim()){
        const box=readout.getBoundingClientRect(),tx=(box.left+box.width/2-ox)/scale,ty=(box.top+box.height/2-oy)/scale;
        for(const r of rays){
          const x=r.key.x,y=r.key.y-17,cx=(x+tx)/2+r.bend,cy=ty+(y-ty)*.35-12;
          ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(cx,cy,tx,ty+5);ctx.stroke();
        }
      }else rays.length=0;
      ctx.restore();for(const b of birds)drawBird(b);
    },
    destroy(){observer.disconnect();letter.removeEventListener('letterstackchange',paintGround);clearKeyTimers();birds.length=0;rays.length=0;}
  };
}
