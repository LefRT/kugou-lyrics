// 入口：?mashup=<id> / ?song=<song_id> → 舞台；否则 → 控制台（hash 路由）。
// ?stage=paper 为四季来信的无声动态预览。
import './style.css';
import './site-theme.css';
import { bootSongStage, bootStage, bootPaperStudy, type VideoStage } from './stage';
import { startConsole } from './console';
import { initCursor } from './cursor';
import { goBackFromStage } from './navigation';
import { demoEnabled } from './demo';
import { applyStageTheme, readStageTheme, type StageTheme } from './stage-theme';

declare global {
  interface Window { videoStage?: VideoStage; videoStageError?: string }
}

const app = document.getElementById('app')!;

// 全屏只由控制台导航或舞台控制条的按钮手动触发，不借用第一次点击或按键。

const params = new URLSearchParams(window.location.search);
const mashupId = params.get('mashup');
const videoTheme: StageTheme | undefined = mashupId && params.get('render') === 'video'
  ? params.get('theme') === 'night' ? 'night' : 'day' : undefined;
const songId = params.get('song');
// 演示版没有合成作品的音轨，作品入口落到无声的「四季来信」舞台；单曲正常进舞台（公版录音）。
const stageTarget = demoEnabled && mashupId ? { kind: 'paper' as const, id: '' }
  : mashupId ? { kind: 'mashup' as const, id: mashupId }
  : songId ? { kind: 'song' as const, id: songId }
  : params.get('stage') === 'paper' ? { kind: 'paper' as const, id: '' } : null;

// 舞台继承主界面（控制台）的昼夜状态；控制台的通用主题 index.html 首帧脚本已按 localStorage 写好。
if (stageTarget) applyStageTheme(videoTheme ?? readStageTheme());

const showStage = async (target: { kind: 'mashup' | 'song' | 'paper'; id: string }) => {
  app.innerHTML = '<main class="page"><p class="hint" role="status">正在加载播放舞台…</p></main>';
  window.dispatchEvent(new Event('resize'));
  return target.kind === 'paper' ? bootPaperStudy(app) : target.kind === 'mashup'
    ? bootStage(app, target.id)
    : bootSongStage(app, target.id);
};

void (async () => {
  if (mashupId && videoTheme) {
    try {
      const stage = await bootStage(app, mashupId, videoTheme);
      await stage.ready;
      window.videoStage = stage;
    } catch (error) {
      window.videoStageError = error instanceof Error ? error.message : '舞台载入失败';
    }
    return;
  }
  // 控制台与舞台统一使用自定义光标（含返回按钮，样式与主界面一致）。
  initCursor();
  if (stageTarget) {
    // ESC 退出舞台：进页第一时间就挂上（舞台启动期间也生效），key/code 双判定
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape' || event.key === 'Escape') goBackFromStage();
    });
    try {
      const stage = await showStage(stageTarget);
      stage.play();
    } catch (e) {
      const page = document.createElement('main');
      page.className = 'page';
      const message = document.createElement('p');
      message.className = 'empty';
      message.textContent = (e as Error).message;
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn';
      back.textContent = '返回';
      back.onclick = goBackFromStage;
      page.append(message, back);
      app.replaceChildren(page);
    }
  } else {
    startConsole(app);
  }
})();
