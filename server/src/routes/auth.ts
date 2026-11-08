// Auth Routes
import { Hono } from 'hono';
import type { Env } from '../types';
import { generateToken, hashPassword, verifyPassword } from '../lib/auth';
import { generateId } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const auth = new Hono<{ Bindings: Env }>();

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// 只做边界校验，不追求 RFC 完备
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 注册
auth.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return errorResponse('INVALID_REQUEST', 'Email and password required', 400);
    }
    if (!EMAIL_PATTERN.test(email)) {
      return errorResponse('INVALID_REQUEST', 'Enter a valid email address', 400);
    }
    if (password.length < 8) {
      return errorResponse('INVALID_REQUEST', 'Password must be at least 8 characters', 400);
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email).first();

    if (existing) {
      return errorResponse('CONFLICT', 'User already exists', 409);
    }

    const userId = generateId();
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(userId, email, passwordHash, now, now).run();

    const token = await generateToken(userId, c.env.JWT_SECRET);

    return jsonResponse({ token, user_id: userId }, 201);
  } catch (error) {
    console.error('Register error:', error);
    return errorResponse('SERVER_ERROR', 'Registration failed', 500);
  }
});

// 登录
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return errorResponse('INVALID_REQUEST', 'Email and password required', 400);
    }

    const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .bind(email).first();

    // 用户不存在与密码错误返回同一响应，避免账号枚举
    const valid = user ? await verifyPassword(password, user.password_hash as string) : false;
    if (!valid) {
      return errorResponse('UNAUTHORIZED', 'Invalid credentials', 401);
    }

    const token = await generateToken(user!.id as string, c.env.JWT_SECRET);
    return jsonResponse({ token, user_id: user!.id });
  } catch (error) {
    console.error('Login error:', error);
    return errorResponse('SERVER_ERROR', 'Login failed', 500);
  }
});

export default auth;
