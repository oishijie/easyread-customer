// EasyRead Sync Backend - Main Entry
import { Hono } from 'hono';
import type { Env } from './types';
import { authMiddleware } from './middleware/auth';
import { corsHeaders, jsonResponse } from './lib/cors';
import dashboardHtml from './web/index.html';

// Routes
import auth from './routes/auth';
import readLater from './routes/read-later';
import notes from './routes/notes';
import records from './routes/records';
import favorites from './routes/favorites';
import sync from './routes/sync';
import snapshots from './routes/snapshots';

const app = new Hono<{ Bindings: Env }>();

// CORS 中间件
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '*';

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(c.env.CORS_ORIGIN || origin)
    });
  }

  await next();

  Object.entries(corsHeaders(c.env.CORS_ORIGIN || origin)).forEach(([key, value]) => {
    c.res.headers.set(key, value);
  });
});

// Web Dashboard（部署后直接在网址打开）
app.get('/', (c) => c.html(dashboardHtml));

// API 索引
app.get('/api', (c) => {
  return jsonResponse({
    name: 'EasyRead Sync API',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      auth: '/api/auth/login, /api/auth/register',
      readLater: '/api/read-later',
      notes: '/api/notes',
      records: '/api/records',
      favorites: '/api/favorites',
      snapshots: '/api/snapshots',
      sync: '/api/sync/full, /api/sync/pull'
    }
  });
});

app.get('/health', (c) => jsonResponse({ status: 'ok' }));

// 公开路由（无需认证）
app.route('/api/auth', auth);

// 需要认证的路由
app.use('/api/*', authMiddleware);
app.route('/api/read-later', readLater);
app.route('/api/notes', notes);
app.route('/api/records', records);
app.route('/api/favorites', favorites);
app.route('/api/sync', sync);
app.route('/api/snapshots', snapshots);

app.notFound((c) => jsonResponse({ error: 'NOT_FOUND', message: 'Endpoint not found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Internal server error' }, 500);
});

export default app;
