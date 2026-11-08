# EasyRead Roadmap

EasyRead 浏览器扩展（本仓库）与自建同步后端 [oishijie/easyread-sync](https://github.com/oishijie/easyread-sync)（Cloudflare Workers + D1 + R2 + 网页控制台）的后续规划。

服务端与网页控制台侧的细节见 easyread-sync 仓库的 [ROADMAP.md](https://github.com/oishijie/easyread-sync/blob/main/ROADMAP.md)；两份文件配套，改动其一请同步另一份。

---

## 项目定位

**本地优先的稍后阅读 + 笔记扩展**，云同步是可选叠加层。

- 所有数据默认存在浏览器本地（`chrome.storage.local`）；云同步默认关闭，开启后也只发到用户自己填的服务器地址。
- 产品重心是**稍后阅读**与**收藏**的流转，不是通用网页存档工具。
- 沿用上游 [volnet/chrome-extensions-easyread](https://github.com/volnet/chrome-extensions-easyread) 的产品不变量（见 `AGENTS.md`）：未经批准不新增网络传输、分析、远程代码或 host permissions；视频进度只观察、不代用户 seek。

## 当前状态

### 扩展 `v2.4.1`

| 类别 | 状态 |
|---|---|
| 稍后阅读 | 已有：列表、未读计数、阅读进度恢复、当前页提示 |
| 笔记 / 标注 | 已有：选中文字加注、侧栏查看、橙色高亮、导出 Markdown |
| 自动记录 | 已有：访问记录、次数与时间、视频进度（仅记录） |
| 保存网页 | 已有：HTML / PDF / 截图（可视区与整页）/ Markdown；可选的云端上传（HTML / Markdown / 截图 → R2，PDF 除外）；条目可拖动排序（顺序本地保存） |
| 链接收藏 | 已有：保存页面板「链接」行（复制 / 收藏）、稍后阅读页收藏卡片 |
| 云同步 | 已有：稍后阅读、访问记录、笔记、**收藏**四类；全量推送 + 增量拉取 + 删除墓碑（v2.4.1 起删除收藏会上报 `favoriteDeletions`，后端落墓碑，其它设备不会把已删条目加回来）；会话失效引导与同步结果提示已就位 |
| 国际化 | 已有：en / zh_CN 全量覆盖（界面文案） |

### 服务端 / 网页控制台

- 表：`users`、`read_laters`、`all_records`、`notes_pages`、`notes`、`favorites`、`snapshots`、`sync_metadata`、`tombstones`
- API：认证、稍后阅读、笔记、访问记录、收藏、快照（上传 / 下载 / 删除）、全量同步、增量拉取
- 控制台：五个面板（稍后阅读 / 收藏 / 笔记 / 浏览记录 / 页面快照），中英双语，明暗主题
- 线上入口：<https://read.cro.cc.cd/>（自定义域）与 `*.workers.dev`

## 下一步（近期）

### 1. 打通「网页存档」闭环：把快照上传到 R2 —— 已完成（v2.3.0）

保存 HTML / Markdown / 截图后，除本地下载外可同时上传到自建服务器的 R2，控制台「页面快照」面板可取用。

- 开关在设置 → 保存网页 → 「把保存的网页上传到云端」，默认关闭
- 单文件上限 15 MB（超出则只保留本地下载）
- PDF 由浏览器打印对话框生成、没有字节流，不走上传
- 字节在 content script → service worker 之间以 base64 传递，实际上传由 service worker 完成（content script 的跳域 fetch 受页面 CSP/CORS 束缚）

后续可继续做的：R2 用量展示、过期清理策略。

### 2. 同步的可见性与健壮性 —— 已完成（v2.4.1）

- **会话失效处理**：`unauthorized` 提示「登录已失效，请重新登录」并直接打开设置页同步面板；`not_logged_in` 走另一句文案
- **同步状态可见**：同步完成时区分「同步完成」与「同步完成，本地改动已上传」；同步按钮 tooltip 带「上次同步 <时间>」
- **冲突策略固化**：`docs/SYNC-SEMANTICS.md` 写清存储键 → 表映射、推送触发条件、各实体合并规则、防自激抑制窗口与已知边界
- **删除墓碑**：核对时发现并修复了「删除收藏会复活」的数据正确性 bug（扩展记待上报队列 → 服务端删行 + 落墓碑 → 推送成功后清队列），线上端到端验证通过

仍待做：

- **推送量控制**：`syncDirty` 标记已有（仅本地有改动才推送）；D1 免费额度每天 10 万行写入，需守住这条线
- **已知边界**：清空稍后阅读不产生墓碑、墓碑无清理策略、pull 无分页（与后端 ROADMAP 的「同步协议加固」同源）

### 3. 测试与 CI

这是目前最薄的一环：

- **扩展端没有浏览器集成测试**（`AGENTS.md` 明确记录），`scripts/verify-popup-layout.mjs` 等依赖本机 Playwright 路径（原开发机是 Windows），换机就跑不了
- **容器里的实测结果（2026-10-23）**：`npm run test:unit` 为 63 通过 / 2 失败 / 1 跳过；两项失败均来自 Node 18（无全局 `crypto`、`node --check` 不识别 ESM 语法的 `.js`，`test/quality.test.mjs` 单独跑即报 `Cannot use import statement outside a module`），不是代码回归；`npm run lint` 更会直接崩在 ESLint 10 的 formatter（Node 18 没有 `util.styleText`）。修法：固定 Node ≥ 20，或调整校验方式（`--format json` 取结果）
- **控制台内联脚本要进检查**：`src/web/index.html` 的内联 `<script>` 出过一次语法错误导致整页白屏，而 `tsc --noEmit` 与 `wrangler deploy --dry-run` 都抓不到——需要把「抽取内联脚本逐个 `node --check`」纳入发布前检查
- 目标：一次 `npm test` 覆盖扩展纯逻辑 + 内联脚本语法 + 基线校验，并在 CI 上跑通

### 4. 设置页与功能对齐

按其产品不变量，主要功能标签与其二级设置在扩展与外部界面上应保持同名、同序。收藏、快照这类新能力要在设置页有对应入口，改动导航时两边一起更新。

## 中期

- **控制台体验**：收藏 / 稍后阅读的排序、搜索、批量删除；列表分页（现为一次拉 60 条）
- **数据导出 / 导入**：网页端也能导出备份（扩展端已有）
- **同步诊断**：控制台或设置页展示同步日志与最近错误，减少"看起来没同步"的盲猜
- **移动端可用性**：控制台已做响应式；进一步考虑 PWA（离线打开收藏列表）
- **快照存储治理**：R2 用量展示、单文件大小限制、过期清理策略

## 长期 / 待定

- **端到端加密**：数据在客户端加密后再上传，服务端只见密文（会牵动同步协议与冲突合并，需先设计）
- **全文搜索**：跨收藏 / 笔记 / 稍后阅读的本地或服务端搜索
- **上架分发**：Chrome Web Store / Edge 扩展商店（需处理签名与隐私声明；当前只发行 GitHub Release 的 zip）
- **共享与协作**：共享阅读列表 / 笔记（当前设计是严格单用户隔离，改动较大）

## 明确不做（或需先获批准）

- 不新增遥测、分析、远程代码；不扩大 host permissions（`AGENTS.md` 产品不变量）
- 不代用户 seek / 恢复页面视频播放，视频进度仅作记录
- `highlightsEnabled` 只控制高亮渲染，**绝不能**因此删除笔记
- 存储键与字段是公开数据契约，不静默改名（导入导出兼容性）

## 版本与发布约定

沿用当前流程：

1. `npm run build` 产出 `dist/development` 与 `dist/production`
2. 版本号三处同步：`src/manifest.json`、`package.json`、`scripts/verify-build-icons.mjs` 里的断言（漏改第三处会导致构建在最后一步失败）
3. 打包 `dist/production` 为 `easyread-extension-vX.Y.Z.zip`（zip 内带一层同名顶层目录）
4. 提交用 Conventional Commits；推送后打 `vX.Y.Z` 标签，在 GitHub Release 上传 zip
5. 版本语义：修 bug 走 patch，新增能力走 minor；涉及服务端配合的功能要在 Release 说明里写清最低后端版本

---

_最后更新：2026-10-23（v2.4.1）_
