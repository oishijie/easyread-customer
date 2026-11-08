// 认证中间件
import { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { verifyToken } from '../lib/auth';
import { errorResponse } from '../lib/cors';

export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { userId: string } }> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('UNAUTHORIZED', 'Missing or invalid authorization header', 401);
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, c.env.JWT_SECRET);
  
  if (!payload) {
    return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
  }
  
  c.set('userId', payload.user_id);
  await next();
};
