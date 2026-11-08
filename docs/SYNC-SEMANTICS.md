# 云同步语义（扩展 ↔ 服务端）

本文是同步行为的契约。`src/scripts/syncEngine.mjs` 与 `easyReadData.mjs` 里的合并函数，与服务端（本仓库 `server/`，Cloudflare Worker）的 `/api/sync/*` 都必须与它一致；改动这些行为时，请同步更新本文件与 `test/syncMerge.test.mjs`。

## 数据范围

| 本地 storage 键 | 服务端表 | 唯一键 | 版本号 |
|---|---|---|---|
| `readLaters` | `read_laters` | `key`（规范化后的页面 URL） | 条目 `updatedAt`，缺省回退 `createDateTime` |
| `allRecords` | `all_records` | 规范化页面 URL | 条目 `updatedAt`（推送时由 `latestRecordTime` 补齐） |
| `notes` | `notes_pages` + `notes` | 页面 URL；笔记主键为 `id`（服务端列名 `note_id`） | 条目 `updatedAt`，缺省回退 `createDateTime` |
| `favorites` | `favorites` | `key` | 条目 `updatedAt`，缺省回退 `createDateTime` |

删除队列（本地删掉、还没上报的键，push 成功后清空）：

| storage 键 | 上报字段 | 服务端落成墓碑 |
|---|---|---|
| `favoriteDeletions` | `favoriteDeletions` | `tombstones(entity='favorite')` |
| `readLaterDeletions` | `readLaterDeletions` | `tombstones(entity='read_later')` |
| `noteDeletions` | `noteDeletions` | `tombstones(entity='note')` |
| `recordDeletions` | `recordDeletions` | `tombstones(entity='record')` |

## 推送：`POST /api/sync/full`

- **按集合脏标记推送**：`syncDirty` 记录每个集合是否有改动（旧版布尔值兼容为全脏）。push 只上传脏集合，删除队列非空时始终带上。手动点同步走 `force: true`，无条件全量上传。
- **触发时机**：内容类改动（增删、状态切换、笔记、收藏）后 5 秒防抖自动同步；滚动位置 / 视频进度是 **progress 类改动**，只标脏、随 15 分钟定时同步，不触发防抖推送——否则连续浏览会打爆 D1 写入配额。
- **请求体按需**：只有脏集合出现在请求体里；服务端对缺省集合不做任何事，因此请求天然幂等。
- **版本号**：推送时为没有 `updatedAt` 的条目补版本（readLaters/favorites 用 `createDateTime`，allRecords 用 `latestRecordTime`），旧数据也能参与 LWW。
- **服务端写入规则（LWW + 墓碑守卫）**：
  - 冲突时仅当 `excluded.updated_at >= 现有 updated_at` 才更新——旧设备的整表快照不会覆盖新数据；
  - 若存在比写入版本更新的墓碑，整条写入被拒绝——删除前保存的旧快照不能把已删条目复活；
  - 写入成功才清墓碑；「删了又收」是合法的复活（写入版本比墓碑新）。
- **删除先于写入**：服务端先处理四个删除队列、再 upsert 各集合。
- 推送成功后清空脏标记与各删除队列；失败则保留，下次继续上报。

## 拉取：`GET /api/sync/pull?since=`

返回 `since` 之后 `synced_at` 有变化的行，外加墓碑 `deletedIds`（含 `records`）。字段名对齐本地 storage 结构（`datetimes`、`startReadDateTime`/`endReadDateTime`、笔记的 camelCase 等），并带回每条的 `updatedAt`。

拉取侧还有一道墓碑兜底：与墓碑 key 匹配的行不会出现在响应里（老版本写入的 URL 可能带大小写 / `#fragment` 差异，按规范化后的 key 再过滤一遍）。

## 合并规则（拉取回写本地）

| 数据 | 规则 |
|---|---|
| 稍后阅读 | 按 `key` 合并；双方都带 `updatedAt` 时**条目级 LWW**（「标记未读」这类状态降级靠它传播；赢家的 status/endReadDateTime 不从输家回填）；任一方缺版本时退回旧规则：status 取较大值不降级；`position`/静态字段互补 |
| 访问记录 | 按页面合并；`datetimes` 永远取并集去重（访问是累积语义）；`position`/`title` 按条目 LWW 取较新；墓碑里的页面从本地删除 |
| 笔记 | 按 `id` 去重；本地没有的补进来；**远端 `updatedAt` 更新时整条覆盖**（编辑传播）；删除以 `deletedIds.notes` 为准 |
| 收藏 | 按 `key` 合并；双方带版本时 LWW，否则保留本地字段；墓碑里的直接删除 |
| 墓碑 | `deletedIds.readLaters` / `notes` / `favorites` / `records` 里的键从本地删除 |

## 防自激

- 拉取回写本地会触发 `chrome.storage.onChanged`，若不处理就会「拉取 → 触发推送」无限循环。`syncEngine` 用 `suppressUntil`（2 秒窗口）在回写期间抑制本地改动判定。
- progress 类写入（滚动位置 / 视频进度）由 background 在写库前打 `markProgressWrite()` 标记（1.5 秒窗口），storage 监听据此把它们归入 progress 类：只标脏、不调度防抖同步。

## 已知边界

- 「删除后又在下一次同步前重新访问该页」：墓碑会先删掉本地重建的数据，但下次访问会重新记录、下次推送以更新过的版本号合法复活——自愈，只丢一次中间状态。
- 服务端 `tombstones` 只增不减，需要保留期与清理策略（见 ROADMAP）。
- 单次 `pull` 返回 `since` 之后的全部行，数据量大时需要分页（见 ROADMAP）。
- progress 写入的 1.5 秒标记窗口内，其他上下文恰好写库会被误归为 progress 类——后果只是该次改动延迟到周期同步，不会丢。
- `chrome.storage.local.clear()`（设置页「清空全部数据」）会连同删除队列、登录配置一起清掉；同步配置需要重新登录。
- 退出登录会清空四个删除队列：队列属于上一个账号，带进下一次登录会误删新账号的云端数据。
