/**
 * Strangeness calculation service
 * Computes the "strangeness" (difficulty) level for words/phrases
 * based on user level, init mode, and user vocabulary records.
 */

const { getUserDbWithAttach } = require('../database/connection');

/**
 * Get a config value from the user database
 */
function getConfig(key) {
  const db = getUserDbWithAttach();
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Get user vocabulary record for a word_id
 */
function getUserVocab(wordId) {
  const db = getUserDbWithAttach();
  return db.prepare('SELECT * FROM user_vocab WHERE word_id = ?').get(wordId) || null;
}

/**
 * Calculate strangeness for a single word/phrase.
 *
 * @param {object} params
 * @param {string|null} params.word_id - word_id in dictionary, null for OOV
 * @param {number|null} params.standard_level - standard difficulty level (1-10)
 * @param {boolean} params.is_phrase - whether this is a phrase
 * @param {object|null} params.userVocabRecord - pre-fetched user_vocab record (optional)
 * @returns {{ strangeness: number, source: 'manual'|'null' }}
 */
function calcStrangeness({ word_id, standard_level, is_phrase = false, userVocabRecord = null }) {
  const userLevel = parseInt(getConfig('user_level') || '3', 10);
  const initMode = getConfig('init_mode') || 'strict';
  const oovDefault = parseInt(getConfig('oov_default_strangeness') || '9', 10);

  // Check user vocabulary record (manual override)
  const record = userVocabRecord !== null ? userVocabRecord : (word_id ? getUserVocab(word_id) : null);
  if (record && record.source_type === 'manual') {
    return { strangeness: record.custom_strangeness, source: 'manual' };
  }

  // OOV (Out of Vocabulary) - word not in dictionary
  if (!word_id) {
    return { strangeness: oovDefault, source: 'null' };
  }

  // Strict mode
  if (initMode === 'strict') {
    if (standard_level <= user_level) {
      return { strangeness: 1, source: 'null' };
    }
    return { strangeness: 9, source: 'null' };
  }

  // Gradient mode
  const diff = standard_level - user_level;
  if (diff <= 0) return { strangeness: 1, source: 'null' };
  if (diff === 1) return { strangeness: 5, source: 'null' };
  if (diff === 2) return { strangeness: 7, source: 'null' };
  return { strangeness: 9, source: 'null' };
}

/**
 * Batch calculate strangeness for multiple tokens.
 * Optimized to fetch config once and batch query user_vocab.
 *
 * @param {Array<{word_id: string|null, standard_level: number|null, is_phrase: boolean}>} items
 * @returns {Array<{strangeness: number, source: 'manual'|'null'}>}
 */
function batchCalcStrangeness(items) {
  const userLevel = parseInt(getConfig('user_level') || '3', 10);
  const initMode = getConfig('init_mode') || 'strict';
  const oovDefault = parseInt(getConfig('oov_default_strangeness') || '9', 10);

  // Batch fetch all user_vocab records
  const db = getUserDbWithAttach();
  const wordIds = [...new Set(items.map(i => i.word_id).filter(Boolean))];
  const vocabMap = new Map();

  if (wordIds.length > 0) {
    const placeholders = wordIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM user_vocab WHERE word_id IN (${placeholders})`).all(...wordIds);
    for (const row of rows) {
      vocabMap.set(row.word_id, row);
    }
  }

  return items.map(item => {
    const record = item.word_id ? vocabMap.get(item.word_id) : null;

    if (record && record.source_type === 'manual') {
      return { strangeness: record.custom_strangeness, source: 'manual' };
    }
    if (!item.word_id) {
      return { strangeness: oovDefault, source: 'null' };
    }
    if (initMode === 'strict') {
      return {
        strangeness: item.standard_level <= userLevel ? 1 : 9,
        source: 'null'
      };
    }
    const diff = item.standard_level - userLevel;
    if (diff <= 0) return { strangeness: 1, source: 'null' };
    if (diff === 1) return { strangeness: 5, source: 'null' };
    if (diff === 2) return { strangeness: 7, source: 'null' };
    return { strangeness: 9, source: 'null' };
  });
}

/**
 * Adjust strangeness up or down by one step.
 * Valid strangeness values: 1, 3, 5, 7, 9
 *
 * @param {number} current - current strangeness value
 * @param {'up'|'down'} direction
 * @returns {number|null} new strangeness, or null if cannot adjust
 */
function adjustStrangeness(current, direction) {
  const levels = [1, 3, 5, 7, 9];
  const idx = levels.indexOf(current);
  if (idx === -1) return null;

  if (direction === 'down' && idx > 0) return levels[idx - 1];
  if (direction === 'up' && idx < levels.length - 1) return levels[idx + 1];
  return null; // Already at boundary
}

module.exports = {
  calcStrangeness,
  batchCalcStrangeness,
  adjustStrangeness,
  getConfig,
  getUserVocab,
};
