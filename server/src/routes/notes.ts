// Notes Routes
import { Hono } from 'hono';
import type { Env } from '../types';
import { getNotesPages, getPageNotes, upsertNote, deleteNote } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/cors';

const notes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 获取所有笔记页面
notes.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
    const offset = parseInt(c.req.query('offset') || '0');
    
    const result = await getNotesPages(c.env.DB, userId, limit, offset);
    
    return jsonResponse(result);
  } catch (error) {
    console.error('Get notes pages error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to fetch notes pages', 500);
  }
});

// 获取指定页面的笔记
notes.get('/:url', async (c) => {
  try {
    const userId = c.get('userId');
    const url = decodeURIComponent(c.req.param('url'));
    
    const result = await getPageNotes(c.env.DB, userId, url);
    
    if (!result) {
      return errorResponse('NOT_FOUND', 'Page not found', 404);
    }
    
    return jsonResponse(result);
  } catch (error) {
    console.error('Get page notes error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to fetch page notes', 500);
  }
});

// 添加笔记
notes.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const { url, title, note } = await c.req.json();
    
    if (!url || !title || !note) {
      return errorResponse('INVALID_REQUEST', 'url, title and note are required', 400);
    }
    
    const id = await upsertNote(c.env.DB, userId, url, title, note);
    
    return jsonResponse({ id, created: true }, 201);
  } catch (error) {
    console.error('Create note error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to create note', 500);
  }
});

// 删除笔记
notes.delete('/:noteId', async (c) => {
  try {
    const userId = c.get('userId');
    const noteId = c.req.param('noteId');
    
    await deleteNote(c.env.DB, userId, noteId);
    
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Delete note error:', error);
    return errorResponse('SERVER_ERROR', 'Failed to delete note', 500);
  }
});

export default notes;
