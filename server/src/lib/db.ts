// 数据库工具函数
import type { ReadLater, Note, Favorite } from '../types';

export function generateId(): string {
  return crypto.randomUUID();
}

export function normalizePageUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  return url.split('#')[0].toLowerCase().trim();
}

// ---------- Tombstone guard ----------

// 墓碑比写入的版本更新：说明这是「删除发生前」的旧设备快照。
// 放行会把已删条目复活并清掉墓碑，所以这类写入必须整体跳过。
async function tombstoneNewerThan(db: D1Database, userId: string, entity: string, entityKey: string, version: number) {
  const row = await db.prepare(
    'SELECT deleted_at FROM tombstones WHERE user_id = ? AND entity = ? AND entity_key = ? AND deleted_at > ? LIMIT 1'
  ).bind(userId, entity, entityKey, version).first();
  return Boolean(row);
}

// ---------- Read Later ----------

export async function getReadLaters(db: D1Database, userId: string, status?: number, limit = 50, offset = 0) {
  let query = 'SELECT * FROM read_laters WHERE user_id = ?';
  const params: any[] = [userId];

  if (status !== undefined) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY create_datetime DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await db.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM read_laters WHERE user_id = ?';
  const countParams: any[] = [userId];
  if (status !== undefined) {
    countQuery += ' AND status = ?';
    countParams.push(status);
  }
  const countResult = await db.prepare(countQuery).bind(...countParams).first();

  return {
    items: (result.results || []).map(row => parseReadLater(row)),
    total: (countResult?.total as number) || 0
  };
}

// 按 (user_id, key) 幂等写入，重复同步不会产生重复行。
// LWW：客户端为每条改动打 updatedAt（旧数据回退到 createDateTime），
// 服务端已有更新的版本时跳过写入，避免「旧设备整表推送」覆盖新数据。
export async function upsertReadLater(
  db: D1Database,
  userId: string,
  data: Partial<ReadLater> & { key: string; url: string; title: string; createDateTime?: number }
) {
  const now = Date.now();
  const version = data.updated_at ?? data.updatedAt ?? data.create_datetime ?? data.createDateTime ?? 0;
  if (await tombstoneNewerThan(db, userId, 'read_later', data.key, version)) return null;

  const result = await db.prepare(`
    INSERT INTO read_laters (id, user_id, key, url, title, create_datetime, status,
      start_read_datetime, end_read_datetime,
      position_progress, position_scroll_x, position_scroll_y, synced_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      status = excluded.status,
      start_read_datetime = COALESCE(excluded.start_read_datetime, read_laters.start_read_datetime),
      end_read_datetime = COALESCE(excluded.end_read_datetime, read_laters.end_read_datetime),
      position_progress = excluded.position_progress,
      position_scroll_x = excluded.position_scroll_x,
      position_scroll_y = excluded.position_scroll_y,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= COALESCE(read_laters.updated_at, 0)
  `).bind(
    generateId(), userId, data.key, data.url, data.title,
    data.create_datetime ?? data.createDateTime ?? now,
    data.status ?? 0,
    data.start_read_datetime ?? data.startReadDateTime ?? null,
    data.end_read_datetime ?? data.endReadDateTime ?? null,
    data.position?.progress ?? null,
    data.position?.scrollX ?? null,
    data.position?.scrollY ?? null,
    now,
    version
  ).run();

  if ((result.meta?.changes ?? 0) === 0) return null; // 服务端已有更新的版本，没写进去
  await clearTombstone(db, userId, 'read_later', data.key);
  const row = await db.prepare('SELECT id FROM read_laters WHERE user_id = ? AND key = ?')
    .bind(userId, data.key).first();
  return row?.id as string;
}

export async function updateReadLater(db: D1Database, userId: string, id: string, data: Partial<ReadLater>) {
  await db.prepare(`
    UPDATE read_laters
    SET status = COALESCE(?, status),
        position_progress = ?,
        position_scroll_x = ?,
        position_scroll_y = ?,
        synced_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(
    data.status ?? null,
    data.position?.progress ?? null,
    data.position?.scrollX ?? null,
    data.position?.scrollY ?? null,
    Date.now(), id, userId
  ).run();
}

export async function deleteReadLater(db: D1Database, userId: string, id: string) {
  const row = await db.prepare('SELECT key FROM read_laters WHERE id = ? AND user_id = ?')
    .bind(id, userId).first();
  await db.prepare('DELETE FROM read_laters WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (row?.key) await addTombstone(db, userId, 'read_later', row.key as string);
}

// 同步推送里带过来的本地删除：按 key 删并留墓碑，否则其它设备会把稍后阅读加回来
export async function deleteReadLaterByKey(db: D1Database, userId: string, key: string) {
  await db.prepare('DELETE FROM read_laters WHERE user_id = ? AND key = ?').bind(userId, key).run();
  await addTombstone(db, userId, 'read_later', key);
}

// ---------- Favorites ----------

export async function getFavorites(db: D1Database, userId: string, limit = 50, offset = 0) {
  const result = await db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY create_datetime DESC LIMIT ? OFFSET ?'
  ).bind(userId, limit, offset).all();

  const countResult = await db.prepare('SELECT COUNT(*) as total FROM favorites WHERE user_id = ?')
    .bind(userId).first();

  return {
    items: (result.results || []).map(parseFavorite),
    total: (countResult?.total as number) || 0
  };
}

// 按 (user_id, key) 幂等写入，key 是规范化后的页面 URL。LWW 与墓碑守卫同 read_laters。
export async function upsertFavorite(
  db: D1Database,
  userId: string,
  data: Partial<Favorite> & { key: string; url: string; title?: string; createDateTime?: number }
) {
  const now = Date.now();
  const key = data.key || normalizePageUrl(data.url);
  const version = data.updated_at ?? data.updatedAt ?? data.create_datetime ?? data.createDateTime ?? 0;
  if (await tombstoneNewerThan(db, userId, 'favorite', key, version)) return null;

  const result = await db.prepare(`
    INSERT INTO favorites (id, user_id, key, url, title, create_datetime, synced_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= COALESCE(favorites.updated_at, 0)
  `).bind(
    generateId(), userId, key, data.url, data.title || data.url,
    data.create_datetime ?? data.createDateTime ?? now, now, version
  ).run();

  if ((result.meta?.changes ?? 0) === 0) return null;
  await clearTombstone(db, userId, 'favorite', key);

  const row = await db.prepare('SELECT id FROM favorites WHERE user_id = ? AND key = ?')
    .bind(userId, key).first();
  return row?.id as string;
}

export async function deleteFavorite(db: D1Database, userId: string, id: string) {
  const row = await db.prepare('SELECT key FROM favorites WHERE id = ? AND user_id = ?')
    .bind(id, userId).first();
  await db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (row?.key) await addTombstone(db, userId, 'favorite', row.key as string);
}

// 同步推送里带过来的本地删除：按 key 删并留墓碑，否则其它设备拉取时会把收藏加回来
export async function deleteFavoriteByKey(db: D1Database, userId: string, key: string) {
  await db.prepare('DELETE FROM favorites WHERE user_id = ? AND key = ?').bind(userId, key).run();
  await addTombstone(db, userId, 'favorite', key);
}

// ---------- All Records ----------

export async function syncAllRecords(db: D1Database, userId: string, records: Record<string, any>) {
  const now = Date.now();
  let synced = 0;

  for (const record of Object.values(records)) {
    if (!record || typeof record !== 'object') continue;
    const url = normalizePageUrl(typeof record.url === 'string' ? record.url : '');
    if (!url) continue;

    const version = record.updated_at ?? record.updatedAt ?? 0;
    if (await tombstoneNewerThan(db, userId, 'record', url, version)) continue;

    const result = await db.prepare(`
      INSERT INTO all_records (id, user_id, url, title, datetime,
        position_progress, position_scroll_x, position_scroll_y, synced_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, url) DO UPDATE SET
        title = excluded.title,
        datetime = excluded.datetime,
        position_progress = excluded.position_progress,
        position_scroll_x = excluded.position_scroll_x,
        position_scroll_y = excluded.position_scroll_y,
        synced_at = excluded.synced_at,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= COALESCE(all_records.updated_at, 0)
    `).bind(
      generateId(), userId, url, record.title || url,
      JSON.stringify(Array.isArray(record.datetimes) ? record.datetimes : Array.isArray(record.datetime) ? record.datetime : []),
      record.position?.progress ?? null,
      record.position?.scrollX ?? null,
      record.position?.scrollY ?? null,
      now,
      version
    ).run();

    if ((result.meta?.changes ?? 0) === 0) continue;
    await clearTombstone(db, userId, 'record', url);
    synced++;
  }

  return synced;
}

// 同步推送里带过来的本地删除：本地「移除该页记录 / 清空历史」上报的页面 key
export async function deleteRecordByUrl(db: D1Database, userId: string, pageKey: string) {
  const normalized = normalizePageUrl(pageKey);
  if (!normalized) return;
  await db.prepare('DELETE FROM all_records WHERE user_id = ? AND url = ?').bind(userId, normalized).run();
  await addTombstone(db, userId, 'record', normalized);
}

// ---------- Notes ----------

export async function getNotesPages(db: D1Database, userId: string, limit = 50, offset = 0) {
  const result = await db.prepare(`
    SELECT np.*, COUNT(n.id) as notes_count
    FROM notes_pages np
    LEFT JOIN notes n ON np.id = n.page_id
    WHERE np.user_id = ?
    GROUP BY np.id
    ORDER BY np.create_datetime DESC
    LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all();

  const countResult = await db.prepare('SELECT COUNT(*) as total FROM notes_pages WHERE user_id = ?')
    .bind(userId).first();

  return {
    pages: result.results || [],
    total: (countResult?.total as number) || 0
  };
}

export async function getPageNotes(db: D1Database, userId: string, url: string) {
  const normalizedUrl = normalizePageUrl(url);

  const page = await db.prepare('SELECT * FROM notes_pages WHERE user_id = ? AND url = ?')
    .bind(userId, normalizedUrl).first();

  if (!page) return null;

  const notes = await db.prepare('SELECT * FROM notes WHERE page_id = ? ORDER BY create_datetime')
    .bind(page.id).all();

  return {
    url: page.url,
    title: page.title,
    notes: (notes.results || []).map(row => parseNote(row))
  };
}

async function ensureNotesPage(db: D1Database, userId: string, url: string, title: string, createDateTime?: number): Promise<string> {
  const now = Date.now();
  // 扩展的页面创建时间等于该页首条笔记的创建时间，取较早的作为页面时间
  const created = Number.isFinite(createDateTime) ? (createDateTime as number) : now;
  await db.prepare(`
    INSERT INTO notes_pages (id, user_id, url, title, create_datetime, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, url) DO UPDATE SET
      title = excluded.title,
      create_datetime = MIN(notes_pages.create_datetime, excluded.create_datetime),
      synced_at = excluded.synced_at
  `).bind(generateId(), userId, url, title, created, now).run();

  const row = await db.prepare('SELECT id FROM notes_pages WHERE user_id = ? AND url = ?')
    .bind(userId, url).first();
  return row?.id as string;
}

// 扩展侧笔记字段是 camelCase（selectionText/textPosition/updatedAt/createDateTime），
// 历史文档示例用的是 snake_case：入口统一归一化，缺一边取另一边，
// 否则推上来的引文、文字位置会被丢成 NULL，其他设备拉到的笔记没有正文。
function normalizeNoteInput(note: Partial<Note> & Record<string, any>) {
  return {
    ...note,
    selection_text: note.selection_text ?? note.selectionText ?? null,
    text_position: note.text_position ?? note.textPosition ?? null,
    updated_at: note.updated_at ?? note.updatedAt ?? null,
    create_datetime: note.create_datetime ?? note.createDateTime ?? null,
    prefix: note.prefix ?? null,
    suffix: note.suffix ?? null,
    author: note.author ?? null,
    comment: note.comment ?? null
  };
}

// 按 (user_id, note_id) 幂等写入，note_id 取扩展侧的原始 ID。LWW 与墓碑守卫同 read_laters。
export async function upsertNote(
  db: D1Database,
  userId: string,
  url: string,
  title: string,
  note: Partial<Note> & { id?: string; createDateTime?: number }
) {
  const n = normalizeNoteInput(note);
  const normalizedUrl = normalizePageUrl(url);
  // 扩展侧的笔记主键叫 id，后端列叫 note_id，两者必须对齐才能幂等
  const noteId = n.note_id || n.id || generateId();
  const now = Date.now();
  const created = n.create_datetime ?? now;
  const version = n.updated_at ?? created;
  if (await tombstoneNewerThan(db, userId, 'note', noteId, version)) return noteId;

  const pageId = await ensureNotesPage(db, userId, normalizedUrl, title || normalizedUrl, created);

  const result = await db.prepare(`
    INSERT INTO notes (id, page_id, user_id, note_id, scope, selection_text, comment,
      author, prefix, suffix, text_position, create_datetime, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, note_id) DO UPDATE SET
      page_id = excluded.page_id,
      scope = excluded.scope,
      selection_text = excluded.selection_text,
      comment = excluded.comment,
      author = excluded.author,
      prefix = excluded.prefix,
      suffix = excluded.suffix,
      text_position = excluded.text_position,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
    WHERE excluded.updated_at >= COALESCE(notes.updated_at, 0)
  `).bind(
    generateId(), pageId, userId, noteId, n.scope || 'text',
    n.selection_text, n.comment, n.author,
    n.prefix, n.suffix, n.text_position,
    created, n.updated_at ?? null, now
  ).run();

  if ((result.meta?.changes ?? 0) !== 0) await clearTombstone(db, userId, 'note', noteId);
  return noteId;
}

export async function deleteNote(db: D1Database, userId: string, noteId: string) {
  const row = await db.prepare('SELECT note_id FROM notes WHERE id = ? AND user_id = ?')
    .bind(noteId, userId).first();
  await db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(noteId, userId).run();
  if (row?.note_id) await addTombstone(db, userId, 'note', row.note_id as string);
}

// 同步推送里带过来的本地删除：按 EasyRead 原始笔记 ID 删并留墓碑
export async function deleteNoteByNoteId(db: D1Database, userId: string, noteId: string) {
  await db.prepare('DELETE FROM notes WHERE user_id = ? AND note_id = ?').bind(userId, noteId).run();
  await addTombstone(db, userId, 'note', noteId);
}

// ---------- Tombstones ----------

async function addTombstone(db: D1Database, userId: string, entity: string, entityKey: string) {
  await db.prepare(`
    INSERT INTO tombstones (id, user_id, entity, entity_key, deleted_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, entity, entity_key) DO UPDATE SET deleted_at = excluded.deleted_at
  `).bind(generateId(), userId, entity, entityKey, Date.now()).run();
}

// 重新添加同一条数据时清掉墓碑，避免下次拉取时被误删
async function clearTombstone(db: D1Database, userId: string, entity: string, entityKey: string) {
  await db.prepare('DELETE FROM tombstones WHERE user_id = ? AND entity = ? AND entity_key = ?')
    .bind(userId, entity, entityKey).run();
}

export async function getTombstones(db: D1Database, userId: string, since: number) {
  const result = await db.prepare(
    'SELECT entity, entity_key FROM tombstones WHERE user_id = ? AND deleted_at > ?'
  ).bind(userId, since).all();

  const readLaters: string[] = [];
  const notes: string[] = [];
  const favorites: string[] = [];
  const records: string[] = [];
  for (const row of result.results || []) {
    if (row.entity === 'read_later') readLaters.push(row.entity_key as string);
    else if (row.entity === 'note') notes.push(row.entity_key as string);
    else if (row.entity === 'favorite') favorites.push(row.entity_key as string);
    else if (row.entity === 'record') records.push(row.entity_key as string);
  }
  return { readLaters, notes, favorites, records };
}

// ---------- Helpers ----------

function parseReadLater(row: any): ReadLater {
  return {
    id: row.id,
    user_id: row.user_id,
    key: row.key,
    url: row.url,
    title: row.title,
    create_datetime: row.create_datetime,
    start_read_datetime: row.start_read_datetime,
    end_read_datetime: row.end_read_datetime,
    status: row.status,
    position: {
      progress: row.position_progress,
      scrollX: row.position_scroll_x,
      scrollY: row.position_scroll_y
    },
    updated_at: row.updated_at ?? undefined,
    synced_at: row.synced_at
  };
}

function parseFavorite(row: any): Favorite {
  return {
    id: row.id,
    user_id: row.user_id,
    key: row.key,
    url: row.url,
    title: row.title,
    create_datetime: row.create_datetime,
    updated_at: row.updated_at ?? undefined,
    synced_at: row.synced_at
  };
}

function parseNote(row: any): Note {
  return {
    id: row.id,
    page_id: row.page_id,
    user_id: row.user_id,
    note_id: row.note_id,
    scope: row.scope,
    selection_text: row.selection_text,
    comment: row.comment,
    author: row.author,
    prefix: row.prefix,
    suffix: row.suffix,
    text_position: row.text_position,
    create_datetime: row.create_datetime,
    updated_at: row.updated_at,
    synced_at: row.synced_at
  };
}
