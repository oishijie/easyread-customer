// 数据库工具函数
import type { ReadLater, Note, Favorite } from '../types';

export function generateId(): string {
  return crypto.randomUUID();
}

export function normalizePageUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  return url.split('#')[0].toLowerCase().trim();
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

// 按 (user_id, key) 幂等写入，重复同步不会产生重复行
export async function upsertReadLater(
  db: D1Database,
  userId: string,
  data: Partial<ReadLater> & { key: string; url: string; title: string; createDateTime?: number }
) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO read_laters (id, user_id, key, url, title, create_datetime, status,
      position_progress, position_scroll_x, position_scroll_y, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      status = excluded.status,
      position_progress = excluded.position_progress,
      position_scroll_x = excluded.position_scroll_x,
      position_scroll_y = excluded.position_scroll_y,
      synced_at = excluded.synced_at
  `).bind(
    generateId(), userId, data.key, data.url, data.title,
    data.create_datetime ?? data.createDateTime ?? now,
    data.status ?? 0,
    data.position?.progress ?? null,
    data.position?.scrollX ?? null,
    data.position?.scrollY ?? null,
    now
  ).run();

  const row = await db.prepare('SELECT id FROM read_laters WHERE user_id = ? AND key = ?')
    .bind(userId, data.key).first();
  await clearTombstone(db, userId, 'read_later', data.key);
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

// 按 (user_id, key) 幂等写入，key 是规范化后的页面 URL
export async function upsertFavorite(
  db: D1Database,
  userId: string,
  data: Partial<Favorite> & { key: string; url: string; title?: string; createDateTime?: number }
) {
  const now = Date.now();
  const key = data.key || normalizePageUrl(data.url);

  await db.prepare(`
    INSERT INTO favorites (id, user_id, key, url, title, create_datetime, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      synced_at = excluded.synced_at
  `).bind(
    generateId(), userId, key, data.url, data.title || data.url,
    data.create_datetime ?? data.createDateTime ?? now, now
  ).run();

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
    const url = typeof record.url === 'string' ? record.url : '';
    if (!url) continue;

    await db.prepare(`
      INSERT INTO all_records (id, user_id, url, title, datetime,
        position_progress, position_scroll_x, position_scroll_y, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, url) DO UPDATE SET
        title = excluded.title,
        datetime = excluded.datetime,
        position_progress = excluded.position_progress,
        position_scroll_x = excluded.position_scroll_x,
        position_scroll_y = excluded.position_scroll_y,
        synced_at = excluded.synced_at
    `).bind(
      generateId(), userId, url, record.title || url,
      JSON.stringify(Array.isArray(record.datetimes) ? record.datetimes : Array.isArray(record.datetime) ? record.datetime : []),
      record.position?.progress ?? null,
      record.position?.scrollX ?? null,
      record.position?.scrollY ?? null,
      now
    ).run();

    synced++;
  }

  return synced;
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

// 按 (user_id, note_id) 幂等写入，note_id 取扩展侧的原始 ID
export async function upsertNote(
  db: D1Database,
  userId: string,
  url: string,
  title: string,
  note: Partial<Note> & { id?: string; createDateTime?: number }
) {
  const normalizedUrl = normalizePageUrl(url);
  // 扩展侧的笔记主键叫 id，后端列叫 note_id，两者必须对齐才能幂等
  const noteId = note.note_id || note.id || generateId();
  const now = Date.now();
  const created = note.create_datetime || note.createDateTime || now;

  const pageId = await ensureNotesPage(db, userId, normalizedUrl, title || normalizedUrl, created);

  await db.prepare(`
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
  `).bind(
    generateId(), pageId, userId, noteId, note.scope || 'text',
    note.selection_text ?? null, note.comment ?? null, note.author ?? null,
    note.prefix ?? null, note.suffix ?? null, note.text_position ?? null,
    note.create_datetime || note.createDateTime || now, note.updated_at ?? null, now
  ).run();

  await clearTombstone(db, userId, 'note', noteId);
  return noteId;
}

export async function deleteNote(db: D1Database, userId: string, noteId: string) {
  const row = await db.prepare('SELECT note_id FROM notes WHERE id = ? AND user_id = ?')
    .bind(noteId, userId).first();
  await db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(noteId, userId).run();
  if (row?.note_id) await addTombstone(db, userId, 'note', row.note_id as string);
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
  for (const row of result.results || []) {
    if (row.entity === 'read_later') readLaters.push(row.entity_key as string);
    else if (row.entity === 'note') notes.push(row.entity_key as string);
    else if (row.entity === 'favorite') favorites.push(row.entity_key as string);
  }
  return { readLaters, notes, favorites };
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
