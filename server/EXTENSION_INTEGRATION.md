# EasyRead 扩展 ↔ 同步后端 对接说明

> 扩展侧已经内置完整的同步实现，**不需要**再按老版本本文档的示例代码写一个 SyncEngine——那套 class 示例已废弃。本文描述两侧实际的对接点。

## 扩展侧在哪里

| 关注点 | 位置 |
|---|---|
| 同步引擎（push/pull/防抖/脏标记） | 扩展仓库 `src/scripts/syncEngine.mjs` |
| 合并规则（纯函数，有单测） | `src/scripts/easyReadData.mjs` 的 `mergeReadLaters` / `mergeAllRecords` / `mergeNotePages` / `mergeFavorites` |
| 笔记读写与云端笔记合并 | `src/scripts/notesStore.mjs` |
| 设置页 UI（endpoint/登录/立即同步） | `src/setting/setting.js` 的 Cloud sync 段 |
| 快照上传（R2） | `src/scripts/background.js` 的 Snapshot upload 段 |

同步行为的完整契约见扩展仓库的 `docs/SYNC-SEMANTICS.md`，两侧改动都要与它保持一致。

## 对接协议速览

- `GET /health`：连通性探测（无需登录）。
- `POST /api/auth/register` / `POST /api/auth/login`：返回 `{ token, user_id }`，扩展以 `Authorization: Bearer <token>` 携带。
- `POST /api/sync/full`：全量/按脏集合推送。字段：`readLaters` / `allRecords` / `notes` / `favorites`（均可缺省）+ 四个删除队列 `favoriteDeletions` / `readLaterDeletions` / `noteDeletions` / `recordDeletions`。服务端先落删除（写墓碑）再 upsert；冲突按条目 `updatedAt` LWW，墓碑更新的写入会被拒绝。
- `GET /api/sync/pull?since=<lastSyncAt>`：返回 `since` 后变更的行 + `deletedIds` 墓碑。字段名对齐扩展本地存储（camelCase，如 `selectionText` / `textPosition` / `endReadDateTime`）。
- `POST /api/snapshots/upload`：multipart 上传，字段 `file` / `url` / `title` / `format`（`html`/`markdown`/`screenshot`；PDF 走浏览器打印对话框，不上传）。

字段命名注意：扩展推送笔记是 **camelCase**（`selectionText`、`textPosition`、`updatedAt`、`createDateTime`），服务端 `upsertNote` 入口做了归一化，两种命名都接受；pull 输出始终是 camelCase。

## 本地开发联调

```bash
# 后端（本目录）
cp .dev.vars.example .dev.vars   # 设置 JWT_SECRET
npx wrangler dev                 # 默认 http://127.0.0.1:8787

# 扩展（仓库根目录）
npm run build
# Chrome → chrome://extensions → 加载已解压的扩展程序 → 选择 dist/（或 src/）
# 设置页 → 云同步 → API 地址填 http://127.0.0.1:8787 → 注册/登录 → 立即同步
```

首次部署存量库需要执行一次 `npx wrangler d1 migrations apply easyread-sync`（引入 LWW 用的 `updated_at` 列），见 `DEPLOYMENT.md`。
