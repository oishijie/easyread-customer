// EasyRead Sync Backend Types

export interface Env {
  DB: D1Database;
  // 可选：R2 需在 Cloudflare 后台单独开通，未开通时不绑定
  R2?: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
}

export interface User {
  id: string;
  email: string;
  created_at: number;
  updated_at: number;
}

export interface ReadLater {
  id: string;
  user_id: string;
  key: string;
  url: string;
  title: string;
  create_datetime: number;
  start_read_datetime?: number;
  end_read_datetime?: number;
  status: 0 | 1 | 2; // 0: 未读, 1: 阅读中, 2: 已读
  position?: {
    progress?: number;
    scrollX?: number;
    scrollY?: number;
  };
  synced_at: number;
}

export interface Favorite {
  id: string;
  user_id: string;
  key: string;
  url: string;
  title: string;
  create_datetime: number;
  synced_at: number;
}

export interface AllRecord {  id: string;
  user_id: string;
  url: string;
  title: string;
  datetime: number[]; // Array of timestamps
  position?: {
    progress?: number;
    scrollX?: number;
    scrollY?: number;
  };
  synced_at: number;
}

export interface NotesPage {
  id: string;
  user_id: string;
  url: string;
  title: string;
  create_datetime: number;
  synced_at: number;
}

export interface Note {
  id: string;
  page_id: string;
  user_id: string;
  note_id: string; // EasyRead original ID
  scope: 'text' | 'page';
  selection_text?: string;
  comment?: string;
  author?: string;
  prefix?: string;
  suffix?: string;
  text_position?: number;
  create_datetime: number;
  updated_at?: number;
  synced_at: number;
}

export interface Snapshot {
  id: string;
  user_id: string;
  url: string;
  title: string;
  format: 'html' | 'pdf' | 'markdown' | 'screenshot';
  r2_key: string;
  file_size: number;
  mime_type?: string;
  created_at: number;
}

export interface JWTPayload {
  user_id: string;
  exp: number;
}
