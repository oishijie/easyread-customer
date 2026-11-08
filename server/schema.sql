-- EasyRead Sync Backend - Cloudflare D1 Database Schema
-- 基于 EasyRead 的数据结构设计

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 稍后阅读列表
CREATE TABLE IF NOT EXISTS read_laters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    create_datetime INTEGER NOT NULL,
    start_read_datetime INTEGER,
    end_read_datetime INTEGER,
    status INTEGER NOT NULL DEFAULT 0, -- 0:未读, 1:阅读中, 2:已读
    position_progress REAL,
    position_scroll_x INTEGER,
    position_scroll_y INTEGER,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_read_laters_user ON read_laters(user_id);
CREATE INDEX IF NOT EXISTS idx_read_laters_status ON read_laters(user_id, status);

-- 访问记录
CREATE TABLE IF NOT EXISTS all_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    datetime TEXT NOT NULL, -- JSON array of timestamps（对外字段名 datetimes）
    position_progress REAL,
    position_scroll_x INTEGER,
    position_scroll_y INTEGER,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_all_records_user ON all_records(user_id);
CREATE INDEX IF NOT EXISTS idx_all_records_url ON all_records(user_id, url);

-- 笔记页面
CREATE TABLE IF NOT EXISTS notes_pages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    create_datetime INTEGER NOT NULL,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_notes_pages_user ON notes_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_pages_url ON notes_pages(user_id, url);

-- 笔记内容
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    note_id TEXT NOT NULL, -- EasyRead 原始 ID
    scope TEXT NOT NULL DEFAULT 'text', -- 'text' or 'page'
    selection_text TEXT,
    comment TEXT,
    author TEXT,
    prefix TEXT,
    suffix TEXT,
    text_position INTEGER,
    create_datetime INTEGER NOT NULL,
    updated_at INTEGER,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (page_id) REFERENCES notes_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_page ON notes(page_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);

-- 页面快照（HTML/PDF/Markdown 等）
CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    format TEXT NOT NULL, -- 'html', 'pdf', 'markdown', 'screenshot'
    r2_key TEXT NOT NULL, -- R2 存储的 key
    file_size INTEGER NOT NULL,
    mime_type TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots(user_id, url);

-- 收藏链接（独立于稍后阅读）
CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    create_datetime INTEGER NOT NULL,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- 同步元数据（用于增量同步）
CREATE TABLE IF NOT EXISTS sync_metadata (
    user_id TEXT PRIMARY KEY,
    last_sync_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 删除墓碑：让其他设备拉取时能知道哪些数据已被删除
CREATE TABLE IF NOT EXISTS tombstones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    entity TEXT NOT NULL,     -- 'read_later' | 'note' | 'favorite'
    entity_key TEXT NOT NULL, -- read_later / favorite 的 key，或 note 的 note_id
    deleted_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, entity, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_tombstones_user ON tombstones(user_id, deleted_at);
