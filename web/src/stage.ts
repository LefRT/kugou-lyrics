import { createSeasonArtwork } from './reference/four-seasons';
import { createTypingBird } from './reference/typing-bird';
import { LetterPaper, makeTypingCues, prepareTypingCues, type LyricLine, type TypingCue } from './letter-paper';
import { characters, detectLanguage, typingKeys, type TypingLanguage } from './typing-language';
import { goBackFromStage } from './navigation';
import { retryStreamSrc, songPlaybackError } from './song-playback';
import { songStreamSrc } from './demo';
import { StageWater } from './stage-water';
import { StageProgress } from './stage-progress';
import { readStageTheme, type StageTheme } from './stage-theme';
import { StageFlight, FLIGHT_ARTWORK_WIDTH, FLIGHT_ARTWORK_HEIGHT } from './wind-score';
import { STAGE_STACKED_QUERY } from './stage-sky';
import stageIllustration from './assets/stage-illustration.png';
import stageLoveEarbuds from './assets/stage-love-earbuds.webp';
import './stage.css';

export interface StageBoot { play(): void; destroy(): void }
export interface VideoStage {
 fps: number;
 ready: Promise<void>;
 frame(): { track: number; ended: boolean };
}
const VIDEO_FPS = 30;
type Track = { song_id: string; title: string; artist: string; duration_ms?: number; clip_start_ms?: number; lines: LyricLine[]; src: string };
type SongDetails = Omit<Track,'lines'|'src'> & { timeline?:{lines:LyricLine[]} };
type Cover = { file: string; items: { song_id: string; title?: string }[] };
const clock = (s: number) => `${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s))%60).padStart(2,'0')}`;
const clamp = (n:number,a=0,b=1) => Math.max(a,Math.min(b,n));
const icons = {
 play:'<path d="m9 5 11 7-11 7z"/>', pause:'<path d="M9 5v14M16 5v14"/>',
 prev:'<path d="M6 5v14m13-14L8 12l11 7z"/>', next:'<path d="M18 5v14M5 5l11 7L5 19z"/>',
 seq:'<path d="M4 12h14M13 7l5 5-5 5"/>',
 shuf:'<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
 one:'<path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3M10.4 14.6V9.4l-1.6 1.3"/>',
 // 视频播放器通用的四角框：进全屏时四角朝外，已在全屏时朝内
 fs:'<path d="M10 3H3v7M14 3h7v7M10 21H3v-7M14 21h7v-7"/>',
 fsExit:'<path d="M3 10h7V3M21 10h-7V3M3 14h7v7M21 14h-7v7"/>',
};
const svg=(name:keyof typeof icons)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
async function get<T>(url:string):Promise<T>{const r=await fetch(url);if(!r.ok)throw Error('暂时无法读取这份作品');return r.json() as Promise<T>;}
const getSong = (id:string) => get<SongDetails>(`/api/song?song_id=${encodeURIComponent(id)}`);

function mount(host:HTMLElement,tracks:Track[],coverRequest:Promise<Cover[]>,
 mode:'playback'|'study'|'video'='playback',initialTheme=readStageTheme()):StageBoot & VideoStage{
 if(!tracks.length)throw Error('这份作品还没有可播放的片段');
 const video=mode==='video',virtual=mode!=='playback';
 const videoCues=new Map<Track,TypingCue[]>(),videoCovers=new Map<string,HTMLImageElement>();
 document.body.classList.add('paper-mode');
 const root=document.createElement('main');root.className='letter-stage';root.dataset.skin=initialTheme;
 if(video)root.dataset.video='';
 root.innerHTML=`
 <canvas class="letter-ground" aria-hidden="true"></canvas>
 <canvas class="letter-water" aria-hidden="true"></canvas>
 <canvas class="letter-flight letter-flight-back" aria-hidden="true"></canvas>
 <canvas class="letter-seasons" aria-label="四季花枝与四张歌曲封面"></canvas>
 <img class="letter-earbuds" src="${stageLoveEarbuds}" alt="" aria-hidden="true" draggable="false" decoding="async">
 <img class="letter-illustration" src="${stageIllustration}" alt="" aria-hidden="true" draggable="false" decoding="async">
 <canvas class="letter-flight letter-flight-front" aria-hidden="true"></canvas>
 <div class="letter-paper" role="group" aria-label="竖排歌词信笺">
  <h1 class="letter-song-title"></h1>
  <div class="letter-signoff" hidden><span class="letter-byline"></span><span class="letter-seal" aria-hidden="true"></span></div>
  <nav class="letter-page-nav" aria-label="信笺页码" hidden><button type="button" aria-label="上一页">‹</button><span></span><button type="button" aria-label="下一页">›</button></nav>
 </div>
 <canvas class="letter-ink" aria-hidden="true"></canvas>
 <canvas class="letter-birds" aria-hidden="true"></canvas>
 <header class="letter-header"><button class="letter-back" aria-label="返回歌词库">←</button></header>
 <div class="letter-keyboard"><div class="keyboard"></div><div class="typing-readout"><span class="typing-character"></span><span class="typing-pinyin"></span><input class="letter-ime-input" type="text" aria-label="输入文字，支持多语言输入法" autocomplete="off" autocapitalize="off" spellcheck="false"></div></div>
 <section class="letter-controls" aria-label="播放控制"><div class="letter-playback"><button class="letter-prev" aria-label="上一首">${svg('prev')}</button><button class="letter-toggle" aria-label="播放">${svg('play')}</button><button class="letter-next" aria-label="下一首">${svg('next')}</button></div><div class="letter-progress"><span class="letter-current-time">0:00</span><div class="letter-progress-rail"><input type="range" class="letter-seek" min="0" max="1000" value="0" aria-label="播放进度"></div><span class="letter-total-time">0:00</span><button class="letter-fs" type="button" aria-label="全屏" aria-pressed="false" title="全屏 / 退出全屏">${svg('fs')}</button></div><button class="letter-mode" type="button" aria-label="顺序播放">${svg('seq')}</button><p class="letter-status" role="status"></p></section>
 <p class="letter-transcript" aria-label="已打印的歌词"></p>`;
 host.replaceChildren(root);
 const el=<T extends Element=HTMLElement>(s:string)=>root.querySelector<T>(s)!;
 const seasonsCanvas=el<HTMLCanvasElement>('.letter-seasons');
 const seasons=createSeasonArtwork(seasonsCanvas,el('.letter-controls'),video ? videoCovers : undefined);
 // 完整插画仅去白底，对齐第一幅画下方的留白。
 const illustration=el<HTMLImageElement>('.letter-illustration');
 const flightFront=el<HTMLCanvasElement>('.letter-flight-front');
 const flight=new StageFlight(el<HTMLCanvasElement>('.letter-flight-back'),flightFront,illustration);
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const placeArtwork=()=>{
  const stageBox=root.getBoundingClientRect(),canvasBox=seasonsCanvas.getBoundingClientRect();
  const first=seasons.panelRect(0),compact=matchMedia(STAGE_STACKED_QUERY).matches;
  const width=first.w*(compact?1:1.13);
  illustration.style.left=`${canvasBox.left-stageBox.left+first.x+(first.w-width)/2}px`;illustration.style.width=`${width}px`;
  if(compact){
   const top=canvasBox.top-stageBox.top+first.y+first.h+8;
   const bottom=el('.letter-paper').getBoundingClientRect().top-stageBox.top-10;
   illustration.style.top=`${top}px`;illustration.style.bottom='auto';illustration.style.height=`${Math.max(0,bottom-top)}px`;
  }else{
   const third=seasons.panelRect(2);
   // 素材宽 1031px、底部透明留边约 48px；让可见地面与第三幅画底边对齐。
   const bottom=canvasBox.top-stageBox.top+third.y+third.h+width*48/FLIGHT_ARTWORK_WIDTH;
   illustration.style.top='auto';illustration.style.bottom=`${stageBox.height-bottom}px`;illustration.style.height='auto';
  }
  const imageBox=illustration.getBoundingClientRect(),fit=Math.min(imageBox.width/FLIGHT_ARTWORK_WIDTH,imageBox.height/FLIGHT_ARTWORK_HEIGHT);
  const imageWidth=FLIGHT_ARTWORK_WIDTH*fit;
  flight.setLayout({x:imageBox.left-stageBox.left+(imageBox.width-imageWidth)/2,y:imageBox.top-stageBox.top,w:imageWidth},stageBox.height,compact);
 };
 placeArtwork();
 const artworkObserver=new ResizeObserver(placeArtwork);artworkObserver.observe(seasonsCanvas);artworkObserver.observe(el('.letter-controls'));artworkObserver.observe(el('.letter-paper'));artworkObserver.observe(illustration);artworkObserver.observe(flightFront);
 const water=new StageWater(el<HTMLCanvasElement>('.letter-water'));
 const paper=new LetterPaper(el<HTMLCanvasElement>('.letter-ink'),el('.letter-paper'));
 const typer=createTypingBird(el<HTMLCanvasElement>('.letter-birds'),el<HTMLCanvasElement>('.letter-ground'),el('.keyboard'),el('.typing-character'),el('.letter-paper'),
  matte=>paper.drawLandscapeCutout(matte),video);
 let manualCue:TypingCue|null=null,manualUntil=0,loadRevision=0;
 function showReadout(cue:TypingCue|null){
  const char=cue?.char.trim()?cue.char:'',locale=cue?.language||'en';
  if(el('.typing-character').textContent!==char)el('.typing-character').textContent=char;
  el('.typing-character').setAttribute('lang',locale);
  el('.typing-pinyin').textContent=char&&!cue?.sideways?cue?.keys||'':'';
  if(!char)typer.clearThreads();
 }
 function printManual(cue:TypingCue){
  if(phase!=='typing')return null;
  manualCue=cue;manualUntil=performance.now()+1400;
  showReadout(cue);return paper.print({...cue,id:-1});
 }
 function manualPoint(char:string,locale:TypingLanguage){
  return printManual({id:-1,char,keys:typingKeys(char,locale),start:0,language:locale});
 }
 typer.setManualHandler(manualPoint);
 function manualText(text:string){
  const locale=detectLanguage(text,el<HTMLElement>('.keyboard').dataset.language as TypingLanguage||'en');
  if(characters(text).length===1){
   const point=manualPoint(text,locale);if(point)typer.type(text,typingKeys(text,locale),point,true,0,locale);
  }else{
   for(const cue of makeTypingCues([{text,start:0}],0)){
    const point=printManual(cue);if(point)typer.type(cue.char,cue.keys,point,true,0,cue.language);
   }
  }
 }
 const ime=el<HTMLInputElement>('.letter-ime-input');
 const commitInput=()=>{const text=ime.value;if(text){ime.value='';manualText(text);}};
 ime.addEventListener('compositionend',commitInput);
 ime.addEventListener('input',event=>{if(!(event as InputEvent).isComposing)commitInput();});
 // 舞台不再有自己的昼夜开关：跟随主界面状态（见 readStageTheme），只做一次应用
 function applySkin(theme:StageTheme){root.dataset.skin=theme;seasons.setTheme(theme);water.setTheme(theme);typer.setTheme(theme);}
 applySkin(initialTheme);
 const audio=new Audio();audio.preload='auto';
 const TRANSIENT_STATUS=new Set(['正在缓冲音频…','缓冲较慢，正在重新连接…','正在重新连接音频…']);
 let autoRetries=0,retryTimer=0,stallHintTimer=0,stallTimer=0,stallRecoveries=0,lastProgressTime=-1;
 const clearRetry=()=>{if(retryTimer){clearTimeout(retryTimer);retryTimer=0;}};
 const clearStall=()=>{
  if(stallHintTimer){clearTimeout(stallHintTimer);stallHintTimer=0;}
  if(stallTimer){clearTimeout(stallTimer);stallTimer=0;}
  if(TRANSIENT_STATUS.has(status.textContent||''))status.textContent='';
 };
 // 音量缓冲：暂停/切歌/退出时渐降（FADE_MS），起播时渐升（FADE_IN_MS），声音不再猛起猛停
 const FADE_MS=420,FADE_IN_MS=600;let fadeTimer=0;
 const stopFade=()=>{if(fadeTimer){clearInterval(fadeTimer);fadeTimer=0;}};
 const fadeOut=(done?:()=>void)=>{
  stopFade();
  const from=audio.volume,t0=performance.now();
  fadeTimer=window.setInterval(()=>{
   const t=Math.min(1,(performance.now()-t0)/FADE_MS);
   audio.volume=from*(1-t);
   if(t>=1){stopFade();done?.();}
  },40);
 };
 const fadeIn=()=>{
  stopFade();
  // 从当前音量渐升：起播时是 0，被中断的渐弱（音量卡在半路）则从半路补回
  const from=audio.volume,t0=performance.now();
  fadeTimer=window.setInterval(()=>{
   const t=Math.min(1,(performance.now()-t0)/FADE_IN_MS);
   audio.volume=from+(1-from)*t;
   if(t>=1){stopFade();audio.volume=1;}
  },40);
 };
 const seek=el<HTMLInputElement>('.letter-seek'),toggle=el<HTMLButtonElement>('.letter-toggle'),status=el('.letter-status');
 const rail=el('.letter-progress-rail'),progressRail=new StageProgress(rail,seek);
 const climaxBySong=new Map<string,number|null>();
 let climaxMs:number|null=null;
 const coverMap=new Map<string,string>();
 let covers:Cover[]=[];
 let index=0,cues:TypingCue[]=[],cueCursor=0,virtualTime=0,clipFrame=0,running=false,destroyed=false,frame=0,lastFrame=0,lastMedia=-1;
 let phase:'typing'|'outro'|'ended'='typing',pending:number|null=null,lastClock='',lastLyricEnd=Infinity;
 // 播放模式：顺序（默认）→ 真随机（等概率挑一首非当前的）→ 单曲循环
 const MODES=['order','random','one'] as const;
 type PlayMode=typeof MODES[number];
 const MODE_META:Record<PlayMode,{icon:'seq'|'shuf'|'one';label:string}>={
  order:{icon:'seq',label:'顺序播放'},random:{icon:'shuf',label:'随机播放'},one:{icon:'one',label:'单曲循环'},
 };
 let playMode:PlayMode=tracks.length===1&&!video?'one':'order';
 const nextByMode=()=>{
  if(playMode==='one')return index;
  if(playMode==='random'&&tracks.length>1){let n=index;while(n===index)n=Math.floor(Math.random()*tracks.length);return n;}
  return index<tracks.length-1?index+1:mode==='study'?0:null;
 };
 const duration=()=>virtual?(tracks[index].duration_ms||30000)/1000:Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:(tracks[index].duration_ms||0)/1000;
 const position=()=>virtual?virtualTime:audio.currentTime;
 function setRunning(value:boolean){running=value;root.dataset.playing=String(value);toggle.innerHTML=svg(value?'pause':'play');toggle.setAttribute('aria-label',value?'暂停':'播放');}
 function setPhase(value:typeof phase){phase=value;}
 function updateCovers(nextIndex:number){
  const few=tracks.length<4;
  const active=few?nextIndex:nextIndex%4;
  const entries=Array.from({length:4},(_,slot)=>{
   let n:number,part=-1,parts=1;
   if(few){
    // 少于 4 首（含单曲）：前 N-1 首各占一格，最后一首的封面按比例分块填满剩余格子；
    // 单曲即整张封面分 4 块
    n=Math.min(slot,tracks.length-1);
    parts=5-tracks.length;
    part=slot>=tracks.length-1?slot-(tracks.length-1):-1;
   }else{
    n=(nextIndex+(slot-active+4)%4)%tracks.length;
   }
   const t=tracks[n];
   const cover=coverMap.get(String(t.song_id))||(mode==='study'?covers[n%Math.max(1,covers.length)]?.file:'');
   return {src:cover?`/covers/${encodeURIComponent(cover)}`:'',title:t.title,
    slice:part>=0?{part,parts}:undefined};
  });
  seasons.setCovers(entries,active);
 }
 function sync(ms:number,quiet=false){
  if(ms<lastMedia-80){paper.clear();typer.reset();cueCursor=0;quiet=true;}
  const before=cueCursor;
  while(cueCursor<cues.length&&cues[cueCursor].start<=ms){
   const cue=cues[cueCursor++],point=paper.print(cue,!quiet);manualCue=null;
   showReadout(ms<(cue.end??Infinity)?cue:null);
   if(!quiet||ms<(cue.end??Infinity))typer.type(cue.char,cue.keys,point,!quiet,Math.max(0,ms-cue.start)/1000,cue.language);
  }
  lastMedia=ms;
  if(!video&&(quiet||cueCursor!==before))el('.letter-transcript').textContent=cues.slice(0,cueCursor).map(c=>c.gap?' '+c.char:c.char).join('');
  if(cueCursor===cues.length&&ms>=lastLyricEnd)paper.writeSignature((ms-lastLyricEnd)/1000);
  refreshReadout();
 }
 function refreshReadout(){
  const cue=cues[cueCursor-1],ms=position()*1000;
  showReadout(manualCue?(performance.now()<manualUntil?manualCue:null):phase==='typing'&&cue&&ms<(cue.end??Infinity)?cue:null);
 }
 function rebuild(ms:number){paper.clear();typer.reset();cueCursor=0;lastMedia=-1;sync(ms,true);}
 function updateTime(){
  if(video)return;
  const d=duration(),p=position(),progress=d?clamp(p/d):0,value=`${clock(p)}|${clock(d)}`;
  seek.value=String(Math.round(progress*1000));
  progressRail.draw(progress,d,climaxMs);
  if(value!==lastClock){el('.letter-current-time').textContent=clock(p);el('.letter-total-time').textContent=clock(d);lastClock=value;}
 }
 function loadTrack(nextIndex:number){
  clearRetry();clearStall();autoRetries=0;stallRecoveries=0;lastProgressTime=-1;
  setPhase('typing');setRunning(false);stopFade();audio.volume=1;audio.pause();index=nextIndex;virtualTime=0;clipFrame=0;pending=null;lastMedia=-1;cueCursor=0;lastClock='';
  typer.reset();typer.disturb(null);manualCue=null;
  const track=tracks[index],lines=track.lines||[];cues=videoCues.get(track)??makeTypingCues(lines,track.duration_ms||0);
  if(!virtual){
   const currentSrc=audio.getAttribute('src')||'';
   const sameTrack=currentSrc===track.src||currentSrc.startsWith(`${track.src}&`);
   if(sameTrack&&audio.readyState>=1&&!audio.error)audio.currentTime=0;
   else audio.src=track.src;
  }
  lastLyricEnd=cues.length?cues.reduce((end,cue)=>Math.max(end,cue.end??cue.start),0):Infinity;
  paper.setTrack(track.title,track.artist,cues);
  typer.setLanguage(detectLanguage(lines.filter(line=>!line.credit).map(line=>line.text).join('')));
  const revision=++loadRevision;
  climaxMs=null;seek.removeAttribute('aria-description');
  const offset=track.src.startsWith('/audio/')?track.clip_start_ms:0;
  if(!virtual&&offset!==undefined){
   const applyClimax=(start:number|null)=>{
    const position=start===null?null:start-offset;
    climaxMs=position!==null&&position>=0?position:null;
    if(climaxMs!==null&&climaxMs<duration()*1000)seek.setAttribute('aria-description',`高潮从 ${clock(climaxMs/1000)} 开始`);
    updateTime();
   };
   if(climaxBySong.has(track.song_id))applyClimax(climaxBySong.get(track.song_id)??null);
   else void get<{climax:{start_ms:number}|null}>(`/api/song/climax?song_id=${encodeURIComponent(track.song_id)}`).then(result=>{
    const start=result.climax?.start_ms??null;
    climaxBySong.set(track.song_id,start);
    if(!destroyed&&revision===loadRevision)applyClimax(start);
   }).catch(()=>{});
  }
  if(!video)void prepareTypingCues(lines,track.duration_ms||0).then(ready=>{
   // Pronunciation loading keeps the same words and timing, so the paper can continue moving.
   if(!destroyed&&revision===loadRevision&&phase==='typing')cues=ready;
  }).catch(()=>{if(!destroyed&&revision===loadRevision)status.textContent='读音暂时未能载入，仍可显示和播放原文。';});
  root.setAttribute('aria-label',track.title);
  status.textContent='';document.title=`${track.title} · 字间飞鸟`;updateCovers(index);
  el('.letter-transcript').textContent='';showReadout(null);updateTime();
 }
 function play(){
  if(destroyed)return;
  clearRetry();clearStall();
  if(phase==='ended')loadTrack(index);
  if(phase==='outro'||virtual){setRunning(true);return;}
  status.textContent='';
  stopFade();
  if(audio.paused){
   if(audio.error||audio.networkState===HTMLMediaElement.NETWORK_NO_SOURCE){
    autoRetries=0;stallRecoveries=0;lastProgressTime=-1;
    audio.src=retryStreamSrc(tracks[index].src);
    audio.load();
   }
   audio.volume=0;
   const revision=loadRevision;
   void audio.play().then(()=>{
    if(!destroyed&&revision===loadRevision&&phase==='typing'&&!audio.paused)fadeIn();
   }).catch(()=>{
    if(!destroyed&&revision===loadRevision&&phase==='typing'&&audio.paused){audio.volume=1;setRunning(false);}
   });
  }else if(audio.volume<1)fadeIn();
 }
 function pause(){clearRetry();clearStall();if(phase==='outro'||virtual)setRunning(false);else if(!audio.paused)fadeOut(()=>audio.pause());}
 function turn(nextIndex:number|null,ms=position()*1000){
  if(phase==='outro'){pending=nextIndex;return;}
  if(phase==='ended'){
   if(nextIndex!==null){loadTrack(nextIndex);play();}
   return;
  }
  sync(ms,true);
  setPhase('outro');pending=nextIndex;
  if(!audio.paused)fadeOut(()=>audio.pause());
  paper.beginOutro();setRunning(true);
  manualCue=null;showReadout(null);
 }
 function finish(){if(!destroyed&&phase==='typing')turn(nextByMode(),duration()*1000);}
 function choose(nextIndex:number){if(nextIndex<0||nextIndex>=tracks.length)return;if(nextIndex===index&&phase==='typing')return;turn(nextIndex);}
 toggle.onclick=()=>running?pause():play();el<HTMLButtonElement>('.letter-next').onclick=()=>choose((pending??index)+1);
 el<HTMLButtonElement>('.letter-prev').onclick=()=>{if(position()>3&&phase==='typing'){if(virtual)virtualTime=0;else audio.currentTime=0;rebuild(0);}else choose((pending??index)-1);};
 if(tracks.length===1){el<HTMLButtonElement>('.letter-next').disabled=true;el<HTMLButtonElement>('.letter-prev').disabled=true;}
 seek.oninput=()=>{clearStall();lastProgressTime=-1;const p=Number(seek.value)/1000*duration();setPhase('typing');pending=null;typer.disturb(null);if(virtual)virtualTime=p;else audio.currentTime=p;rebuild(p*1000);updateTime();if(running&&!virtual)play();};
 el<HTMLButtonElement>('.letter-back').onclick=goBackFromStage;
 const modeBtn=el<HTMLButtonElement>('.letter-mode');
 const applyModeUi=()=>{const m=MODE_META[playMode];modeBtn.innerHTML=svg(m.icon);modeBtn.setAttribute('aria-label',m.label);modeBtn.title=m.label;};
 modeBtn.onclick=()=>{playMode=MODES[(MODES.indexOf(playMode)+1)%MODES.length];applyModeUi();};
 applyModeUi();
 // 全屏：图标随状态切换（进全屏后四角朝内），Esc 由浏览器直接退出、这里只负责同步
 const fsBtn=el<HTMLButtonElement>('.letter-fs');
 const syncFs=()=>{const on=!!document.fullscreenElement;fsBtn.innerHTML=svg(on?'fsExit':'fs');fsBtn.setAttribute('aria-pressed',String(on));fsBtn.setAttribute('aria-label',on?'退出全屏':'全屏');};
 fsBtn.onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});else void document.documentElement.requestFullscreen().catch(()=>{});};
 document.addEventListener('fullscreenchange',syncFs);syncFs();
 const key=(e:KeyboardEvent)=>{if(e.target instanceof HTMLButtonElement||e.target instanceof HTMLInputElement||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;if(e.code==='Space'){e.preventDefault();running?pause():play();}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek.value=String(clamp((position()+(e.key==='ArrowRight'?5:-5))/Math.max(1,duration()))*1000);seek.dispatchEvent(new Event('input'));}else if(characters(e.key).length===1&&/[\p{Letter}\p{Number}\p{Punctuation}]/u.test(e.key)){e.preventDefault();manualText(e.key);}};
 window.addEventListener('keydown',key);
 const scheduleStallCheck=()=>{
  if(destroyed||virtual||phase!=='typing'||audio.paused||audio.ended||audio.error)return;
  const track=tracks[index];
  if(!track||!track.src.startsWith('/api/song/stream?'))return;
  const revision=loadRevision,stuckAt=audio.currentTime;
  if(!stallHintTimer){
   stallHintTimer=window.setTimeout(()=>{
    stallHintTimer=0;
    if(!destroyed&&revision===loadRevision&&phase==='typing'&&!audio.paused&&!audio.error&&Math.abs(audio.currentTime-stuckAt)<0.2){
     status.textContent='正在缓冲音频…';
    }
   },1200);
  }
  if(!stallTimer&&stallRecoveries<2){
   stallTimer=window.setTimeout(()=>{
    stallTimer=0;
    if(destroyed||revision!==loadRevision||phase!=='typing'||audio.paused||audio.ended||audio.error)return;
    if(Math.abs(audio.currentTime-stuckAt)>=0.25){clearStall();return;}
    stallRecoveries+=1;
    const resumeAt=audio.currentTime;
    status.textContent='缓冲较慢，正在重新连接…';
    const seekAndPlay=()=>{
     if(destroyed||revision!==loadRevision||phase!=='typing')return;
     const limit=Number.isFinite(audio.duration)&&audio.duration>1?audio.duration-0.5:resumeAt;
     if(resumeAt>0.5)audio.currentTime=Math.min(resumeAt,Math.max(0,limit));
     lastProgressTime=-1;
     audio.volume=0;
     void audio.play().then(()=>{
      if(!destroyed&&revision===loadRevision&&phase==='typing'&&!audio.paused)fadeIn();
     }).catch(()=>{
      if(!destroyed&&revision===loadRevision&&phase==='typing'&&audio.paused){
       audio.volume=1;setRunning(false);clearStall();
      }
     });
    };
    audio.addEventListener('loadedmetadata',seekAndPlay,{once:true});
    audio.src=retryStreamSrc(track.src);
    audio.load();
   },7000);
  }
 };
 audio.addEventListener('play',()=>{if(phase==='typing'&&!audio.paused)setRunning(true);});
 audio.addEventListener('playing',()=>{clearRetry();clearStall();autoRetries=0;});
 audio.addEventListener('waiting',scheduleStallCheck);
 audio.addEventListener('stalled',scheduleStallCheck);
 audio.addEventListener('timeupdate',()=>{
  if(audio.paused||audio.error)return;
  if(lastProgressTime<0){lastProgressTime=audio.currentTime;return;}
  if(audio.currentTime-lastProgressTime>0.15){
   if(audio.currentTime-lastProgressTime>1)stallRecoveries=0;
   lastProgressTime=audio.currentTime;
   clearStall();
  }
 });
 audio.addEventListener('pause',()=>{clearStall();if(phase==='typing'&&audio.paused)setRunning(false);});audio.addEventListener('ended',()=>{clearStall();finish();});
 audio.addEventListener('error',async()=>{
  clearStall();
  if(destroyed||phase!=='typing'||!audio.error)return;
  setRunning(false);
  const revision=loadRevision,error=audio.error,track=tracks[index];
  if(track.src.startsWith('/api/song/stream?')&&autoRetries<1){
   autoRetries+=1;
   status.textContent='正在重新连接音频…';
   clearRetry();
   retryTimer=window.setTimeout(()=>{
    retryTimer=0;
    if(destroyed||revision!==loadRevision||phase!=='typing')return;
    audio.src=retryStreamSrc(track.src);
    audio.load();
    audio.volume=0;
    void audio.play().then(()=>{
     if(!destroyed&&revision===loadRevision&&phase==='typing'&&!audio.paused)fadeIn();
    }).catch(()=>{
     if(!destroyed&&revision===loadRevision&&phase==='typing'&&audio.paused){
      audio.volume=1;setRunning(false);
      if(TRANSIENT_STATUS.has(status.textContent||''))status.textContent='';
     }
    });
   },500);
   return;
  }
  const message=track.src.startsWith('/api/song/stream?')
   ?await songPlaybackError(track.song_id)
   :'这段音频暂时无法播放。';
  if(!destroyed&&revision===loadRevision&&audio.error===error)status.textContent=message;
 });audio.addEventListener('loadedmetadata',()=>{if(TRANSIENT_STATUS.has(status.textContent||''))status.textContent='';updateTime();});
 loadTrack(0);
 const coversReady=coverRequest.then(async groups=>{
  if(destroyed)return;
  covers=groups;
  covers.forEach(group=>group.items.forEach(item=>coverMap.set(String(item.song_id),group.file)));
  if(video){
   const urls=new Set(tracks.map(track=>coverMap.get(String(track.song_id))).filter(Boolean));
   await Promise.all([...urls].map(async file=>{
    const src=`/covers/${encodeURIComponent(file!)}`,image=new Image();
    image.src=src;
    try{await image.decode();videoCovers.set(src,image);}catch{/* 舞台会使用缺省封面 */}
   }));
  }
  updateCovers(index);
 }).catch(()=>{});
 const measureRail=()=>{progressRail.measure();updateTime();};
 const progressObserver=new ResizeObserver(measureRail);progressObserver.observe(rail);progressObserver.observe(root);measureRail();
 const drawFrame=(dt:number)=>{
  if(running&&phase==='outro'&&paper.outroComplete&&(virtual||audio.paused)){
   if(pending===null){setPhase('ended');setRunning(false);}else{loadTrack(pending);play();}
  }
  if(running&&phase==='typing'){
   if(video)virtualTime=Math.min(clipFrame++/VIDEO_FPS,duration());
   else if(virtual)virtualTime=Math.min(virtualTime+dt,duration());
   sync(position()*1000);
   if(virtual&&virtualTime>=duration())finish();
  }
  const wasClearing=paper.isClearing;
  if(running&&wasClearing)paper.stir(typer.points());
  paper.draw(dt,running);
  if(paper.isClearing!==wasClearing)typer.disturb(paper.isClearing?()=>paper.randomAttachedPoint():null);
  refreshReadout();updateTime();seasons.draw(dt,running);
  water.draw(dt,running,typer.landscapeClearing);
  if(!reducedMotion.matches)flight.draw(dt,initialTheme==='night');
  typer.draw(dt,running);
 };
 const tick=(now:number)=>{
  if(destroyed)return;const dt=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;
  drawFrame(dt);
  frame=requestAnimationFrame(tick);
 };
 if(!video)frame=requestAnimationFrame(tick);
 const destroy=()=>{
  if(destroyed)return;destroyed=true;
  let cleaned=false;
  const cleanup=()=>{if(cleaned)return;cleaned=true;clearRetry();clearStall();stopFade();cancelAnimationFrame(frame);audio.pause();audio.removeAttribute('src');audio.load();progressObserver.disconnect();artworkObserver.disconnect();seasons.destroy();water.destroy();paper.destroy();typer.destroy();window.removeEventListener('keydown',key);window.removeEventListener('pagehide',pageHide);document.removeEventListener('fullscreenchange',syncFs);document.body.classList.remove('paper-mode');root.remove();};
  // 退出舞台前先把音量渐降，别让声音戛然而止；定时兜底保证清理一定执行
  if(!audio.paused&&audio.volume>0){fadeOut(cleanup);window.setTimeout(cleanup,FADE_MS+180);}
  else cleanup();
 };
 const pageHide=(event:PageTransitionEvent)=>{if(event.persisted)pause();else destroy();};window.addEventListener('pagehide',pageHide);
 const ready=video ? (async()=>{
  await Promise.all([
   coversReady, document.fonts.ready, illustration.decode(),
   ...tracks.map(async track=>{
    const lines=track.lines||[],duration=track.duration_ms||0;
    const prepared=await prepareTypingCues(lines,duration).catch(()=>makeTypingCues(lines,duration));
    videoCues.set(track,prepared);
   }),
  ]);
  loadTrack(0);
  play();
 })() : Promise.resolve();
 return {play,destroy,ready,fps:VIDEO_FPS,frame(){
  drawFrame(1/VIDEO_FPS);
  return {track:index,ended:phase==='ended'};
 }};
}

export async function bootStage(host:HTMLElement,id:string,videoTheme?:StageTheme):Promise<StageBoot & VideoStage>{
 const covers=get<Cover[]>('/api/covers').catch(()=>[]);
 const data=await get<{word:string;segments:(Omit<Track,'src'>&{file:string})[]}>(`/api/mashup?id=${encodeURIComponent(id)}`);
 return mount(host,(data.segments||[]).map(s=>({...s,src:`/audio/${encodeURIComponent(id)}/${s.file.split('/').map(encodeURIComponent).join('/')}`})),
  covers,videoTheme?'video':'playback',videoTheme);
}
export async function bootSongStage(host:HTMLElement,id:string):Promise<StageBoot>{
 const covers=get<Cover[]>('/api/covers').catch(()=>[]);
 const song=await getSong(id);
 return mount(host,[{...song,lines:song.timeline?.lines||[],src:songStreamSrc(id)}],covers);
}
export async function bootPaperStudy(host:HTMLElement):Promise<StageBoot>{
 const covers=await get<Cover[]>('/api/covers').catch(()=>[]);
 const poems=[
  ['给你的一封信','风从纸上来，轻轻翻过旧时光。','我把未说完的话，写进这封蓝色的信。','窗前的花开了，远处的鸟也飞回来了。','你听，春天正经过我们的名字。','愿每一次相逢，都有一阵温柔的风。'],
  ['当四季经过','春有百花，夏有清风。','秋天把思念染成金色，冬天寄来一片雪。','我在这里听一首歌，写一行字。','等你经过四季，读到这一封信。'],
  ['把回声寄给你','音乐让纸上的字，有了自己的翅膀。','每一声回响，都落在远方。','当最后一个字随鸟群飞走，','下一封信，就从春天开始。'],
  ['下一次花开','我们在字里相逢，也在歌声里告别。','那一片飘落的花，那一场安静的雪。','请替我收好，一起听过的光阴。','等下一次花开，再把这首歌寄给你。'],
  ['风的来信','风穿过山野，把一封信放在窗前。','信里有你的名字，也有四季的颜色。','字落下去的时候，一只鸟飞向了天空。'],
  ['纸上的远方','远方是未曾抵达的地方，也是心里的一束光。','你读到这里，春天就已经到了。','愿你看见的每一片天空，都有飞鸟经过。']
 ];
 const tracks:Track[]=poems.map(([title,...texts],i)=>({song_id:covers[i]?.items[0]?.song_id||`letter-${i}`,title,artist:'无声诗笺',duration_ms:32000,src:'',lines:texts.map((text,j)=>({text,start:j*6000,end:j*6000+5200}))}));
 return mount(host,tracks,Promise.resolve(covers),'study');
}
