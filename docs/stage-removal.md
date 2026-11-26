# 舞台前端移除说明

日期：2026-11-12

旧的全屏歌词舞台（Pixi 渲染 + 播放器）已整层删除，等待重写。控制台、后端接口、数据库、觅字制作链路均未改动。

## 删了哪些文件

`web/src/` 下 12 个模块，全部是舞台专用：

| 文件 | 原职责 |
|---|---|
| `stage.ts` | 播放器外壳：音频播放、逐段回退、切歌队列、播放模式、播放列表、进度胶囊、导出录制、键盘 |
| `program.ts` | 歌词 → 段落/分镜时间轴编译 |
| `runtime.ts` | Pixi 场景构建与逐帧渲染 |
| `layouts.ts` | 7 种分镜版式与字体排版 |
| `textView.ts` | 逐字字形、入场动画 |
| `motion.ts` | 缓动、镜头、节拍脉冲 |
| `guides.ts` | 导引线与彗星 |
| `decor.ts` | 裁切框、贴花、装饰 |
| `filters.ts` | 暗角滤镜 |
| `background.ts` | 网点背景烘焙与漂移 |
| `seedHash.ts` | 随机种子 |
| `recorder.ts` | 导出视频的合成录制 |

同时删除 `web/src/style.css` 中约 200 行舞台样式：`.stage`、`.bg-layer`、`.progress-pill`、`.export-btn`、`.stage-back`、`.stage-modes`、`.queue-*` 等。只保留 `.start-cover`（入口的错误/播放提示遮罩仍在用）。

`web/dist/` 已重新构建，旧代码不在产物中。

## 没删什么

- `console.ts`（控制台）、`cursor.ts`（自定义光标）、`navigation.ts`（返回逻辑）
- `main.ts`：保留并精简为 64 行，只负责路由、主题与提示遮罩
- 后端：所有 API（`/api/mashup`、`/api/song`、`/api/video/convert` 等）、SQLite、`data/mashups/` 数据
- `web/bg.jpg` 背景素材
- `docs/stage-effects.md`、`docs/folia-sonnet-notes.md`：作为重写参考保留

## 现在的状态

`?mashup=<id>` / `?song=<song_id>` 进入 `web/src/stage-placeholder.ts` 的占位页（黑底「舞台重写中」，ESC 返回）。

重写只需替换这个文件，两个入口的契约不变：

```ts
bootStage(host, mashupId)    // 数据：GET /api/mashup?id=<id>
bootSongStage(host, songId)  // 数据：GET /api/song?song_id=<id>
// 均返回 { play(): Promise<void>; destroy(): void }
// play：入口在用户手势后调用；自动播放被拦时，点击遮罩会再调一次
// destroy：仅真正释放资源时调用，正常导航离开不调用（保 bfcache）
```

## 回滚

删除前的完整快照（`src` + `dist`）在 `backups/web-stage-20261112-1635/`。若只想恢复渲染引擎、重写播放器，把
`program / runtime / layouts / textView / motion / guides / decor / filters / background / seedHash`
拷回 `web/src/` 即可，它们之间只互相引用。
