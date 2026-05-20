/**
 * Article Routes
 * POST   /api/articles              - Import article
 * GET    /api/articles              - List articles
 * GET    /api/articles/:id          - Get article with tokenized data
 * PUT    /api/articles/:id          - Update article metadata
 * DELETE /api/articles/:id          - Delete article (cascade)
 * POST   /api/articles/batch-tag    - Batch tag articles
 * POST   /api/articles/:id/batch-review - Batch review
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getUserDbWithAttach } = require('../database/connection');
const { parseWithStrangeness } = require('../services/textParser');
const { adjustStrangeness } = require('../services/strangeness');

// POST /api/articles - Import article
router.post('/', (req, res, next) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      const err = new Error('title and content are required');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();
    const articleId = uuidv4();
    const now = new Date().toISOString();

    // Parse and tokenize
    const tokens = parseWithStrangeness(content);

    // Count new words (strangeness >= 5)
    const wordTokens = tokens.filter(t => t.is_word && t.strangeness >= 5);
    const newWordCount = new Set(wordTokens.map(t => t.word_id || t.lemma)).size;

    db.prepare(
      'INSERT INTO articles (article_id, title, content, new_word_count, first_study_time, last_study_time) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(articleId, title, content, newWordCount, now, now);

    res.json({
      success: true,
      data: { articleId, tokenized: tokens, newWordCount },
      error: null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/articles - List articles
router.get('/', (req, res, next) => {
  try {
    const { status, tag, sort = 'last_study_time', order = 'desc' } = req.query;
    const db = getUserDbWithAttach();

    let sql = 'SELECT * FROM articles WHERE 1=1';
    const params = [];

    if (status === 'completed') {
      sql += ' AND is_completed = 1';
    } else if (status === 'incomplete') {
      sql += ' AND is_completed = 0';
    }

    if (tag) {
      sql += ' AND tags LIKE ?';
      params.push(`%${tag}%`);
    }

    const allowedSorts = ['last_study_time', 'first_study_time', 'title', 'new_word_count'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'last_study_time';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    const articles = db.prepare(sql).all(...params);

    res.json({ success: true, data: articles, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/articles/:id - Get article detail with tokenized data
router.get('/:id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const article = db.prepare('SELECT * FROM articles WHERE article_id = ?').get(req.params.id);

    if (!article) {
      const err = new Error('Article not found');
      err.type = 'not_found';
      throw err;
    }

    // Re-parse with current config for up-to-date strangeness
    const tokens = parseWithStrangeness(article.content);

    // Get annotations for this article
    const annotations = db.prepare(
      'SELECT * FROM article_annotations WHERE article_id = ? ORDER BY start_char_index'
    ).all(req.params.id);

    res.json({
      success: true,
      data: { ...article, tokenized: tokens, annotations },
      error: null,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/articles/:id - Update article metadata
router.put('/:id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const article = db.prepare('SELECT * FROM articles WHERE article_id = ?').get(req.params.id);

    if (!article) {
      const err = new Error('Article not found');
      err.type = 'not_found';
      throw err;
    }

    const { title, tags, is_completed, user_difficulty_rating, star_rating, media_links } = req.body;

    const updates = [];
    const params = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (is_completed !== undefined) { updates.push('is_completed = ?'); params.push(is_completed ? 1 : 0); }
    if (user_difficulty_rating !== undefined) { updates.push('user_difficulty_rating = ?'); params.push(user_difficulty_rating); }
    if (star_rating !== undefined) { updates.push('star_rating = ?'); params.push(star_rating); }
    if (media_links !== undefined) { updates.push('media_links = ?'); params.push(media_links); }

    if (updates.length > 0) {
      updates.push('last_study_time = ?');
      params.push(new Date().toISOString());
      params.push(req.params.id);
      db.prepare(`UPDATE articles SET ${updates.join(', ')} WHERE article_id = ?`).run(...params);
    }

    // Handle tag updates
    if (tags && Array.isArray(tags)) {
      const existingTags = article.tags ? JSON.parse(article.tags) : [];
      const newTags = tags.filter(t => !existingTags.includes(t));
      const removedTags = existingTags.filter(t => !tags.includes(t));

      for (const tag of newTags) {
        const tagId = uuidv4();
        db.prepare('INSERT OR IGNORE INTO article_tags (tag_id, tag_path, article_count) VALUES (?, ?, 0)').run(tagId, tag);
        db.prepare('UPDATE article_tags SET article_count = article_count + 1 WHERE tag_path = ?').run(tag);
      }

      for (const tag of removedTags) {
        db.prepare('UPDATE article_tags SET article_count = MAX(0, article_count - 1) WHERE tag_path = ?').run(tag);
      }
    }

    const updated = db.prepare('SELECT * FROM articles WHERE article_id = ?').get(req.params.id);
    res.json({ success: true, data: updated, error: null });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/articles/:id - Delete article (cascade)
router.delete('/:id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const article = db.prepare('SELECT * FROM articles WHERE article_id = ?').get(req.params.id);

    if (!article) {
      const err = new Error('Article not found');
      err.type = 'not_found';
      throw err;
    }

    const deleteTx = db.transaction(() => {
      // Delete annotations
      db.prepare('DELETE FROM article_annotations WHERE article_id = ?').run(req.params.id);

      // Update tag counts
      if (article.tags) {
        try {
          const tags = JSON.parse(article.tags);
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              db.prepare('UPDATE article_tags SET article_count = MAX(0, article_count - 1) WHERE tag_path = ?').run(tag);
            }
          }
        } catch (e) { /* skip */ }
      }

      // Delete article
      db.prepare('DELETE FROM articles WHERE article_id = ?').run(req.params.id);
    });

    deleteTx();
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/articles/batch-tag - Batch tag articles
router.post('/batch-tag', (req, res, next) => {
  try {
    const { article_ids, add_tags, remove_tags } = req.body;
    if (!article_ids || !Array.isArray(article_ids)) {
      const err = new Error('article_ids array is required');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();
    const batchTx = db.transaction(() => {
      for (const articleId of article_ids) {
        const article = db.prepare('SELECT tags FROM articles WHERE article_id = ?').get(articleId);
        if (!article) continue;

        let tags = [];
        try { tags = JSON.parse(article.tags || '[]'); } catch (e) { tags = []; }

        if (add_tags && Array.isArray(add_tags)) {
          for (const tag of add_tags) {
            if (!tags.includes(tag)) tags.push(tag);
            const tagId = uuidv4();
            db.prepare('INSERT OR IGNORE INTO article_tags (tag_id, tag_path, article_count) VALUES (?, ?, 0)').run(tagId, tag);
            db.prepare('UPDATE article_tags SET article_count = article_count + 1 WHERE tag_path = ?').run(tag);
          }
        }

        if (remove_tags && Array.isArray(remove_tags)) {
          for (const tag of remove_tags) {
            tags = tags.filter(t => t !== tag);
            db.prepare('UPDATE article_tags SET article_count = MAX(0, article_count - 1) WHERE tag_path = ?').run(tag);
          }
        }

        db.prepare('UPDATE articles SET tags = ? WHERE article_id = ?').run(JSON.stringify(tags), articleId);
      }
    });

    batchTx();
    res.json({ success: true, data: { updated: article_ids.length }, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/articles/:id/batch-review - Batch review
router.post('/:id/batch-review', (req, res, next) => {
  try {
    const { target_strangeness, direction } = req.body;
    if (!target_strangeness || !direction) {
      const err = new Error('target_strangeness and direction are required');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();
    const article = db.prepare('SELECT * FROM articles WHERE article_id = ?').get(req.params.id);
    if (!article) {
      const err = new Error('Article not found');
      err.type = 'not_found';
      throw err;
    }

    // Parse article to get word tokens
    const tokens = parseWithStrangeness(article.content);
    const wordTokens = tokens.filter(t => t.is_word && t.strangeness == target_strangeness && t.strangeness_source === 'manual');

    const uniqueWordIds = [...new Set(wordTokens.map(t => t.word_id).filter(Boolean))];

    let modifiedCount = 0;
    const now = new Date().toISOString();
    const logId = () => uuidv4();

    const batchTx = db.transaction(() => {
      for (const wordId of uniqueWordIds) {
        const record = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(wordId);
        if (!record) continue;

        const newStrangeness = adjustStrangeness(record.custom_strangeness, direction);
        if (newStrangeness === null) continue;

        db.prepare('UPDATE user_vocab SET custom_strangeness = ?, last_reviewed_at = ?, source_type = ? WHERE word_id = ?')
          .run(newStrangeness, now, 'manual', wordId);

        db.prepare('INSERT INTO modification_log (log_id, word_id, action_type, old_strangeness, new_strangeness, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
          .run(logId(), wordId, 'batch_review', record.custom_strangeness, newStrangeness, now);

        modifiedCount++;
      }
    });

    batchTx();
    res.json({ success: true, data: { modifiedCount }, error: null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
