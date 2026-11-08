// Favorites Routes（收藏链接，与稍后阅读相互独立）
import { Hono } from 'hono';
import type { Env } from '../types';
import { getFavorites, upsertFavorite, deleteFavorite } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const favorites = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 获取收藏列表
favorites.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
    const offset = parseInt(c.req.query('offset') || '0');

    const result = await getFavorites(c.env.DB, userId, limit, offset);

    return jsonResponse(result);
  } catch (error) {
    console.error('Get favorites error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to fetch favorites', 500);
  }
});

// 添加收藏
favorites.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const data = await c.req.json();

    if (!data?.url) {
      return errorResponse('INVALID_REQUEST', 'url is required', 400);
    }

    const id = await upsertFavorite(c.env.DB, userId, {
      ...data,
      key: data.key || data.url,
      url: data.url
    });

    return jsonResponse({ id, created: true }, 201);
  } catch (error) {
    console.error('Create favorite error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to create favorite', 500);
  }
});

// 删除收藏
favorites.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const id = c.req.param('id');

    await deleteFavorite(c.env.DB, userId, id);

    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Delete favorite error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to delete favorite', 500);
  }
});

export default favorites;
