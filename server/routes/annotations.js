/**
 * Annotation Routes
 * GET    /api/articles/:id/annotations - List annotations for article
 * POST   /api/articles/:id/annotations - Create annotation
 * PUT    /api/annotations/:id           - Update annotation
 * DELETE /api/annotations/:id           - Delete annotation
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getUserDbWithAttach } = require('../database/connection');

// GET /api/articles/:id/annotations
router.get('/articles/:id/annotations', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const annotations = db.prepare(
      'SELECT * FROM article_annotations WHERE article_id = ? ORDER BY start_char_index'
    ).all(req.params.id);

    res.json({ success: true, data: annotations, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/articles/:id/annotations
router.post('/articles/:id/annotations', (req, res, next) => {
  try {
    const { start_char_index, end_char_index, note_content } = req.body;
    if (start_char_index === undefined || end_char_index === undefined) {
      const err = new Error('start_char_index and end_char_index are required');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();

    // Verify article exists
    const article = db.prepare('SELECT * FROM articles WHERE article_id = ?').get(req.params.id);
    if (!article) {
      const err = new Error('Article not found');
      err.type = 'not_found';
      throw err;
    }

    const annotationId = uuidv4();
    const now = new Date().toISOString();
    const selectedText = article.content.slice(start_char_index, end_char_index);

    db.prepare(
      'INSERT INTO article_annotations (annotation_id, article_id, start_char_index, end_char_index, selected_text, note_content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(annotationId, req.params.id, start_char_index, end_char_index, selectedText, note_content || '', now);

    const annotation = db.prepare('SELECT * FROM article_annotations WHERE annotation_id = ?').get(annotationId);
    res.json({ success: true, data: annotation, error: null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/annotations/:id
router.put('/annotations/:id', (req, res, next) => {
  try {
    const { note_content } = req.body;
    const db = getUserDbWithAttach();

    const annotation = db.prepare('SELECT * FROM article_annotations WHERE annotation_id = ?').get(req.params.id);
    if (!annotation) {
      const err = new Error('Annotation not found');
      err.type = 'not_found';
      throw err;
    }

    db.prepare('UPDATE article_annotations SET note_content = ? WHERE annotation_id = ?').run(note_content || '', req.params.id);

    const updated = db.prepare('SELECT * FROM article_annotations WHERE annotation_id = ?').get(req.params.id);
    res.json({ success: true, data: updated, error: null });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/annotations/:id
router.delete('/annotations/:id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const annotation = db.prepare('SELECT * FROM article_annotations WHERE annotation_id = ?').get(req.params.id);

    if (!annotation) {
      const err = new Error('Annotation not found');
      err.type = 'not_found';
      throw err;
    }

    db.prepare('DELETE FROM article_annotations WHERE annotation_id = ?').run(req.params.id);
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
