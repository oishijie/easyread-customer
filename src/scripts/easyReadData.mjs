export const ALL_RECORDS_NAME = "allRecords";
export const READ_LATERS_NAME = "readLaters";
export const READ_STATUS_UNREAD = 0;
export const READ_STATUS_READING = 1;
export const READ_STATUS_READED = 2;
export const NOTES_NAME = "notes";
export const ANNOTATIONS_NAME = "annotations";
export const ANNOTATION_AUTHOR_NAME = "annotationAuthor";
export const HIGHLIGHTS_ENABLED_NAME = "highlightsEnabled";
export const ARTIFACTS_NAME = "artifacts";
export const SYNC_CONFIG_NAME = "syncConfig";
export const SYNC_ENABLED_NAME = "syncEnabled";
export const SYNC_STATE_NAME = "syncState";
export const SYNC_DIRTY_NAME = "syncDirty";
export const FAVORITES_NAME = "favorites";
// 本地删掉的收藏键：push 时要一起上报，否则服务端那条还在，下次拉取会把收藏「复活」
export const FAVORITE_DELETIONS_NAME = "favoriteDeletions";

export function addFavoriteDeletion(existing, key) {
  const list = Array.isArray(existing) ? existing : [];
  const normalized = syncPageKey(key);
  if (!normalized || list.includes(normalized)) return list;
  return [...list, normalized];
}

// 保存网页面板条目的顺序：未知键丢弃，未记录过的键（版本升级新增）补到末尾
export function orderSaveKeys(storedOrder, availableKeys) {
  const available = Array.isArray(availableKeys) ? availableKeys : [];
  const known = new Set(available);
  const ordered = [];
  for (const key of Array.isArray(storedOrder) ? storedOrder : []) {
    if (known.has(key) && !ordered.includes(key)) ordered.push(key);
  }
  for (const key of available) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}
export const SNAPSHOT_UPLOAD_NAME = "snapshotUploadEnabled";
export const SNAPSHOT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

// 扩展侧保存类型 → 后端快照格式；PDF 走浏览器打印对话框、没有字节流，故不上传
export function snapshotUploadFormat(captureType) {
  if (captureType === "image") return "screenshot";
  if (captureType === "html" || captureType === "markdown") return captureType;
  return null;
}

export const UPDATE_STATUS_YES = 0;
export const UPDATE_STATUS_NO = 1;
export const KEYCHAIN_SEPARATOR = "__EasyReadSeparator__";

export function createArtifactRecord({
  id,
  pageKey,
  sourceUrl,
  title,
  format,
  fileName,
  mimeType,
  size,
  integrity = "complete",
  details = {},
  now = Date.now
}) {
  return {
    id,
    pageKey,
    sourceUrl,
    title,
    format,
    fileName,
    mimeType,
    size: Number.isFinite(size) ? Math.max(0, size) : 0,
    status: "completed",
    integrity,
    details,
    createdAt: now()
  };
}

export function parseHlsPlaylist(text, playlistUrl) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  const segments = [];
  let pendingVariant = null;
  let currentKey = null;
  let initSegment = null;

  const resolveUrl = (value) => new URL(value, playlistUrl).href;
  const parseAttributes = (value) => Object.fromEntries(
    value.split(/,(?=[A-Z0-9-]+=)/).map((part) => {
      const [key, ...rest] = part.split("=");
      return [key, rest.join("=").replace(/^"|"$/g, "")];
    })
  );

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingVariant = parseAttributes(line.slice(18));
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributes(line.slice(11));
      currentKey = attrs.METHOD === "NONE" ? null : {
        method: attrs.METHOD,
        uri: attrs.URI ? resolveUrl(attrs.URI) : null,
        iv: attrs.IV ?? null
      };
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseAttributes(line.slice(11));
      initSegment = attrs.URI ? resolveUrl(attrs.URI) : null;
      continue;
    }
    if (line.startsWith("#")) continue;
    const url = resolveUrl(line);
    if (pendingVariant) {
      variants.push({ url, bandwidth: Number(pendingVariant.BANDWIDTH) || 0 });
      pendingVariant = null;
    } else {
      segments.push({ url, key: currentKey });
    }
  }

  return { variants, segments, initSegment };
}

export function normalizePageUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.split("#")[0].toLowerCase().trim();
}

export function decodeStoredText(value) {
  const text = String(value ?? '');
  try { return decodeURIComponent(text); } catch { return text; }
}

export function validateStorageImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    throw new Error('Invalid backup: expected a non-empty storage object.');
  }
  const collections = { allRecords: 'datetimes', notes: 'notes', annotations: 'annotations', artifacts: 'artifacts' };
  for (const [key, field] of Object.entries(collections)) {
    if (!(key in data)) continue;
    const pages = data[key];
    if (!pages || typeof pages !== 'object' || (Array.isArray(pages) && pages.length)) throw new Error(`Invalid backup: ${key}`);
    for (const [pageKey, page] of Object.entries(pages)) {
      if (['__proto__', 'constructor', 'prototype'].includes(normalizePageUrl(pageKey))) throw new Error('Invalid backup: unsafe page key');
      if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page[field])) throw new Error(`Invalid backup: ${key}.${pageKey}.${field}`);
    }
  }
  if ('readLaters' in data && (!Array.isArray(data.readLaters) || data.readLaters.some(item => !item || typeof item !== 'object' || typeof item.key !== 'string'))) {
    throw new Error('Invalid backup: readLaters');
  }
  // Settings and unknown future keys remain untouched for backup compatibility.
  return data;
}

export function latestRecordTime(item) {
  let latest = Number(item?.videoProgress?.updatedAt) || 0;
  for (const value of Array.isArray(item?.datetimes) ? item.datetimes : []) {
    const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
    if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
  }
  return latest;
}

export function indexRecords(records) {
  return Object.entries(records ?? {}).filter(([, value]) => value && typeof value === 'object')
    .map(([key, value]) => ({ ...value, key, latestRead: latestRecordTime(value) }))
    .sort((left, right) => right.latestRead - left.latestRead);
}

export function createNoteItem(selectionText, context = {}) {
  const item = {
    id: context.id,
    selectionText: encodeURIComponent(selectionText),
    createDateTime: context.now()
  };

  if (context.prefix) item.prefix = encodeURIComponent(context.prefix);
  if (context.suffix) item.suffix = encodeURIComponent(context.suffix);
  return item;
}

export function removeNoteById(notesByPage, pageKey, noteId) {
  const page = notesByPage?.[pageKey];
  if (!page?.notes) return { notesByPage, removed: false };

  const remainingNotes = page.notes.filter((note) => String(note.id) !== String(noteId));
  if (remainingNotes.length === page.notes.length) {
    return { notesByPage, removed: false };
  }

  const nextNotesByPage = { ...notesByPage };
  if (remainingNotes.length === 0) {
    delete nextNotesByPage[pageKey];
  } else {
    nextNotesByPage[pageKey] = { ...page, notes: remainingNotes };
  }
  return { notesByPage: nextNotesByPage, removed: true };
}

export function createAnnotation(selectionText, comment, context = {}) {
  const annotation = {
    id: context.id,
    selectionText: encodeURIComponent(selectionText),
    comment,
    author: context.author ?? "",
    createDateTime: context.now()
  };
  if (context.prefix) annotation.prefix = encodeURIComponent(context.prefix);
  if (context.suffix) annotation.suffix = encodeURIComponent(context.suffix);
  return annotation;
}

export function paginateRecords(allRecords, page, pageSize = 500) {
  const items = indexRecords(allRecords);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    startIndex: start
  };
}

export function applyVideoProgress(record, progress) {
  if (!progress || !Number.isFinite(progress.currentTime) || !Number.isFinite(progress.duration) || progress.duration <= 0) {
    return record ?? {};
  }
  return {
    ...(record ?? {}),
    videoProgress: {
      currentTime: Math.max(0, progress.currentTime),
      duration: progress.duration,
      progress: Math.min(100, Math.max(0, progress.currentTime / progress.duration * 100)),
      updatedAt: progress.updatedAt
    }
  };
}

export function createReadLaterUpdate(queryValue, context) {
  const oldValue = queryValue[context.storageKey];
  const key = normalizePageUrl(context.tab.url);
  const result = {
    status: UPDATE_STATUS_NO,
    value: null,
    message: "",
    callback_onUpdated: context.callbackOnUpdated
  };

  if (!oldValue) {
    result.value = [{
      key,
      url: context.tab.url,
      title: context.tab.title,
      createDateTime: context.now(),
      status: READ_STATUS_UNREAD
    }];
    result.status = UPDATE_STATUS_YES;
    result.message = context.messages.first;
    return result;
  }

  const alreadyUnread = oldValue.some((item) =>
    key === item.key && [READ_STATUS_UNREAD, READ_STATUS_READING].includes(item.status)
  );
  if (alreadyUnread) {
    result.message = context.messages.duplicate;
    return result;
  }

  result.value = [...oldValue, {
    key,
    url: context.tab.url,
    title: context.tab.title,
    createDateTime: context.now(),
    status: READ_STATUS_UNREAD
  }];
  result.status = UPDATE_STATUS_YES;
  result.message = context.messages.added;
  return result;
}

export function createFavoriteUpdate(queryValue, context) {
  const oldValue = queryValue[context.storageKey];
  const key = normalizePageUrl(context.tab.url);
  const list = Array.isArray(oldValue) ? oldValue : [];
  const result = {
    status: UPDATE_STATUS_NO,
    value: null,
    message: "",
    callback_onUpdated: context.callbackOnUpdated
  };

  if (list.some((item) => item.key === key)) {
    result.message = context.messages.duplicate;
    return result;
  }

  result.value = [...list, {
    key,
    url: context.tab.url,
    title: context.tab.title,
    createDateTime: context.now()
  }];
  result.status = UPDATE_STATUS_YES;
  result.message = context.messages.added;
  return result;
}

export function removeFavoriteEntry(queryValue, context) {
  const oldValue = queryValue[context.storageKey];
  const list = Array.isArray(oldValue) ? oldValue : [];
  const next = list.filter((item) => item.key !== context.pageKey);
  if (next.length === list.length) {
    return { status: UPDATE_STATUS_NO, value: null, message: context.messages.missing };
  }
  return { status: UPDATE_STATUS_YES, value: next, message: context.messages.removed };
}

export function createTabNavigationTracker() {
  const states = new Map();

  return {
    markActivated(tabId, url) {
      states.set(tabId, { pageKey: normalizePageUrl(url), recordOnComplete: false });
    },

    markLoading(tabId, url) {
      const state = states.get(tabId);
      const nextPageKey = normalizePageUrl(url);
      const isAnchorOnly = Boolean(state && nextPageKey && state.pageKey === nextPageKey);
      states.set(tabId, {
        pageKey: state?.pageKey ?? nextPageKey,
        recordOnComplete: !isAnchorOnly
      });
    },

    shouldRecordOnComplete(tabId, url) {
      const currentPageKey = normalizePageUrl(url);
      const state = states.get(tabId);
      const shouldRecord = !state || state.recordOnComplete || state.pageKey !== currentPageKey;
      states.set(tabId, { pageKey: currentPageKey, recordOnComplete: false });
      return shouldRecord;
    },

    remove(tabId) {
      states.delete(tabId);
    }
  };
}

/* -------- Cloud sync merge (pure) -------- */

function syncPageKey(value) {
  return normalizePageUrl(typeof value === 'string' ? value : '');
}

function syncNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Read Later 以页面 key 为身份；阅读状态单调递增，取两边较大的值。
export function mergeReadLaters(localItems, remoteItems, deletedKeys = []) {
  const merged = new Map();
  for (const item of Array.isArray(localItems) ? localItems : []) {
    const key = syncPageKey(item?.key || item?.url);
    if (key) merged.set(key, { ...item });
  }
  for (const item of Array.isArray(remoteItems) ? remoteItems : []) {
    const key = syncPageKey(item?.key || item?.url);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item });
      continue;
    }
    const next = { ...existing };
    next.status = Math.max(syncNumber(existing.status), syncNumber(item.status));
    if (!next.position && item.position) next.position = item.position;
    if (!next.title && item.title) next.title = item.title;
    if (!next.url && item.url) next.url = item.url;
    if (!next.createDateTime && item.createDateTime) next.createDateTime = item.createDateTime;
    if (next.status === READ_STATUS_READED && !next.endReadDateTime && item.endReadDateTime) next.endReadDateTime = item.endReadDateTime;
    merged.set(key, next);
  }
  for (const key of Array.isArray(deletedKeys) ? deletedKeys : []) {
    merged.delete(syncPageKey(key));
  }
  return [...merged.values()];
}

// 收藏按 key 去重合并，远端只补本地缺失的字段，不做字段级覆盖；墓碑里的直接删除。
export function mergeFavorites(localItems, remoteItems, deletedKeys = []) {
  const merged = new Map();
  for (const item of Array.isArray(localItems) ? localItems : []) {
    const key = syncPageKey(item?.key || item?.url);
    if (key) merged.set(key, { ...item });
  }
  for (const item of Array.isArray(remoteItems) ? remoteItems : []) {
    const key = syncPageKey(item?.key || item?.url);
    if (!key || merged.has(key)) continue;
    merged.set(key, { ...item });
  }
  for (const key of Array.isArray(deletedKeys) ? deletedKeys : []) {
    merged.delete(syncPageKey(key));
  }
  return [...merged.values()];
}

// 访问记录按页面累积，datetimes 取并集去重；其余字段本地优先。
export function mergeAllRecords(localRecords, remoteRecords) {
  const merged = {};
  for (const [key, value] of Object.entries(localRecords && typeof localRecords === 'object' ? localRecords : {})) {
    const pageKey = syncPageKey(key);
    if (pageKey && value && typeof value === 'object') merged[pageKey] = { ...value };
  }
  for (const [key, value] of Object.entries(remoteRecords && typeof remoteRecords === 'object' ? remoteRecords : {})) {
    const pageKey = syncPageKey(key);
    if (!pageKey || !value || typeof value !== 'object') continue;
    const existing = merged[pageKey];
    if (!existing) {
      merged[pageKey] = { ...value };
      continue;
    }
    const datetimes = [...new Set([
      ...(Array.isArray(existing.datetimes) ? existing.datetimes : []),
      ...(Array.isArray(value.datetimes) ? value.datetimes : [])
    ])].sort((left, right) => left - right);
    const next = { ...existing, datetimes };
    if (!next.title && value.title) next.title = value.title;
    if (!next.url && value.url) next.url = value.url;
    if (!next.position && value.position) next.position = value.position;
    merged[pageKey] = next;
  }
  return merged;
}

// 笔记按页面 + note.id 合并；云端只补充本地没有的笔记，删除以 deletedNoteIds 为准。
export function mergeNotePages(localNotes, remoteNotes, deletedNoteIds = []) {
  const merged = {};
  for (const [key, page] of Object.entries(localNotes && typeof localNotes === 'object' ? localNotes : {})) {
    const pageKey = syncPageKey(key);
    if (!pageKey || !page || !Array.isArray(page.notes)) continue;
    merged[pageKey] = { ...page, notes: page.notes.map(note => ({ ...note })) };
  }
  for (const [key, page] of Object.entries(remoteNotes && typeof remoteNotes === 'object' ? remoteNotes : {})) {
    const pageKey = syncPageKey(key);
    if (!pageKey || !page || !Array.isArray(page.notes)) continue;
    const target = merged[pageKey] || { title: page.title, url: page.url || key, createDateTime: page.createDateTime, notes: [] };
    if (!target.title && page.title) target.title = page.title;
    if (!target.url && page.url) target.url = page.url;
    if (!target.createDateTime && page.createDateTime) target.createDateTime = page.createDateTime;
    const known = new Set(target.notes.map(note => String(note?.id)));
    for (const note of page.notes) {
      if (!note || note.id === undefined || note.id === null) continue;
      if (known.has(String(note.id))) continue;
      target.notes.push({ ...note });
      known.add(String(note.id));
    }
    merged[pageKey] = target;
  }
  if (Array.isArray(deletedNoteIds) && deletedNoteIds.length) {
    const removed = new Set(deletedNoteIds.map(String));
    for (const [pageKey, page] of Object.entries(merged)) {
      const remaining = page.notes.filter(note => !removed.has(String(note?.id)));
      if (remaining.length) page.notes = remaining;
      else delete merged[pageKey];
    }
  }
  return merged;
}
