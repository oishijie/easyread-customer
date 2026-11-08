# EasyRead Sync Roadmap

EasyRead 自建同步后端与网页控制台（Cloudflare Workers + D1 + R2）的后续规划。

扩展侧的规划见 [oishijie/easyread-extension](https://github.com/oishijie/easyread-extension) 仓库的 [ROADMAP.md](https://github.com/oishijie/easyread-extension/blob/main/ROADMAP.md)；两份文件配套，改动其一请同步另一份。

> `PROJECT_SUMMARY.md` 里的「下一步优化方向」部分已过时（完整 Dashboard、多语言等均已落地），以本文件为准。

---

## 项目定位

扩展的可选自建后端：**只服务单用户自己的数据**，不对外提供多租户服务。

- 数据严格按 `user_id` 隔离；登录失败不区分「账号不存在 / 密码错误」，避免账号枚举
- 部署成本目标为 Cloudflare 免费额度内（Workers 10 万请求/天、D1 每日 10 万行写入）
- 扩展的同步语义（增量、去重、墓碑）由后端契约保证

## 当前状态

### 数据表（9 张）

`users`、`read_laters`、`all_records`、`notes_pages`、`notes`、`favorites`、`snapshots`、`sync_metadata`、`tombstones`

### API

| 分组 | 端点 |
|---|---|
| 认证 | `POST /api/auth/register`、`POST /api/auth/login` |
| 稍后阅读 | `GET/POST /api/read-later`、`PUT/DELETE /api/read-later/:id` |
| 笔记 | `GET /api/notes`、`GET /api/notes/:url`、`POST /api/notes`、`DELETE /api/notes/:noteId` |
| 访问记录 | `GET /api/records`、`POST /api/records/sync` |
| 收藏 | `GET/POST /api/favorites`、`DELETE /api/favorites/:id` |
| 快照 | `GET /api/snapshots`、`POST /api/snapshots/upload`、`GET /api/snapshots/:id/download`、`DELETE /api/snapshots/:id` |
| 同步 | `POST /api/sync/full`、`GET /api/sync/pull` |
| 其他 | `GET /`（控制台）、`GET /health`、`GET /api` |

### 控制台

五个面板（稍后阅读 / 收藏 / 笔记 / 浏览记录 / 页面快照）、中英双语、明暗主题、卡片与列表两种视图。

### 线上

- 自定义域：<https://read.cro.cc.cd/>
- 默认域：`https://easyread-sync.3120098787.workers.dev`

## 下一步（近期）

### 1. 让「快照」真正被用起来 —— 已完成（v2.3.0）

上传 / 下载 / 删除接口与控制台面板已就绪，扩展侧的上传也已接通（设置里可开关，单文件上限 15 MB，PDF 不上传）。已实测：上传 201 → 列表可见 → 下载内容一致 → 删除生效且 R2 对象同时清理。

待办：

- 快照文件大小与总量展示、单文件大小限制、过期清理策略
- 分片/大文件上传的表现（Workers 请求体上限、R2 单次写入大小）

### 2. 同步协议的加固

已落地：

- **客户端删除的墓碑**：`/api/sync/full` 接收扩展上报的 `favoriteDeletions`，先删行并落墓碑（`tombstones.entity='favorite'`）再写收藏，使同一次推送里「删了又收」以写入为准；已部署并在线上验证（删除后拉不到、墓碑返回、全量拉不复活）

待办：

- **并发与幂等**：`/api/sync/full` 目前逐条 upsert，大批量时是串行写入；评估改用 D1 batch 降低往返次数
- **拉取量**：`/api/sync/pull` 一次返回 since 之后的全部行，数据量大时需分页或按实体拆分
- **墓碑清理**：`tombstones` 只增不减，需要保留期与清理策略（例如 90 天前的墓碑可删）
- **服务端测试**：各实体的合并口径已写进扩展仓库的 `docs/SYNC-SEMANTICS.md`（稍后阅读取 `status` 最大值、访问记录并集、笔记按 `note_id`、收藏以 `key` 为准），服务端侧尚无对应测试覆盖

### 3. 发布前检查（吃过的教训）

- **控制台内联脚本必须做语法检查**：`src/web/index.html` 的内联 `<script>` 曾因一个方法写成对象属性而整页白屏，`tsc --noEmit` 与 `wrangler deploy --dry-run` **都抓不到**。发布前用正则抽取每个内联 `<script>`（跳过带 `src=` 的）逐个 `node --check`
- **部署顺序**：新增表/字段时，先 `wrangler d1 execute --remote --file=./schema.sql`，**再** `wrangler deploy`。顺序反了会让新 Worker 撞上不存在的表，导致全量同步整体 500（扩展每 15 分钟就会调一次）
- `schema.sql` 全部使用 `CREATE TABLE IF NOT EXISTS`，可重复执行

### 4. 控制台体验

- 列表分页（现在固定一次拉 60 条）
- 收藏 / 稍后阅读的排序与搜索
- 批量删除
- 移动端细化（当前已响应式，窄屏导航为横向滚动）

## 中期

- **数据导出**：网页端导出全部数据为 JSON（扩展端已有导出，服务端补齐更利于换机）
- **同步诊断面板**：展示最近同步时间、各实体条目数、最近错误，替代"看起来没同步"的盲猜
- **账号管理**：改密码、注销账号（注销需级联清理 D1 与 R2）
- **可观测性**：`console.error` 之外，接入 Workers 日志检索或保留近期错误摘要

## 长期 / 待定

- **端到端加密**：客户端加密后上传，服务端只存密文。会牵动同步协议、冲突合并与墓碑设计，需先行方案设计
- **全文搜索**：D1 的 FTS5 或客户端侧索引；需先明确数据规模与隐私边界
- **多设备状态**：展示各设备的最后同步时间（当前仅存单条 `sync_metadata`）

## 安全与隐私红线

- `JWT_SECRET` 只经 `wrangler secret put` 设置，**不写入仓库**；本地的 `.dev.vars`、`publish.sh`、临时凭据用完即删
- 控制台渲染的标题与 URL 来自任意网页，插入 DOM 前必须转义（`esc()`）
- 不新增遥测与分析；不把用户数据发往第三方
- 临时测试账号用完必须清理（注册走公开接口不需凭据，但删除需要 Cloudflare 凭据——造数据前先确认手上有清理手段）

## 部署与运维约定

1. 改表结构：更新 `schema.sql` → 对线上库执行 → 再部署 Worker
2. 部署：`CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=1c8316bba67d3e5a815d8507d95d1a46 npx wrangler deploy`
3. 部署后验证：`/health` 返回 200、首页可渲染（浏览器看 console 无错）、关键接口按预期返回 401/200
4. 提交用 Conventional Commits；推送 `main`

---

_最后更新：2026-10-24_
