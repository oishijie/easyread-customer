// Read Later Routes
import { Hono } from 'hono';
import type { Env } from '../types';
import { getReadLaters, upsertReadLater, updateReadLater, deleteReadLater } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const readLater = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 获取稍后阅读列表
readLater.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const status = c.req.query('status') ? parseInt(c.req.query('status')!) : undefined;
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
    const offset = parseInt(c.req.query('offset') || '0');
    
    const result = await getReadLaters(c.env.DB, userId, status, limit, offset);
    
    return jsonResponse(result);
  } catch (error) {
    console.error('Get read laters error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to fetch read laters', 500);
  }
});

// 添加稍后阅读
readLater.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const data = await c.req.json();
    
    if (!data.key || !data.url || !data.title) {
      return errorResponse('INVALID_REQUEST', 'key, url and title are required', 400);
    }
    
    const id = await upsertReadLater(c.env.DB, userId, data);
    
    return jsonResponse({ id, created: true }, 201);
  } catch (error) {
    console.error('Create read later error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to create read later', 500);
  }
});

// 更新稍后阅读
readLater.put('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const id = c.req.param('id');
    const data = await c.req.json();
    
    await updateReadLater(c.env.DB, userId, id, data);
    
    return jsonResponse({ updated: true });
  } catch (error) {
    console.error('Update read later error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to update read later', 500);
  }
});

// 删除稍后阅读
readLater.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const id = c.req.param('id');
    
    await deleteReadLater(c.env.DB, userId, id);
    
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Delete read later error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to delete read later', 500);
  }
});

export default readLater;
