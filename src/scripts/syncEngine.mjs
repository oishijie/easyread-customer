import {
  ALL_RECORDS_NAME,
  FAVORITE_DELETIONS_NAME,
  FAVORITES_NAME,
  NOTES_NAME,
  READ_LATERS_NAME,
  SYNC_CONFIG_NAME,
  SYNC_DIRTY_NAME,
  SYNC_STATE_NAME,
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

let debounceTimer = null;
let running = null;
let suppressUntil = 0;

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

async function setDirty(value) {
  await chrome.storage.local.set({ [SYNC_DIRTY_NAME]: value });
}

async function isDirty() {
  const stored = await chrome.storage.local.get(SYNC_DIRTY_NAME);
  return stored[SYNC_DIRTY_NAME] === true;
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
  await setDirty(true);
  await setSyncState({ status: 'idle' });
  return next;
}

export async function signOut() {
  await saveSyncConfig({ token: '', userId: '', lastSyncAt: 0 });
  await setDirty(false);
  await setSyncState({ status: 'idle' });
}

async function push(config) {
  const stored = await chrome.storage.local.get([READ_LATERS_NAME, ALL_RECORDS_NAME, NOTES_NAME, FAVORITES_NAME, FAVORITE_DELETIONS_NAME]);
  const deletions = Array.isArray(stored[FAVORITE_DELETIONS_NAME]) ? stored[FAVORITE_DELETIONS_NAME] : [];
  const body = {
    readLaters: Array.isArray(stored[READ_LATERS_NAME]) ? stored[READ_LATERS_NAME] : [],
    allRecords: stored[ALL_RECORDS_NAME] && typeof stored[ALL_RECORDS_NAME] === 'object' ? stored[ALL_RECORDS_NAME] : {},
    notes: stored[NOTES_NAME] && typeof stored[NOTES_NAME] === 'object' ? stored[NOTES_NAME] : {},
    favorites: Array.isArray(stored[FAVORITES_NAME]) ? stored[FAVORITES_NAME] : [],
    favoriteDeletions: deletions
  };
  const result = await request(config, '/api/sync/full', { method: 'POST', body: JSON.stringify(body) });
  // 服务端已把这些删除落成墓碑，本地待上报队列可以清了
  if (deletions.length) await chrome.storage.local.set({ [FAVORITE_DELETIONS_NAME]: [] });
  await setDirty(false);
  return result;
}

async function applyPull(data) {
  suppressUntil = Date.now() + APPLY_SUPPRESS_MS;

  const stored = await chrome.storage.local.get([READ_LATERS_NAME, ALL_RECORDS_NAME, FAVORITES_NAME]);
  const deletedKeys = Array.isArray(data?.deletedIds?.readLaters) ? data.deletedIds.readLaters : [];
  const deletedNoteIds = Array.isArray(data?.deletedIds?.notes) ? data.deletedIds.notes : [];
  const deletedFavoriteKeys = Array.isArray(data?.deletedIds?.favorites) ? data.deletedIds.favorites : [];

  const updates = {};

  const localReadLaters = Array.isArray(stored[READ_LATERS_NAME]) ? stored[READ_LATERS_NAME] : [];
  const nextReadLaters = mergeReadLaters(localReadLaters, data?.readLaters || [], deletedKeys);
  if (JSON.stringify(nextReadLaters) !== JSON.stringify(localReadLaters)) updates[READ_LATERS_NAME] = nextReadLaters;

  const localRecords = stored[ALL_RECORDS_NAME] && typeof stored[ALL_RECORDS_NAME] === 'object' ? stored[ALL_RECORDS_NAME] : {};
  const nextRecords = mergeAllRecords(localRecords, data?.allRecords || {});
  if (JSON.stringify(nextRecords) !== JSON.stringify(localRecords)) updates[ALL_RECORDS_NAME] = nextRecords;

  const localFavorites = Array.isArray(stored[FAVORITES_NAME]) ? stored[FAVORITES_NAME] : [];
  const nextFavorites = mergeFavorites(localFavorites, data?.favorites || [], deletedFavoriteKeys);
  if (JSON.stringify(nextFavorites) !== JSON.stringify(localFavorites)) updates[FAVORITES_NAME] = nextFavorites;

  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  await applyRemoteNotes(data?.notes || {}, deletedNoteIds);

  suppressUntil = Date.now() + APPLY_SUPPRESS_MS;
  return { readLaters: nextReadLaters.length, records: Object.keys(nextRecords).length, favorites: nextFavorites.length };
}

// force=true 时无条件上传本地全量；否则只在本地有改动时上传，避免每轮同步都写库。
export function syncNow({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const config = await getSyncConfig();
    if (!config.token) throw Object.assign(new Error('Not signed in'), { code: 'not_logged_in' });

    await setSyncState({ status: 'running' });
    try {
      let pushed = false;
      if (force || await isDirty()) {
        await push(config);
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

export async function notifyLocalChange() {
  await setDirty(true);
  scheduleSync();
}

export function isApplyingRemote() {
  return Date.now() < suppressUntil;
}

export function cancelScheduledSync() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
}
