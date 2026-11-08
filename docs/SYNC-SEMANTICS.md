# 云同步语义（扩展 ↔ 服务端）

本文是同步行为的契约。`src/scripts/syncEngine.mjs` 与 `easyReadData.mjs` 里的合并函数、服务端 [easyread-sync](https://github.com/oishijie/easyread-sync) 的 `/api/sync/*` 都必须与它一致；改动这些行为时，请同步更新本文件与 `test/syncMerge.test.mjs`。

## 数据范围

| 本地 storage 键 | 服务端表 | 唯一键 |
|---|---|---|
| `readLaters` | `read_laters` | `key`（规范化后的页面 URL） |
| `allRecords` | `all_records` | 页面 URL |
| `notes` | `notes_pages` + `notes` | 页面 URL；笔记主键为 `id`（服务端列名 `note_id`） |
| `favorites` | `favorites` | `key` |
| `favoriteDeletions` | 落到 `tombstones` | 本地删掉、还没上报的收藏键 |

## 推送：`POST /api/sync/full`

- **按需推送**：只有本地有改动（`syncDirty` 标记）才上传，避免每轮同步都写库（D1 免费额度每天 10 万行写入）。手动点同步走 `force: true`，无条件全量上传。
- **触发时机**：本地改动后 5 秒防抖自动同步；开启云同步时另有 15 分钟定时同步兜底。
- **请求体是全量**：`readLaters` / `allRecords` / `notes` / `favorites` 各自整份上传，服务端按唯一键 upsert，因此重复调用幂等。
- **删除队列**：`favoriteDeletions` 是本地的待上报删除列表。服务端**先处理删除、再写收藏**——同一条链接「删了又收」时以后者为准（写入会清掉刚落的墓碑）。
- 推送成功后清空本地 `favoriteDeletions`；推送失败则保留，下次继续上报。

## 拉取：`GET /api/sync/pull?since=`

返回 `since` 之后发生变更的行，外加墓碑 `deletedIds`。字段名对齐本地 storage 结构（如访问记录用 `datetimes`，稍后阅读带 `startReadDateTime` / `endReadDateTime`）。

## 合并规则（拉取回写本地）

| 数据 | 规则 |
|---|---|
| 稍后阅读 | 按 `key` 合并；`status` 取较大值，**不降级**；本地缺 `position` 时采用远端的 |
| 访问记录 | 按页面合并；`datetimes` 取并集去重；**保留本地 `videoProgress`** |
| 笔记 | 按 `id` 去重；远端有、本地没有的补进来 |
| 收藏 | 按 `key` 合并；冲突时**保留本地字段** |
| 墓碑 | `deletedIds.readLaters` / `notes` / `favorites` 里的键从本地删除 |

## 防自激

拉取回写本地会触发 `chrome.storage.onChanged`，若不处理就会「拉取 → 触发推送」无限循环。`syncEngine` 用 `suppressUntil`（2 秒窗口）在回写期间抑制本地改动判定。

## 已知边界

- 本地删除**收藏**会产生 `favoriteDeletions` 并同步到服务端；但本地**清空稍后阅读**（设置页的删除入口）目前不产生墓碑，服务端旧数据可能被重新拉回来，尚未处理。
- 服务端 `tombstones` 只增不减，需要保留期与清理策略（见 easyread-sync 的 Roadmap）。
- 单次 `pull` 返回 `since` 之后的全部行，数据量大时需要分页。
- 固定单设备冲突（同一账号同时改同一条数据）没有「谁赢」之外的提示；冲突结果由上面的合并规则决定。
