/**
 * Dictionary Routes
 * POST   /api/dictionary/auto-add         - Auto-add word from user selection
 * GET    /api/dictionary/search           - Search dictionary (paginated)
 * GET    /api/dictionary/:word_id         - Get word detail
 * POST   /api/dictionary                  - Add new dictionary entry
 * PUT    /api/dictionary/:word_id         - Update dictionary entry
 * DELETE /api/dictionary/:word_id         - Delete dictionary entry
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getUserDbWithAttach } = require('../database/connection');
const { findLemma, addWordToDict } = require('../services/lemmatizer');

/**
 * Estimate standard level for an unknown word based on heuristics.
 */
function estimateStandardLevel(word) {
  const w = word.toLowerCase();
  if (w.length <= 3) return 2;
  if (w.length <= 4) return 3;

  const highLevelSuffixes = ['tion','sion','ment','ness','ity','ance','ence','ous','ive','ize','ise','ify','able','ible','al','ial','ical','phy','ogy','ics','ism','ist','dom','ship','hood'];
  for (const suffix of highLevelSuffixes) {
    if (w.endsWith(suffix) && w.length > suffix.length + 2) return 6;
  }

  const midSuffixes = ['ful','less','like','wise','ward','wards','ways','ock','ly','en'];
  for (const suffix of midSuffixes) {
    if (w.endsWith(suffix) && w.length > suffix.length + 2) return 5;
  }

  if (w.length >= 10) return 7;
  if (w.length >= 8) return 6;
  return 5;
}

// POST /api/dictionary/auto-add - Auto-add a word from user selection
router.post('/auto-add', (req, res, next) => {
  try {
    const { word, strangeness } = req.body;
    if (!word) {
      const err = new Error('word is required'); err.type = 'validation'; throw err;
    }

    const lower = word.toLowerCase();

    // Try to find lemma using the lemmatizer
    const lemmaResult = findLemma(lower);

    if (lemmaResult && lemmaResult.dictEntry) {
      // Found in dictionary (via lemma_map, direct lookup, or rule-based)
      return res.json({
        success: true,
        data: {
          word_id: lemmaResult.dictEntry.word_id,
          lemma: lemmaResult.dictEntry.lemma,
          standard_level: lemmaResult.dictEntry.standard_level,
          method: lemmaResult.method,
          already_existed: true,
        },
        error: null,
      });
    }

    // Word not in dictionary — determine best lemma to add
    let lemma;
    let method;

    if (lemmaResult) {
      // Lemmatizer found a candidate lemma (via rules) but it's not in dict
      lemma = lemmaResult.lemma;
      method = 'rule_derived';
    } else {
      // Completely unknown — use the word itself
      lemma = lower;
      method = 'raw';
    }

    // Check if this lemma already exists in dictionary
    const db = getUserDbWithAttach();
    const existing = db.prepare('SELECT * FROM dict.dictionary WHERE lemma = ? COLLATE NOCASE').get(lemma);
    if (existing) {
      return res.json({
        success: true,
        data: {
          word_id: existing.word_id,
          lemma: existing.lemma,
          standard_level: existing.standard_level,
          method: 'existing_lemma',
          already_existed: true,
        },
        error: null,
      });
    }

    // Add new entry with estimated level
    const entry = addWordToDict({ lemma, standard_level: estimateStandardLevel(lemma) });

    res.json({
      success: true,
      data: {
        word_id: entry.word_id,
        lemma: entry.lemma,
        standard_level: entry.standard_level,
        method: method,
        already_existed: false,
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/dictionary/search - Search with pagination
router.get('/search', (req, res, next) => {
  try {
    const { q = '', page = 1, limit = 30, level } = req.query;
    const db = getUserDbWithAttach();

    let sql = 'SELECT word_id, lemma, pos, translation, standard_level FROM dict.dictionary WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as cnt FROM dict.dictionary WHERE 1=1';
    const params = [];

    if (q) {
      sql += ' AND (lemma LIKE ? COLLATE NOCASE OR word_id LIKE ? COLLATE NOCASE)';
      countSql += ' AND (lemma LIKE ? COLLATE NOCASE OR word_id LIKE ? COLLATE NOCASE)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (level) {
      sql += ' AND standard_level = ?';
      countSql += ' AND standard_level = ?';
      params.push(parseInt(level, 10));
    }

    const countRow = db.prepare(countSql).get(...params);
    const total = countRow ? countRow.cnt : 0;

    sql += ' ORDER BY lemma COLLATE NOCASE';
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    sql += ` LIMIT ${parseInt(limit, 10)} OFFSET ${offset}`;

    const rows = db.prepare(sql).all(...params);

    res.json({ success: true, data: { items: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) }, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/dictionary/:word_id - Get word detail
router.get('/:word_id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();

    let row = db.prepare('SELECT word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences FROM dict.dictionary WHERE word_id = ?').get(req.params.word_id);

    if (!row) {
      row = db.prepare('SELECT word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences FROM dict.dictionary WHERE lemma = ? COLLATE NOCASE').get(req.params.word_id);
    }

    if (!row) {
      const err = new Error('Word not found in dictionary'); err.type = 'not_found'; throw err;
    }

    if (row.collocations) { try { row.collocations = JSON.parse(row.collocations); } catch (e) { /* keep raw */ } }
    if (row.example_sentences) { try { row.example_sentences = JSON.parse(row.example_sentences); } catch (e) { /* keep raw */ } }

    const userRecord = db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(row.word_id);
    if (userRecord) {
      row.user_strangeness = userRecord.custom_strangeness;
      row.user_vocab = userRecord;
    }

    res.json({ success: true, data: row, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/dictionary - Add new entry
router.post('/', (req, res, next) => {
  try {
    const { word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences } = req.body;

    if (!lemma || standard_level === undefined) {
      const err = new Error('lemma and standard_level are required'); err.type = 'validation'; throw err;
    }
    if (standard_level < 1 || standard_level > 10) {
      const err = new Error('standard_level must be between 1 and 10'); err.type = 'validation'; throw err;
    }

    const db = getUserDbWithAttach();
    const id = word_id || lemma.toLowerCase();

    const existing = db.prepare('SELECT word_id FROM dict.dictionary WHERE word_id = ?').get(id);
    if (existing) {
      const err = new Error('word_id already exists'); err.type = 'conflict'; throw err;
    }

    const collocationsStr = Array.isArray(collocations) ? JSON.stringify(collocations) : (collocations || '[]');
    const exampleSentencesStr = Array.isArray(example_sentences) ? JSON.stringify(example_sentences) : (example_sentences || '[]');

    db.prepare('INSERT INTO dict.dictionary (word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, lemma, pos || null, translation || null, phonetic_us || null, phonetic_uk || null, static_frequency || 0, standard_level, collocationsStr, exampleSentencesStr);

    const row = db.prepare('SELECT * FROM dict.dictionary WHERE word_id = ?').get(id);
    res.json({ success: true, data: row, error: null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/dictionary/:word_id - Update entry
router.put('/:word_id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();

    const existing = db.prepare('SELECT * FROM dict.dictionary WHERE word_id = ?').get(req.params.word_id);
    if (!existing) { const err = new Error('Word not found in dictionary'); err.type = 'not_found'; throw err; }

    const { lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences } = req.body;

    if (standard_level !== undefined && (standard_level < 1 || standard_level > 10)) {
      const err = new Error('standard_level must be between 1 and 10'); err.type = 'validation'; throw err;
    }

    const collocationsStr = collocations !== undefined ? (Array.isArray(collocations) ? JSON.stringify(collocations) : collocations) : existing.collocations;
    const exampleSentencesStr = example_sentences !== undefined ? (Array.isArray(example_sentences) ? JSON.stringify(example_sentences) : example_sentences) : existing.example_sentences;

    db.prepare('UPDATE dict.dictionary SET lemma = COALESCE(?, lemma), pos = COALESCE(?, pos), translation = COALESCE(?, translation), phonetic_us = COALESCE(?, phonetic_us), phonetic_uk = COALESCE(?, phonetic_uk), static_frequency = COALESCE(?, static_frequency), standard_level = COALESCE(?, standard_level), collocations = ?, example_sentences = ? WHERE word_id = ?')
      .run(lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocationsStr, exampleSentencesStr, req.params.word_id);

    const row = db.prepare('SELECT * FROM dict.dictionary WHERE word_id = ?').get(req.params.word_id);
    res.json({ success: true, data: row, error: null });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/dictionary/:word_id - Delete entry
router.delete('/:word_id', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const existing = db.prepare('SELECT * FROM dict.dictionary WHERE word_id = ?').get(req.params.word_id);
    if (!existing) { const err = new Error('Word not found in dictionary'); err.type = 'not_found'; throw err; }

    db.prepare('DELETE FROM dict.dictionary WHERE word_id = ?').run(req.params.word_id);
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
