# EasyRead Sync Backend

基于 Cloudflare Workers + D1 + R2 的 EasyRead 浏览器扩展同步后端。

## 功能特性

- ✅ 用户认证（JWT + PBKDF2 密码哈希）
- ✅ 稍后阅读列表同步
- ✅ 页面笔记同步
- ✅ 访问记录同步（含阅读位置与视频进度）
- ✅ 链接收藏同步（按 `key` 去重；删除会落墓碑，其它设备不会把已删收藏加回来）
- ✅ 全量/增量数据同步（幂等写入 + 删除墓碑）
- ✅ 页面快照上传到 R2（上传 / 列表 / 下载 / 删除，扩展 v2.3.0 起可在保存网页时自动上传）
- ✅ Web Dashboard：五个面板（稍后阅读 / 收藏 / 笔记 / 浏览记录 / 页面快照）、中英双语、明暗主题、卡片与列表两种视图

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 D1 数据库

```bash
npm run db:create
```

复制输出的 `database_id`，粘贴到 `wrangler.toml` 的 `database_id` 字段。

### 3. 初始化数据库表

```bash
npm run db:init
```

### 4. （可选）创建 R2 存储桶

只有页面快照功能需要 R2。R2 要在 Cloudflare 后台单独开通（免费额度也要绑支付方式）。

本仓库的 `wrangler.toml` 默认已绑定 `easyread-snapshots`；若你的账号没开通 R2，
把 `[[r2_buckets]]` 整段注释掉再部署（否则快照接口会返回 501），核心同步功能不受影响。

开通后：

```bash
npm run r2:create
```

### 5. 设置 JWT 密钥

密钥通过 Worker Secret 保存，不要写进仓库：

```bash
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
```

### 6. 本地开发

```bash
# 本地初始化数据库（首次运行）
npm run db:init:local

# 复制本地开发用的密钥
cp .dev.vars.example .dev.vars

# 启动开发服务器
npm run dev
```

访问 `http://localhost:8787` 即是 Web Dashboard。

### 7. 部署到 Cloudflare

```bash
npm run deploy
```

部署后：

- 控制台：Worker 根路径 `/`（本项目线上实例 <https://read.cro.cc.cd/>，默认域为 `https://easyread-sync.3120098787.workers.dev`）
- 健康检查：`GET /health` 返回 200
- 同步端到端：扩展「设置 → 同步」填服务器地址与账号，全量推送走 `POST /api/sync/full`、增量拉取走 `GET /api/sync/pull`

## API 文档

详见 [api-design.md](./api-design.md)。

端点速查：
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

扩展侧的同步语义（推送触发、合并规则、墓碑与抑制窗口）见扩展仓库的 [`docs/SYNC-SEMANTICS.md`](https://github.com/oishijie/easyread-extension/blob/main/docs/SYNC-SEMANTICS.md)。

### 基本用法

#### 1. 注册用户

```bash
curl -X POST https://your-worker.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

响应：
```json
{
  "token": "eyJhbGc...",
  "user_id": "uuid"
}
```

#### 2. 添加稍后阅读

```bash
curl -X POST https://your-worker.workers.dev/api/read-later \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "https://example.com/",
    "url": "https://example.com/article",
    "title": "Interesting Article"
  }'
```

#### 3. 全量同步

```bash
curl -X POST https://your-worker.workers.dev/api/sync/full \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @local-data.json
```

## 数据库 Schema

详见 [schema.sql](./schema.sql)

## 项目结构

```
easyread-sync/
├── src/
│   ├── index.ts           # 主入口（挂载路由与 CORS）
│   ├── types/
│   │   ├── index.ts       # TypeScript 类型定义
│   │   └── modules.d.ts   # *.html 文本模块声明
│   ├── lib/
│   │   ├── auth.ts        # JWT 认证
│   │   ├── cors.ts        # CORS 与响应工具
│   │   └── db.ts          # 数据库操作
│   ├── middleware/
│   │   └── auth.ts        # 认证中间件
│   ├── routes/
│   │   ├── auth.ts        # 认证路由
│   │   ├── read-later.ts  # 稍后阅读
│   │   ├── notes.ts       # 笔记
│   │   ├── records.ts     # 访问记录
│   │   ├── favorites.ts   # 链接收藏
│   │   ├── snapshots.ts   # 页面快照（R2）
│   │   └── sync.ts        # 同步
│   └── web/
│       └── index.html     # 控制台页面（由 wrangler 的 Text 规则打包进 Worker）
├── schema.sql             # 数据库 Schema
├── api-design.md          # API 设计文档
├── ROADMAP.md             # 后续规划（与扩展仓库配套）
├── wrangler.toml          # Cloudflare 配置
└── package.json
```

## 后续开发计划

规划统一维护在 [ROADMAP.md](./ROADMAP.md)，与扩展仓库的 [ROADMAP.md](https://github.com/oishijie/easyread-extension/blob/main/ROADMAP.md) 配套，改动其一请同步另一份。

已落地：页面快照上传到 R2、Web Dashboard（五面板 / 中英双语 / 明暗主题）、链接收藏同步、删除墓碑、扩展端同步接入。

## License

Apache-2.0
