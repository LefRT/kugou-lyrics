export type StageTheme = 'day' | 'night';

/** 舞台不独立记忆皮肤：直接继承主界面（控制台）的昼夜状态。 */
export function readStageTheme(): StageTheme {
  try { return localStorage.getItem('kg-theme') === 'night' ? 'night' : 'day'; }
  catch { return 'day'; }
}

export function applyStageTheme(theme: StageTheme) {
  document.documentElement.dataset.stageTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.backgroundColor = 'var(--stage-page-bg)';
}
