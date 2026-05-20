/**
 * Tag Routes
 * GET    /api/tags          - List all tags
 * POST   /api/tags          - Create a tag
 * PUT    /api/tags/:id      - Rename a tag (cascades to articles)
 * DELETE /api/tags/:id      - Delete a tag
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getUserDbWithAttach } = require('../database/connection');

// GET /api/tags
router.get('/', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const tags = db.prepare('SELECT * FROM article_tags ORDER BY tag_path').all();
    res.json({ success: true, data: tags, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/tags
router.post('/', (req, res, next) => {
  try {
    const { tag_path } = req.body;
    if (!tag_path) {
      const err = new Error('tag_path is required');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();
    const existing = db.prepare('SELECT * FROM article_tags WHERE tag_path = ?').get(tag_path);
    if (existing) {
      const err = new Error('Tag already exists');
      err.type = 'conflict';
      throw err;
    }

    const tagId = uuidv4();
    db.prepare('INSERT INTO article_tags (tag_id, tag_path, article_count) VALUES (?, ?, 0)').run(tagId, tag_path);

    const tag = db.prepare('SELECT * FROM article_tags WHERE tag_id = ?').get(tagId);
    res.json({ success: true, data: tag, error: null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/tags/:id - Rename tag (cascades to articles)
router.put('/:id', (req, res, next) => {
  try {
    const { tag_path } = req.body;
    if (!tag_path) {
      const err = new Error('tag_path is required');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();
    const tag = db.prepare('SELECT * FROM article_tags WHERE tag_id = ?').get(req.params.id);
    if (!tag) {
      const err = new Error('Tag not found');
      err.type = 'not_found';
      throw err;
    }

    const oldPath = tag.tag_path;

    // Check if new path already exists
    const existing = db.prepare('SELECT * FROM article_tags WHERE tag_path = ? AND tag_id != ?').get(tag_path, req.params.id);
    if (existing) {
      const err = new Error('Tag path already in use');
      err.type = 'conflict';
      throw err;
    }

    const updateTx = db.transaction(() => {
      // Update tag
      db.prepare('UPDATE article_tags SET tag_path = ? WHERE tag_id = ?').run(tag_path, req.params.id);

      // Cascade: update all articles that reference the old tag
      const articles = db.prepare("SELECT article_id, tags FROM articles WHERE tags IS NOT NULL AND tags != '[]'").all();
      for (const article of articles) {
        try {
          const tags = JSON.parse(article.tags);
          if (Array.isArray(tags) && tags.includes(oldPath)) {
            const newTags = tags.map(t => t === oldPath ? tag_path : t);
            db.prepare('UPDATE articles SET tags = ? WHERE article_id = ?').run(JSON.stringify(newTags), article.article_id);
          }
        } catch (e) { /* skip */ }
      }
    });

    updateTx();

    const updated = db.prepare('SELECT * FROM article_tags WHERE tag_id = ?').get(req.params.id);
    res.json({ success: true, data: updated, error: null });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/tags/:id
router.delete('/:id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const tag = db.prepare('SELECT * FROM article_tags WHERE tag_id = ?').get(req.params.id);
    if (!tag) {
      const err = new Error('Tag not found');
      err.type = 'not_found';
      throw err;
    }

    const deleteTx = db.transaction(() => {
      // Remove tag from articles
      const articles = db.prepare("SELECT article_id, tags FROM articles WHERE tags IS NOT NULL AND tags != '[]'").all();
      for (const article of articles) {
        try {
          const tags = JSON.parse(article.tags);
          if (Array.isArray(tags) && tags.includes(tag.tag_path)) {
            const newTags = tags.filter(t => t !== tag.tag_path);
            db.prepare('UPDATE articles SET tags = ? WHERE article_id = ?').run(JSON.stringify(newTags), article.article_id);
          }
        } catch (e) { /* skip */ }
      }

      // Delete tag
      db.prepare('DELETE FROM article_tags WHERE tag_id = ?').run(req.params.id);
    });

    deleteTx();
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
