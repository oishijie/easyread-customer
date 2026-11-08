import {
  ALL_RECORDS_NAME,
  FAVORITE_DELETIONS_NAME,
  FAVORITES_NAME,
  NOTES_NAME,
  READ_LATER_DELETIONS_NAME,
  READ_LATERS_NAME,
  NOTE_DELETIONS_NAME,
  RECORD_DELETIONS_NAME,
  SYNC_CONFIG_NAME,
  SYNC_DIRTY_NAME,
  SYNC_STATE_NAME,
  latestRecordTime,
  mergeAllRecords,
  mergeFavorites,
  mergeReadLaters
} from './easyReadData.mjs';
import { applyRemoteNotes } from './notesStore.mjs';

const DEFAULT_CONFIG = { apiEndpoint: '', token: '', userId: '', email: '', lastSyncAt: 0 };
const REQUEST_TIMEOUT_MS = 20000;
const DEBOUNCE_MS = 5000;
// 拉取会写本地存储，期间触发的 onChanged 不应再算作本地改动，否则会自激同步。
const APPLY_SUPPRESS_MS = 2000;
// 位置/视频进度这类高频写入打上 progress 标记：只随周期同步（15 分钟），
// 不触发 5 秒防抖的全量推送，否则连续滚动会打爆服务端写入配额。
const PROGRESS_WRITE_WINDOW_MS = 1500;
const COLLECTIONS = [READ_LATERS_NAME, ALL_RECORDS_NAME, NOTES_NAME, FAVORITES_NAME];

let debounceTimer = null;
let running = null;
let suppressUntil = 0;
let progressWriteUntil = 0;

export function normalizeEndpoint(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  // 用户往往只填域名，没带协议
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function getSyncConfig() {
  const stored = await chrome.storage.local.get(SYNC_CONFIG_NAME);
  return { ...DEFAULT_CONFIG, ...(stored[SYNC_CONFIG_NAME] || {}) };
}

export async function saveSyncConfig(patch) {
  const next = { ...(await getSyncConfig()), ...patch };
  next.apiEndpoint = normalizeEndpoint(next.apiEndpoint);
  await chrome.storage.local.set({ [SYNC_CONFIG_NAME]: next });
  return next;
}

export async function getSyncState() {
  const stored = await chrome.storage.local.get(SYNC_STATE_NAME);
  return stored[SYNC_STATE_NAME] || { status: 'idle' };
}

async function setSyncState(state) {
  await chrome.storage.local.set({ [SYNC_STATE_NAME]: { ...state, at: Date.now() } });
}

// 背景脚本在写滚动位置/视频进度之前调用：之后的 onChanged 会被归为 progress 类改动。
export function markProgressWrite() {
  progressWriteUntil = Date.now() + PROGRESS_WRITE_WINDOW_MS;
}

export function isProgressWrite() {
  return Date.now() < progressWriteUntil;
}

async function getDirtyCollections() {
  const stored = (await chrome.storage.local.get(SYNC_DIRTY_NAME))[SYNC_DIRTY_NAME];
  if (stored === true) return Object.fromEntries(COLLECTIONS.map(name => [name, true]));
  if (stored && typeof stored === 'object') return { ...Object.fromEntries(COLLECTIONS.map(name => [name, false])), ...stored };
  return Object.fromEntries(COLLECTIONS.map(name => [name, false]));
}

async function markDirty(collections) {
  const current = await getDirtyCollections();
  const targets = Array.isArray(collections) && collections.length ? collections : COLLECTIONS;
  for (const name of targets) if (current[name] !== undefined) current[name] = true;
  await chrome.storage.local.set({ [SYNC_DIRTY_NAME]: current });
}

async function clearDirty(collections) {
  const current = await getDirtyCollections();
  for (const name of (Array.isArray(collections) && collections.length ? collections : COLLECTIONS)) {
    if (current[name] !== undefined) current[name] = false;
  }
  await chrome.storage.local.set({ [SYNC_DIRTY_NAME]: current });
}

async function request(config, path, options = {}) {
  const endpoint = normalizeEndpoint(config.apiEndpoint);
  if (!endpoint) throw Object.assign(new Error('Sync endpoint is not configured'), { code: 'no_endpoint' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    response = await fetch(`${endpoint}${path}`, { ...options, headers, signal: controller.signal });
  } catch (error) {
    // 超时和连不上要分开报，否则用户没法判断是网络还是服务端
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`${endpoint} 在 ${REQUEST_TIMEOUT_MS / 1000} 秒内没有响应（检查网络或代理后重试）`), { code: 'timeout' });
    }
    throw Object.assign(new Error(`${error?.message || 'Network error'}（${endpoint}）`), { code: 'network' });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || data?.error || `HTTP ${response.status}`), {
      code: response.status === 401 ? 'unauthorized' : (data?.error || `http_${response.status}`),
      status: response.status
    });
  }
  return data;
}

// 只探连通性，不涉登录，用来把「网络不通」和「账号不对」区分开
export async function pingEndpoint(apiEndpoint) {
  const endpoint = normalizeEndpoint(apiEndpoint);
  if (!endpoint) throw Object.assign(new Error('No endpoint'), { code: 'no_endpoint' });
  const started = Date.now();
  const data = await request({ apiEndpoint: endpoint, token: '' }, '/health', { method: 'GET' });
  return { latency: Date.now() - started, healthy: data?.status === 'ok' };
}

export async function signIn({ apiEndpoint, email, password, register = false }) {
  const config = await saveSyncConfig({ apiEndpoint });
  let data;
  try {
    data = await request({ ...config, token: '' }, register ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  } catch (error) {
    // 登录时的 401 是账号或密码不对，不是会话失效，两者提示不能混用
    if (error?.status === 401) throw Object.assign(new Error(error.message), { code: 'bad_credentials' });
    if (error?.code === 'CONFLICT') throw Object.assign(new Error(error.message), { code: 'account_exists' });
    throw error;
  }
  if (!data?.token) throw Object.assign(new Error('Login returned no token'), { code: 'login_failed' });
  const next = await saveSyncConfig({ token: data.token, userId: data.user_id || '', email, lastSyncAt: 0 });
  // 新登录的账号需要把本地已有数据先推上去
  await markDirty();
  await setSyncState({ status: 'idle' });
  return next;
}

export async function signOut() {
  await saveSyncConfig({ token: '', userId: '', lastSyncAt: 0 });
  // 待上报的删除队列属于上一个账号，绝不能带进下一次登录，否则会误删新账号的云端数据
  await chrome.storage.local.remove([FAVORITE_DELETIONS_NAME, READ_LATER_DELETIONS_NAME, NOTE_DELETIONS_NAME, RECORD_DELETIONS_NAME]);
  await clearDirty();
  await setSyncState({ status: 'idle' });
}

// push 只上传 dirty 里为 true 的集合（force 时全量）；删除队列只要非空就始终带上。
async function push(config, dirty) {
  const stored = await chrome.storage.local.get([
    READ_LATERS_NAME, ALL_RECORDS_NAME, NOTES_NAME, FAVORITES_NAME,
    FAVORITE_DELETIONS_NAME, READ_LATER_DELETIONS_NAME, NOTE_DELETIONS_NAME, RECORD_DELETIONS_NAME
  ]);
  const want = name => !dirty || dirty[name] === true;
  const deletions = (name, fallback = []) => {
    const list = stored[name];
    return Array.isArray(list) ? list : fallback;
  };
  const readLaterDeletions = deletions(READ_LATER_DELETIONS_NAME);
  const noteDeletions = deletions(NOTE_DELETIONS_NAME);
  const recordDeletions = deletions(RECORD_DELETIONS_NAME);
  const favoriteDeletions = deletions(FAVORITE_DELETIONS_NAME);

  const body = { readLaterDeletions, noteDeletions, recordDeletions, favoriteDeletions };

  if (want(READ_LATERS_NAME)) {
    const items = Array.isArray(stored[READ_LATERS_NAME]) ? stored[READ_LATERS_NAME] : [];
    // 旧数据没有 updatedAt：推送时用创建时间补一个版本号，让服务端 LWW 有据可依
    body.readLaters = items.map(item => (item?.updatedAt ? item : { ...item, updatedAt: item?.createDateTime ?? 0 }));
  }
  if (want(ALL_RECORDS_NAME)) {
    const records = stored[ALL_RECORDS_NAME] && typeof stored[ALL_RECORDS_NAME] === 'object' ? stored[ALL_RECORDS_NAME] : {};
    body.allRecords = Object.fromEntries(Object.entries(records).map(([key, record]) => [
      key,
      record?.updatedAt ? record : { ...record, updatedAt: latestRecordTime(record) }
    ]));
  }
  if (want(NOTES_NAME)) body.notes = stored[NOTES_NAME] && typeof stored[NOTES_NAME] === 'object' ? stored[NOTES_NAME] : {};
  if (want(FAVORITES_NAME)) {
    const items = Array.isArray(stored[FAVORITES_NAME]) ? stored[FAVORITES_NAME] : [];
    body.favorites = items.map(item => (item?.updatedAt ? item : { ...item, updatedAt: item?.createDateTime ?? 0 }));
  }

  const result = await request(config, '/api/sync/full', { method: 'POST', body: JSON.stringify(body) });
  // 服务端已把这些删除落成墓碑，本地待上报队列可以清了
  const queues = [
    [FAVORITE_DELETIONS_NAME, favoriteDeletions],
    [READ_LATER_DELETIONS_NAME, readLaterDeletions],
    [NOTE_DELETIONS_NAME, noteDeletions],
    [RECORD_DELETIONS_NAME, recordDeletions]
  ];
  const clearUpdates = {};
  for (const [name, queue] of queues) if (queue.length) clearUpdates[name] = [];
  if (Object.keys(clearUpdates).length) await chrome.storage.local.set(clearUpdates);
  await clearDirty(dirty ? Object.keys(dirty).filter(name => dirty[name] === true && COLLECTIONS.includes(name)) : COLLECTIONS);
  return result;
}

async function applyPull(data) {
  suppressUntil = Date.now() + APPLY_SUPPRESS_MS;

  const stored = await chrome.storage.local.get([READ_LATERS_NAME, ALL_RECORDS_NAME, FAVORITES_NAME]);
  const deletedKeys = Array.isArray(data?.deletedIds?.readLaters) ? data.deletedIds.readLaters : [];
  const deletedNoteIds = Array.isArray(data?.deletedIds?.notes) ? data.deletedIds.notes : [];
  const deletedFavoriteKeys = Array.isArray(data?.deletedIds?.favorites) ? data.deletedIds.favorites : [];
  const deletedRecordKeys = Array.isArray(data?.deletedIds?.records) ? data.deletedIds.records : [];

  const updates = {};

  const localReadLaters = Array.isArray(stored[READ_LATERS_NAME]) ? stored[READ_LATERS_NAME] : [];
  const nextReadLaters = mergeReadLaters(localReadLaters, data?.readLaters || [], deletedKeys);
  if (JSON.stringify(nextReadLaters) !== JSON.stringify(localReadLaters)) updates[READ_LATERS_NAME] = nextReadLaters;

  const localRecords = stored[ALL_RECORDS_NAME] && typeof stored[ALL_RECORDS_NAME] === 'object' ? stored[ALL_RECORDS_NAME] : {};
  const nextRecords = mergeAllRecords(localRecords, data?.allRecords || {}, deletedRecordKeys);
  if (JSON.stringify(nextRecords) !== JSON.stringify(localRecords)) updates[ALL_RECORDS_NAME] = nextRecords;

  const localFavorites = Array.isArray(stored[FAVORITES_NAME]) ? stored[FAVORITES_NAME] : [];
  const nextFavorites = mergeFavorites(localFavorites, data?.favorites || [], deletedFavoriteKeys);
  if (JSON.stringify(nextFavorites) !== JSON.stringify(localFavorites)) updates[FAVORITES_NAME] = nextFavorites;

  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  await applyRemoteNotes(data?.notes || {}, deletedNoteIds);

  suppressUntil = Date.now() + APPLY_SUPPRESS_MS;
  return { readLaters: nextReadLaters.length, records: Object.keys(nextRecords).length, favorites: nextFavorites.length };
}

// force=true 时无条件上传本地全量；否则只上传脏集合，避免每轮同步都写库。
export function syncNow({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const config = await getSyncConfig();
    if (!config.token) throw Object.assign(new Error('Not signed in'), { code: 'not_logged_in' });

    await setSyncState({ status: 'running' });
    try {
      let pushed = false;
      const dirty = await getDirtyCollections();
      const hasDirty = COLLECTIONS.some(name => dirty[name]);
      if (force || hasDirty) {
        await push(config, force ? null : dirty);
        pushed = true;
      }
      const data = await pull(config);
      const counts = await applyPull(data);
      await saveSyncConfig({ lastSyncAt: data?.syncedAt || Date.now() });
      await setSyncState({ status: 'ok', pushed, counts });
      return { ok: true, pushed, counts };
    } catch (error) {
      await setSyncState({
        status: 'error',
        code: error?.code || (error?.name === 'AbortError' ? 'timeout' : error instanceof TypeError ? 'network' : 'unknown'),
        detail: String(error?.message || error)
      });
      throw error;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function pull(config) {
  return request(config, `/api/sync/pull?since=${Number(config.lastSyncAt) || 0}`);
}

export function scheduleSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow().catch(error => console.warn('EasyRead sync failed:', error?.code || error?.message));
  }, DEBOUNCE_MS);
}

export async function notifyLocalChange(collections) {
  await markDirty(collections);
  scheduleSync();
}

// progress 类改动（滚动位置/视频进度）：只标脏、不触发防抖推送，等 15 分钟周期同步。
// 服务端 LWW 需要版本号，progress 写入本身会把 updatedAt 一起刷新。
export async function notifyProgressChange(collections) {
  await markDirty(collections);
}

export function isApplyingRemote() {
  return Date.now() < suppressUntil;
}

export function cancelScheduledSync() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
}
