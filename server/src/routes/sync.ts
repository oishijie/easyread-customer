// Sync Routes (全量 / 增量同步)
import { Hono } from 'hono';
import type { Env } from '../types';
import { upsertReadLater, upsertNote, upsertFavorite, deleteFavoriteByKey, syncAllRecords, getTombstones } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const sync = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 全为空时不输出 position，避免覆盖本地已有的阅读进度
function positionOf(row: any) {
  const progress = row.position_progress;
  const scrollX = row.position_scroll_x;
  const scrollY = row.position_scroll_y;
  if (progress == null && scrollX == null && scrollY == null) return null;
  return { progress, scrollX, scrollY };
}

// 全量同步（把本地数据推到云端，幂等：重复调用不会产生重复行）
sync.post('/full', async (c) => {
  try {
    const userId = c.get('userId');
    const { readLaters, allRecords, notes, favorites, favoriteDeletions } = await c.req.json();

    const now = Date.now();
    let syncedCount = 0;

    if (Array.isArray(readLaters)) {
      for (const item of readLaters) {
        if (!item?.key || !item?.url) continue;
        await upsertReadLater(c.env.DB, userId, item);
        syncedCount++;
      }
    }

    if (allRecords && typeof allRecords === 'object') {
      syncedCount += await syncAllRecords(c.env.DB, userId, allRecords);
    }

    if (notes && typeof notes === 'object') {
      for (const [url, page] of Object.entries(notes)) {
        const noteList = (page as any)?.notes;
        if (!Array.isArray(noteList)) continue;
        for (const note of noteList) {
          await upsertNote(c.env.DB, userId, url, (page as any).title, note);
          syncedCount++;
        }
      }
    }

    // 先落删除再写收藏：同一条链接「删了又收」时，后者才是最终意图（写入会清掉刚写的墓碑）
    if (Array.isArray(favoriteDeletions)) {
      for (const key of favoriteDeletions) {
        if (typeof key !== 'string' || !key) continue;
        await deleteFavoriteByKey(c.env.DB, userId, key);
      }
    }

    if (Array.isArray(favorites)) {
      for (const item of favorites) {
        if (!item?.key || !item?.url) continue;
        await upsertFavorite(c.env.DB, userId, item);
        syncedCount++;
      }
    }

    await c.env.DB.prepare(`
      INSERT INTO sync_metadata (user_id, last_sync_at, version)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
    `).bind(userId, now).run();

    return jsonResponse({ synced: true, syncedAt: now, syncedCount });
  } catch (error) {
    console.error('Full sync error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to sync data', 500);
  }
});

// 增量拉取（返回自 since 之后变更的数据，格式与 EasyRead 本地存储一致）
sync.get('/pull', async (c) => {
  try {
    const userId = c.get('userId');
    const since = parseInt(c.req.query('since') || '0');

    const readLatersResult = await c.env.DB.prepare(
      'SELECT * FROM read_laters WHERE user_id = ? AND synced_at > ? ORDER BY create_datetime DESC'
    ).bind(userId, since).all();

    const recordsResult = await c.env.DB.prepare(
      'SELECT * FROM all_records WHERE user_id = ? AND synced_at > ?'
    ).bind(userId, since).all();

    const notesResult = await c.env.DB.prepare(`
      SELECT n.*, np.url AS page_url, np.title AS page_title, np.create_datetime AS page_create_datetime
      FROM notes n
      JOIN notes_pages np ON n.page_id = np.id
      WHERE n.user_id = ? AND n.synced_at > ?
    `).bind(userId, since).all();

    const favoritesResult = await c.env.DB.prepare(
      'SELECT * FROM favorites WHERE user_id = ? AND synced_at > ? ORDER BY create_datetime DESC'
    ).bind(userId, since).all();

    const deletedIds = await getTombstones(c.env.DB, userId, since);

    // 输出字段名对齐 EasyRead 本地存储：allRecords 用 datetimes，readLaters 带 start/endReadDateTime
    const readLaters = (readLatersResult.results || []).map(row => {
      const item: Record<string, any> = {
        key: row.key,
        url: row.url,
        title: row.title,
        createDateTime: row.create_datetime,
        status: row.status
      };
      if (row.start_read_datetime != null) item.startReadDateTime = row.start_read_datetime;
      if (row.end_read_datetime != null) item.endReadDateTime = row.end_read_datetime;
      const position = positionOf(row);
      if (position) item.position = position;
      return item;
    });

    const allRecords: Record<string, any> = {};
    for (const row of recordsResult.results || []) {
      const item: Record<string, any> = {
        url: row.url,
        title: row.title,
        datetimes: JSON.parse((row.datetime as string) || '[]')
      };
      const position = positionOf(row);
      if (position) item.position = position;
      allRecords[row.url as string] = item;
    }

    const notes: Record<string, any> = {};
    for (const row of notesResult.results || []) {
      const url = row.page_url as string;
      notes[url] ||= {
        url,
        title: row.page_title,
        createDateTime: row.page_create_datetime,
        notes: []
      };
      const note: Record<string, any> = {
        id: row.note_id,
        scope: row.scope,
        createDateTime: row.create_datetime
      };
      if (row.selection_text != null) note.selectionText = row.selection_text;
      if (row.comment != null) note.comment = row.comment;
      if (row.author != null) note.author = row.author;
      if (row.prefix != null) note.prefix = row.prefix;
      if (row.suffix != null) note.suffix = row.suffix;
      if (row.text_position != null) note.textPosition = row.text_position;
      if (row.updated_at != null) note.updatedAt = row.updated_at;
      notes[url].notes.push(note);
    }

    return jsonResponse({
      readLaters,
      allRecords,
      notes,
      favorites: (favoritesResult.results || []).map(row => ({
        key: row.key,
        url: row.url,
        title: row.title,
        createDateTime: row.create_datetime
      })),
      deletedIds,
      syncedAt: Date.now()
    });
  } catch (error) {
    console.error('Pull sync error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to pull data', 500);
  }
});

export default sync;
