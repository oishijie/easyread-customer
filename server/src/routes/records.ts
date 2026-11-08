// Records Routes (访问记录)
import { Hono } from 'hono';
import type { Env } from '../types';
import { syncAllRecords } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const records = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 获取访问记录
records.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
    const offset = parseInt(c.req.query('offset') || '0');
    
    const result = await c.env.DB.prepare(`
      SELECT url, title, datetime FROM all_records 
      WHERE user_id = ?
      ORDER BY synced_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();
    
    const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM all_records WHERE user_id = ?')
      .bind(userId).first();
    
    const records = result.results?.map(row => {
      const datetimes = JSON.parse((row.datetime as string) || '[]');
      return {
        url: row.url,
        title: row.title,
        datetimes,
        visitCount: datetimes.length
      };
    }) || [];
    
    return jsonResponse({
      records,
      total: countResult?.total || 0
    });
  } catch (error) {
    console.error('Get records error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to fetch records', 500);
  }
});

// 批量同步访问记录
records.post('/sync', async (c) => {
  try {
    const userId = c.get('userId');
    const { records } = await c.req.json();
    
    if (!records || typeof records !== 'object') {
      return errorResponse('INVALID_REQUEST', 'records object required', 400);
    }
    
    const synced = await syncAllRecords(c.env.DB, userId, records);
    
    return jsonResponse({ synced });
  } catch (error) {
    console.error('Sync records error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to sync records', 500);
  }
});

export default records;
