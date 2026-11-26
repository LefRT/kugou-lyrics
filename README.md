# 酷狗收藏歌词工具（kugou-lyrics · 最终版）

个人本地使用的酷狗歌词库与音乐可视化工具：扫码登录酷狗账号，拉取收藏歌曲与**逐字 KRC 歌词**（拿不到逐字的存 LRC）写入本地 SQLite，提供**觅字串烧、歌词检索（精确/语义）、歌曲库、收藏手账、一键导出离线歌词分享页、四季来信视觉舞台与 1080p 视频导出**。

## 环境要求

- Windows + Python 3.9+（安装时勾选 `Add Python to PATH`）
- **网页端首次扫码登录与日常使用零额外依赖**（纯 Python 标准库，内置矢量二维码生成，无需 `pip install`）。
- 可选扩展：
  - 觅字剪辑：安装 FFmpeg（`winget install Gyan.FFmpeg`）
  - 导出 1080p 舞台视频：本机需有 Edge/Chrome，并执行 `py -3 -m pip install -r requirements-video.txt`
  - 命令行终端打印二维码（`kg_cli.py login`）：`py -3 -m pip install qrcode pillow`

## 快速上手（首次使用）

1. 在右侧 **Releases** 下载成品软件压缩包并解压（或直接克隆本仓库）。
2. 双击根目录的 **`启动音乐网站.bat`**（或在终端运行 `python kg_web.py`）。
3. **首次打开**：浏览器会自动跳转到本地引导页（`http://127.0.0.1:8765/setup`）：
   - **第一步**：用手机酷狗 App 扫描页面上的二维码完成登录；
   - **第二步**：自动开始拉取你的「我喜欢」歌单与逐字歌词（也可勾选同步全部自建歌单）；
   - **完成后**自动进入音乐网站主页，后续每次双击启动即可直接使用。
   - 以后需要更新歌单或切换账号时，随时访问 [http://127.0.0.1:8765/setup](http://127.0.0.1:8765/setup) 即可。

所有账号会话与歌词数据均只保存在本机 `data/` 目录中，停止服务在终端按 `Ctrl+C`。
前端构建产物已包含在 `web/dist/`，日常使用无需 Node.js；仅修改 `web/src/` 或 `web/public/` 后才需执行 `cd web && npm run build`。

## 目录结构

```text
kugou-lyrics/
├─ 启动音乐网站.bat         一键启动（自动清理旧进程）
├─ kg_web.py               网页服务端：JSON API + 静态资源 + 流式播放与分享导出
├─ kg_cli.py               命令行：登录 / 同步 / 检索 / 觅字制作
├─ kg_api.py               酷狗接口、签名与登录态
├─ kg_krc.py               KRC/LRC 解密解析与制作信息行识别
├─ kg_store.py             SQLite 存取与关键词检索
├─ kg_stream.py            多节点竞速拉流、慢节点切换、音质降级与断点续传
├─ kg_playback.py          后台全速下载解耦与本地播放缓存（7 天 / 512 MiB）
├─ kg_setup.py             首次启动网页引导（零依赖扫码登录与歌单歌词同步）
├─ kg_qr.py                纯 Python ISO 标准矢量二维码生成器
├─ kg_share.py             单文件离线歌词分享页生成器（自动排版 + 拼音标注）
├─ kg_mashup.py            觅字串烧制作（选段 / 剪辑 / 拼接）
├─ kg_video.py             四季来信舞台 1080p / 30fps MP4 视频导出
├─ kg_covers.py            专辑封面拉取与缓存
├─ kg_lyric_*.py           歌词语义索引、检索与排序模块
├─ setup_template/         首次启动扫码登录与同步进度引导页
├─ share_template/         歌词分享页模板（水彩雨滴 Canvas、书法样式、离线播放器）
├─ web/                    Vite + TypeScript 前端工程（含 public/assets/favorites/ 收藏手账）
├─ tests/                  后端单元测试（播放、拉流、觅字、检索、视频导出）
├─ docs/                   设计规范、舞台机制与参考说明
└─ data/                   运行数据（建议整体备份）
   ├─ kugou_lyrics.db      歌词数据库
   ├─ session.json         酷狗登录态
   ├─ hanzi_pinyin.json    离线汉字拼音表（分享页生成用）
   ├─ mashups/             觅字作品（meta.json + 分段音频）
   ├─ covers/              专辑封面缓存
   ├─ cache/               觅字制作整首音频缓存（可随时删）
   ├─ playback-cache/      单曲试听音频缓存（可随时删）
   └─ lyric_search/        歌词语义检索索引
```

## 网页控制台

打开 [http://127.0.0.1:8765](http://127.0.0.1:8765) 后包含五个页面，支持白天（纸白×油墨×信号红 brutalist 印刷风）与夜间（深空×全息渐变）像素滑块切换及全屏模式：

- **觅字**（首页）：展示 `data/mashups/` 下所有觅字作品，点击进入「四季来信」舞台播放；左滑删除作品并同步清除对应制作记录。
- **缀字**（`#/create`）：输入关键词后弹窗选歌（可筛选、手动添加、拖拽排序、试听片段），后台自动下载剪辑并展示像素工地进度条；已完成作品支持一键**导出 1080p MP4 视频**。
- **歌曲库**（`#/songs`）：浏览与播放已同步歌曲；逐句跟唱标红，单击任意歌词行即可收藏片段，点行间小钮从该句起播，点封面进入单曲舞台。
- **歌词检索**（`#/search`）：支持精确关键词检索与语义检索（`/api/lyric/semantic`），快速定位相关歌词并跳转试听。
- **收藏收藏**（`#/favorites`）：
  - 手绘书桌与双页手账风格（木桌光影、手绘铅笔与复古磁带、四季树影与花园交互）。
  - 首页右页配有极简透明搜索框，支持按歌名、歌手或收藏歌词实时检索并直达对应片段。
  - 内页左半部为手绘黑胶唱片播放器，支持切段播放、批注以及**一键导出歌词分享页**（点击第四个手绘分享图标）。
  - 导出的单个 `.html` 文件内置音频、手绘书法字体与水彩动效，无需联网即可双击打开播放；自动完成竖排双栏书法与拼音排版，被收藏的歌词片段永久标红，播放时实时高亮当前唱句并支持点句跳转。

## 命令行常用用法

```bash
python kg_cli.py login                 # 扫码登录（手机酷狗 App 扫一扫）
python kg_cli.py sync                  # 同步"我喜欢"歌单与歌词（可选 --all / --playlist N / --force）
python kg_cli.py search 刮风           # 检索含关键词的所有歌曲
python kg_cli.py timeline 晴天 从前    # 查询关键词精确毫秒时间轴
python kg_cli.py mashup 桥             # 制作觅字串烧（可选 --before/--after/--max/--quality）
python kg_cli.py songs                 # 列出库内歌曲
python kg_cli.py fetch 周杰伦 晴天     # 无登录拉取单曲入库
```

## 单曲流式播放与缓存机制

- **多节点容错与降级**：`kg_stream.py` 对酷狗多个播放节点竞速建连，自动过滤非音频响应；遇到慢节点自动切换备用节点并断点续拉；若最高音质不可用则自动降级（`flac → 320 → 128`）。
- **下载解耦与接力**：`kg_playback.py` 将后台全速拉流与浏览器消费解耦，避免浏览器限速导致中途断流，并支持列表页切到舞台页时的无缝接力。
- **前端自动恢复**：遇到短暂卡顿自动提示缓冲，超时后按当前进度自动重连续播。
- **本地缓存**：完整校验通过的音频写入 `data/playback-cache/`（单文件上限 64 MiB，有效期 7 天，总容量上限 512 MiB LRU 淘汰）；命中缓存后重播、拖动进度和分享导出均直接读盘。

## 舞台 · 四季来信

舞台融合了四季画框、风吹五线谱漂浮音符、蓝色十栏竖排信纸、多语言圆键打字机（支持中文拼音、英文 QWERTY、俄语、法语及本地日语罗马字）、红线连字、黑白鸟群与落字物理动效，以及底部水面小船进度条，完整继承主界面的昼夜皮肤。

- **无声演示**：[http://127.0.0.1:8765/?stage=paper](http://127.0.0.1:8765/?stage=paper)
- **串烧舞台**：`?mashup=<id>` / **单曲舞台**：`?song=<song_id>`
- **快捷键**：`Space` 播放/暂停，`←` / `→` 快退/快进 5 秒，`Esc` 返回。

## 主要 JSON API

- 歌曲与检索：`/api/stats`、`/api/songs`、`/api/song`、`/api/occ`、`/api/lyric`、`/api/lyric/semantic`、`/api/covers`
- 播放与分享：`/api/song/url`、`/api/song/stream`、`/api/song/climax`、`/api/song/share`
- 觅字与导出：`/api/mashups`、`/api/mashup`、`/api/mashup/preview`、`/api/mashup/songcheck`、`/api/mashup/songclip`、`/api/mashup/create`、`/api/mashup/tasks`、`/api/mashup/task`、`/api/mashup/task/cancel`、`/api/mashup/video`、`/api/mashup/video/status`、`/audio/<id>/<file>`

## 数据库结构

`data/kugou_lyrics.db` 的 `songs` 表存储每首歌的 `song_id`、`title`、`artist`、`lyrics_text`、`word_timeline`（逐字或行级毫秒时间轴 JSON）、`lyric_type`（`krc` / `lrc` / `none`）及 `file_hash`、`duration_ms`、`mixsongid`、`playlist`、`fetched_at`。

## 开发与测试

```bash
# 运行后端单元测试
python -m unittest discover -s tests -v

# 前端测试与构建
cd web
npm test
npm run build
```

## 排障与声明

- 登录二维码 180 秒有效，登录态保存在 `data/session.json`，失效后重新执行 `python kg_cli.py login`。
- 排查接口异常时可设置 `KG_DEBUG=1`，原始响应会输出到 `debug/` 目录。
- KRC 解密与登录/歌单接口参考了 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 与 [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)。
- 本项目仅用于个人本地研究与音乐收藏体验，请勿用于批量抓取或商业用途。
