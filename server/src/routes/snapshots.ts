// Snapshots Routes (页面快照上传到 R2)
import { Hono } from 'hono';
import type { Env } from '../types';
import { generateId } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const snapshots = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 获取快照列表
snapshots.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const url = c.req.query('url');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const offset = parseInt(c.req.query('offset') || '0');
    
    let query = 'SELECT * FROM snapshots WHERE user_id = ?';
    const params: any[] = [userId];
    
    if (url) {
      query += ' AND url = ?';
      params.push(url);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const result = await c.env.DB.prepare(query).bind(...params).all();

    let countQuery = 'SELECT COUNT(*) as total FROM snapshots WHERE user_id = ?';
    const countParams: any[] = [userId];
    if (url) {
      countQuery += ' AND url = ?';
      countParams.push(url);
    }
    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first();

    const snapshots = result.results?.map(row => ({
      id: row.id,
      url: row.url,
      title: row.title,
      format: row.format,
      fileSize: row.file_size,
      createdAt: row.created_at,
      downloadUrl: `${new URL(c.req.url).origin}/api/snapshots/${row.id}/download`
    })) || [];
    
    return jsonResponse({ snapshots, total: (countResult?.total as number) || 0 });
  } catch (error) {
    console.error('Get snapshots error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to fetch snapshots', 500);
  }
});

// 上传快照
snapshots.post('/upload', async (c) => {
  try {
    const userId = c.get('userId');
    const formData = await c.req.formData();

    // R2 需要在 Cloudflare 后台单独开通，未绑定时明确报错而不是让整个请求崩掉
    const bucket = c.env.R2;
    if (!bucket) {
      return errorResponse('R2_NOT_CONFIGURED', 'Snapshot storage is not configured', 501);
    }
    
    const file = formData.get('file');
    const url = formData.get('url');
    const title = formData.get('title');
    const format = formData.get('format');

    if (!file || typeof file === 'string' || typeof url !== 'string' || typeof title !== 'string' || typeof format !== 'string') {
      return errorResponse('INVALID_REQUEST', 'file, url, title and format are required', 400);
    }
    if (!['html', 'pdf', 'markdown', 'screenshot'].includes(format)) {
      return errorResponse('INVALID_REQUEST', 'Unsupported snapshot format', 400);
    }
    const upload = file as unknown as File;
    
    // 生成 R2 key
    const snapshotId = generateId();
    const r2Key = `${userId}/${snapshotId}.${format}`;
    
    // 上传到 R2
    const fileBuffer = await upload.arrayBuffer();
    await bucket.put(r2Key, fileBuffer, {
      httpMetadata: {
        contentType: upload.type
      }
    });
    
    // 保存元数据到 D1
    const now = Date.now();
    await c.env.DB.prepare(`
      INSERT INTO snapshots (id, user_id, url, title, format, r2_key, file_size, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId, userId, url, title, format, r2Key, upload.size, upload.type, now
    ).run();
    
    return jsonResponse({
      id: snapshotId,
      r2_url: `${new URL(c.req.url).origin}/api/snapshots/${snapshotId}/download`
    }, 201);
  } catch (error) {
    console.error('Upload snapshot error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to upload snapshot', 500);
  }
});

// 下载快照
snapshots.get('/:id/download', async (c) => {
  try {
    const userId = c.get('userId');
    const id = c.req.param('id');
    
    const snapshot = await c.env.DB.prepare(
      'SELECT * FROM snapshots WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first();
    
    if (!snapshot) {
      return errorResponse('NOT_FOUND', 'Snapshot not found', 404);
    }
    
    const object = await c.env.R2?.get(snapshot.r2_key as string);
    
    if (!object) {
      return errorResponse('NOT_FOUND', 'File not found in storage', 404);
    }
    
    return new Response(object.body, {
      headers: {
        'Content-Type': snapshot.mime_type as string || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${snapshot.title}.${snapshot.format}"`,
        'Content-Length': String(snapshot.file_size)
      }
    });
  } catch (error) {
    console.error('Download snapshot error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to download snapshot', 500);
  }
});

// 删除快照
snapshots.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const id = c.req.param('id');
    
    const snapshot = await c.env.DB.prepare(
      'SELECT r2_key FROM snapshots WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first();
    
    if (!snapshot) {
      return errorResponse('NOT_FOUND', 'Snapshot not found', 404);
    }
    
    // 从 R2 删除（未配置 R2 时只剩元数据，直接删库）
    await c.env.R2?.delete(snapshot.r2_key as string);
    
    // 从数据库删除
    await c.env.DB.prepare('DELETE FROM snapshots WHERE id = ? AND user_id = ?')
      .bind(id, userId).run();
    
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Delete snapshot error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to delete snapshot', 500);
  }
});

export default snapshots;
