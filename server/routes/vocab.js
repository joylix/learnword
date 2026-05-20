/**
 * Vocabulary Routes
 * GET    /api/vocab                 - List user vocab with filters
 * GET    /api/vocab/stats           - Get user vocabulary statistics
 * POST   /api/vocab/upgrade-level   - Upgrade user level
 * GET    /api/vocab/:word_id        - Get vocab detail + history
 * PUT    /api/vocab/:word_id/strangeness - Adjust strangeness
 * DELETE /api/vocab/:word_id        - Remove from user vocab
 * POST   /api/vocab/batch-delete    - Batch delete
 * POST   /api/vocab/custom          - Add custom OOV word
 * GET    /api/vocab/review          - Review list
 * GET    /api/vocab/:word_id/history - Modification history
 * PUT    /api/vocab/:word_id/set-strangeness - Directly set strangeness value
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getUserDbWithAttach } = require('../database/connection');
const { adjustStrangeness } = require('../services/strangeness');

// GET /api/vocab - List user vocab
router.get('/', (req, res, next) => {
  try {
    const { min_difficulty, max_difficulty, min_first_learned, last_reviewed_before, page = 1, limit = 50 } = req.query;
    const db = getUserDbWithAttach();

    let sql = `
      SELECT uv.*, d.lemma, d.translation, d.pos, d.phonetic_us, d.phonetic_uk
      FROM user_vocab uv
      LEFT JOIN dict.dictionary d ON uv.word_id = d.word_id
      WHERE 1=1
    `;
    const params = [];

    if (min_difficulty) { sql += ' AND uv.custom_strangeness >= ?'; params.push(parseInt(min_difficulty, 10)); }
    if (max_difficulty) { sql += ' AND uv.custom_strangeness <= ?'; params.push(parseInt(max_difficulty, 10)); }
    if (min_first_learned) { sql += ' AND uv.first_learned_at >= ?'; params.push(min_first_learned); }
    if (last_reviewed_before) { sql += ' AND uv.last_reviewed_at <= ?'; params.push(last_reviewed_before); }

    sql += ' ORDER BY uv.custom_strangeness DESC, uv.last_reviewed_at ASC';
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    sql += ` LIMIT ${parseInt(limit, 10)} OFFSET ${offset}`;

    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, data: rows, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/vocab/stats - Get user vocabulary statistics
router.get('/stats', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();

    const userLevelRow = db.prepare("SELECT value FROM config WHERE key = 'user_level'").get();
    const userLevel = userLevelRow ? parseInt(userLevelRow.value, 10) : 4;

    const onboardingRow = db.prepare("SELECT value FROM config WHERE key = 'onboarding_completed'").get();
    const onboardingCompleted = onboardingRow ? onboardingRow.value === 'true' : false;

    const strangenessCounts = {};
    for (const s of [1, 3, 5, 7, 9]) {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM user_vocab WHERE custom_strangeness = ?').get(s);
      strangenessCounts[s] = row ? row.cnt : 0;
    }

    const totalWords = Object.values(strangenessCounts).reduce((a, b) => a + b, 0);
    const masteredWords = strangenessCounts[1] || 0;

    const dictWordsRow = db.prepare('SELECT COUNT(*) as cnt FROM dict.dictionary WHERE standard_level <= ?').get(userLevel);
    const totalDictWordsAtLevel = dictWordsRow ? dictWordsRow.cnt : 0;

    const masteredAtLevelRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM user_vocab uv JOIN dict.dictionary d ON uv.word_id = d.word_id WHERE d.standard_level <= ? AND uv.custom_strangeness = 1'
    ).get(userLevel);
    const masteredAtLevel = masteredAtLevelRow ? masteredAtLevelRow.cnt : 0;

    const upgradeThreshold = 0.8;
    const canUpgrade = totalDictWordsAtLevel > 0 && (masteredAtLevel / totalDictWordsAtLevel) >= upgradeThreshold;
    const nextLevel = canUpgrade ? Math.min(userLevel + 1, 10) : null;
    const masteryPercent = totalDictWordsAtLevel > 0 ? Math.round((masteredAtLevel / totalDictWordsAtLevel) * 100) : 0;

    res.json({
      success: true,
      data: {
        userLevel, onboardingCompleted, strangenessCounts, totalWords, masteredWords,
        dictWordsAtLevel: totalDictWordsAtLevel, masteredAtLevel, masteryPercent,
        canUpgrade, nextLevel, upgradeThreshold: Math.ceil(totalDictWordsAtLevel * upgradeThreshold),
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/vocab/upgrade-level - Upgrade user level
router.post('/upgrade-level', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const userLevelRow = db.prepare("SELECT value FROM config WHERE key = 'user_level'").get();
    const currentLevel = userLevelRow ? parseInt(userLevelRow.value, 10) : 4;

    if (currentLevel >= 10) {
      const err = new Error('Already at maximum level'); err.type = 'validation'; throw err;
    }

    const dictWordsRow = db.prepare('SELECT COUNT(*) as cnt FROM dict.dictionary WHERE standard_level <= ?').get(currentLevel);
    const totalDictWords = dictWordsRow ? dictWordsRow.cnt : 0;

    const masteredRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM user_vocab uv JOIN dict.dictionary d ON uv.word_id = d.word_id WHERE d.standard_level <= ? AND uv.custom_strangeness = 1'
    ).get(currentLevel);
    const mastered = masteredRow ? masteredRow.cnt : 0;

    if (totalDictWords > 0 && (mastered / totalDictWords) < 0.8) {
      const err = new Error(`Need to master at least ${Math.ceil(totalDictWords * 0.8)} words at current level (currently ${mastered})`);
      err.type = 'validation'; throw err;
    }

    const newLevel = currentLevel + 1;
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('user_level', ?)").run(String(newLevel));

    res.json({ success: true, data: { oldLevel: currentLevel, newLevel, mastered, totalDictWords }, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/vocab/:word_id - Get vocab detail
router.get('/:word_id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const record = db.prepare(`
      SELECT uv.*, d.lemma, d.translation, d.pos, d.phonetic_us, d.phonetic_uk, d.collocations, d.example_sentences, d.standard_level
      FROM user_vocab uv
      LEFT JOIN dict.dictionary d ON uv.word_id = d.word_id
      WHERE uv.word_id = ?
    `).get(req.params.word_id);

    if (!record) {
      const err = new Error('Word not found in user vocabulary'); err.type = 'not_found'; throw err;
    }

    const history = db.prepare('SELECT * FROM modification_log WHERE word_id = ? ORDER BY timestamp DESC').all(req.params.word_id);
    res.json({ success: true, data: { ...record, history }, error: null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/vocab/:word_id/strangeness - Adjust strangeness
router.put('/:word_id/strangeness', (req, res, next) => {
  try {
    const { direction } = req.body;
    if (!direction || !['up', 'down'].includes(direction)) {
      const err = new Error('direction must be "up" or "down"'); err.type = 'validation'; throw err;
    }

    const db = getUserDbWithAttach();
    const record = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(req.params.word_id);
    if (!record) { const err = new Error('Word not found in user vocabulary'); err.type = 'not_found'; throw err; }

    const newStrangeness = adjustStrangeness(record.custom_strangeness, direction);
    if (newStrangeness === null) { const err = new Error('Cannot adjust strangeness further'); err.type = 'validation'; throw err; }

    const now = new Date().toISOString();
    const logId = uuidv4();

    const updateTx = db.transaction(() => {
      db.prepare('UPDATE user_vocab SET custom_strangeness = ?, last_reviewed_at = ?, source_type = ? WHERE word_id = ?')
        .run(newStrangeness, now, 'manual', req.params.word_id);
      db.prepare('INSERT INTO modification_log (log_id, word_id, action_type, old_strangeness, new_strangeness, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
        .run(logId, req.params.word_id, 'manual_adjust', record.custom_strangeness, newStrangeness, now);
    });
    updateTx();

    const updated = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(req.params.word_id);
    res.json({ success: true, data: { word: updated, oldStrangeness: record.custom_strangeness, newStrangeness }, error: null });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/vocab/:word_id - Remove from user vocab
router.delete('/:word_id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const record = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(req.params.word_id);
    if (!record) { const err = new Error('Word not found in user vocabulary'); err.type = 'not_found'; throw err; }

    db.prepare('DELETE FROM user_vocab WHERE word_id = ?').run(req.params.word_id);
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/vocab/batch-delete - Batch delete
router.post('/batch-delete', (req, res, next) => {
  try {
    const { word_ids } = req.body;
    if (!word_ids || !Array.isArray(word_ids)) {
      const err = new Error('word_ids array is required'); err.type = 'validation'; throw err;
    }
    const db = getUserDbWithAttach();
    const deleteTx = db.transaction(() => {
      const stmt = db.prepare('DELETE FROM user_vocab WHERE word_id = ?');
      for (const id of word_ids) { stmt.run(id); }
    });
    deleteTx();
    res.json({ success: true, data: { deleted: word_ids.length }, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/vocab/custom - Add custom OOV word
router.post('/custom', (req, res, next) => {
  try {
    const { word_id, translation, pos } = req.body;
    if (!word_id) { const err = new Error('word_id is required'); err.type = 'validation'; throw err; }

    const db = getUserDbWithAttach();
    const oovDefault = parseInt(db.prepare("SELECT value FROM config WHERE key = 'oov_default_strangeness'").get()?.value || '9', 10);
    const now = new Date().toISOString();

    db.prepare('INSERT OR REPLACE INTO user_vocab (word_id, custom_strangeness, source_type, user_doc_frequency, first_learned_at, last_reviewed_at, user_definition, user_pos, is_custom_word) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 1)')
      .run(word_id, oovDefault, 'manual', now, now, translation, pos);

    const record = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(word_id);
    res.json({ success: true, data: record, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/vocab/review - Review list
router.get('/review', (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const db = getUserDbWithAttach();

    const sql = `SELECT uv.*, d.lemma, d.translation, d.pos FROM user_vocab uv LEFT JOIN dict.dictionary d ON uv.word_id = d.word_id ORDER BY uv.last_reviewed_at ASC, uv.custom_strangeness DESC`;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const rows = db.prepare(sql + ` LIMIT ${parseInt(limit, 10)} OFFSET ${offset}`).all();
    const total = db.prepare('SELECT COUNT(*) as cnt FROM user_vocab').get().cnt;

    res.json({ success: true, data: { items: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) }, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/vocab/:word_id/history - Modification history
router.get('/:word_id/history', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const history = db.prepare('SELECT * FROM modification_log WHERE word_id = ? ORDER BY timestamp DESC').all(req.params.word_id);
    res.json({ success: true, data: history, error: null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/vocab/:word_id/set-strangeness - Directly set strangeness value
router.put('/:word_id/set-strangeness', (req, res, next) => {
  try {
    const { strangeness } = req.body;
    if (strangeness === undefined) { const err = new Error('strangeness is required'); err.type = 'validation'; throw err; }
    const target = parseInt(strangeness, 10);
    if (![1, 3, 5, 7, 9].includes(target)) { const err = new Error('strangeness must be 1, 3, 5, 7, or 9'); err.type = 'validation'; throw err; }

    const db = getUserDbWithAttach();
    const record = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(req.params.word_id);
    const now = new Date().toISOString();
    const logId = uuidv4();

    if (record) {
      const oldVal = record.custom_strangeness;
      db.prepare('UPDATE user_vocab SET custom_strangeness = ?, last_reviewed_at = ?, source_type = ? WHERE word_id = ?')
        .run(target, now, 'manual', req.params.word_id);
      db.prepare('INSERT INTO modification_log (log_id, word_id, action_type, old_strangeness, new_strangeness, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
        .run(logId, req.params.word_id, 'direct_set', oldVal, target, now);
    } else {
      db.prepare('INSERT INTO user_vocab (word_id, custom_strangeness, source_type, user_doc_frequency, first_learned_at, last_reviewed_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(req.params.word_id, target, 'manual', now, now);
      db.prepare('INSERT INTO modification_log (log_id, word_id, action_type, old_strangeness, new_strangeness, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
        .run(logId, req.params.word_id, 'direct_set', null, target, now);
    }

    const updated = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(req.params.word_id);
    res.json({ success: true, data: { word: updated, oldStrangeness: record?.custom_strangeness ?? null, newStrangeness: target }, error: null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
