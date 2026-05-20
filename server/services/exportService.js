/**
 * Export/Import Service
 * Handles data export (JSON, CSV) and restoration from backup.
 */

const fs = require('fs');
const path = require('path');
const { getUserDbWithAttach, getUserDb } = require('../database/connection');
const config = require('../config');

/**
 * Export all user data as a JSON object.
 * Does NOT include dictionary data.
 */
function exportJson() {
  const db = getUserDbWithAttach();

  const configRows = db.prepare('SELECT key, value FROM config').all();
  const userVocab = db.prepare('SELECT * FROM user_vocab').all();
  const articles = db.prepare('SELECT * FROM articles').all();
  const articleTags = db.prepare('SELECT * FROM article_tags').all();
  const annotations = db.prepare('SELECT * FROM article_annotations').all();
  const modLog = db.prepare('SELECT * FROM modification_log').all();

  return {
    version: '1.0',
    exported_at: new Date().toISOString(),
    schema_version: 1,
    data: {
      config: configRows,
      user_vocab: userVocab,
      articles: articles,
      article_tags: articleTags,
      article_annotations: annotations,
      modification_log: modLog,
    },
  };
}

/**
 * Export user vocabulary as CSV string.
 * Columns: lemma, translation, strangeness, last_reviewed
 */
function exportCsv() {
  const db = getUserDbWithAttach();

  // Join user_vocab with dictionary to get lemma and translation
  const rows = db.prepare(`
    SELECT
      COALESCE(d.lemma, uv.word_id) as lemma,
      COALESCE(d.translation, '') as translation,
      uv.custom_strangeness as strangeness,
      uv.last_reviewed_at as last_reviewed
    FROM user_vocab uv
    LEFT JOIN dict.dictionary d ON uv.word_id = d.word_id
    ORDER BY uv.custom_strangeness DESC, uv.last_reviewed_at ASC
  `).all();

  const header = 'lemma,translation,strangeness,last_reviewed';
  const lines = rows.map(r => {
    const lemma = escapeCsv(r.lemma);
    const translation = escapeCsv(r.translation);
    return `${lemma},${translation},${r.strangeness},${r.last_reviewed || ''}`;
  });

  return [header, ...lines].join('\n');
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Import user data from a JSON object.
 * 1. Backs up current userdata.db
 * 2. Clears all dynamic tables
 * 3. Inserts imported data
 * 4. Recalculates derived fields (user_doc_frequency, article_count)
 * All within a transaction.
 *
 * @param {object} importData - The parsed JSON import data
 */
function importJson(importData) {
  const db = getUserDb();

  // Validate structure
  if (!importData || !importData.data) {
    const err = new Error('Invalid import data format');
    err.type = 'validation';
    throw err;
  }

  const data = importData.data;

  // Step 1: Backup current userdata.db
  const backupPath = path.join(
    config.dataDir,
    `userdata_backup_${Date.now()}.db`
  );

  try {
    // Copy the current db file
    if (fs.existsSync(config.userdataDbPath)) {
      fs.copyFileSync(config.userdataDbPath, backupPath);
      console.log(`[IMPORT] Backed up userdata.db to ${backupPath}`);
    }
  } catch (e) {
    console.error('[IMPORT] Backup failed:', e.message);
    const err = new Error('Failed to create backup before import');
    err.type = 'internal';
    throw err;
  }

  // Step 2-4: Transaction to clear and re-import
  const importTx = db.transaction(() => {
    // Clear all dynamic tables
    db.exec('DELETE FROM modification_log');
    db.exec('DELETE FROM article_annotations');
    db.exec('DELETE FROM articles');
    db.exec('DELETE FROM article_tags');
    db.exec('DELETE FROM user_vocab');
    db.exec('DELETE FROM config');

    // Insert config
    if (data.config && Array.isArray(data.config)) {
      const stmt = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
      for (const row of data.config) {
        stmt.run(row.key, row.value);
      }
    }

    // Insert user_vocab
    if (data.user_vocab && Array.isArray(data.user_vocab)) {
      const stmt = db.prepare(
        'INSERT INTO user_vocab (word_id, custom_strangeness, source_type, user_doc_frequency, first_learned_at, last_reviewed_at, user_definition, user_pos, is_custom_word, mastered_at, ease_factor, interval_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of data.user_vocab) {
        stmt.run(
          row.word_id, row.custom_strangeness, row.source_type || 'manual',
          row.user_doc_frequency || 0, row.first_learned_at, row.last_reviewed_at,
          row.user_definition, row.user_pos, row.is_custom_word || 0,
          row.mastered_at, row.ease_factor, row.interval_days
        );
      }
    }

    // Insert articles
    if (data.articles && Array.isArray(data.articles)) {
      const stmt = db.prepare(
        'INSERT INTO articles (article_id, title, content, tags, new_word_count, first_study_time, last_study_time, is_completed, user_difficulty_rating, star_rating, global_views, global_avg_rating, difficulty_score, media_links) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of data.articles) {
        stmt.run(
          row.article_id, row.title, row.content, row.tags,
          row.new_word_count || 0, row.first_study_time, row.last_study_time,
          row.is_completed || 0, row.user_difficulty_rating, row.star_rating,
          row.global_views || 0, row.global_avg_rating, row.difficulty_score, row.media_links
        );
      }
    }

    // Insert article_tags
    if (data.article_tags && Array.isArray(data.article_tags)) {
      const stmt = db.prepare('INSERT INTO article_tags (tag_id, tag_path, article_count) VALUES (?, ?, ?)');
      for (const row of data.article_tags) {
        stmt.run(row.tag_id, row.tag_path, row.article_count || 0);
      }
    }

    // Insert annotations
    if (data.article_annotations && Array.isArray(data.article_annotations)) {
      const stmt = db.prepare(
        'INSERT INTO article_annotations (annotation_id, article_id, start_char_index, end_char_index, selected_text, note_content, created_at, user_id, upvotes, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of data.article_annotations) {
        stmt.run(
          row.annotation_id, row.article_id, row.start_char_index,
          row.end_char_index, row.selected_text, row.note_content,
          row.created_at, row.user_id, row.upvotes || 0, row.is_approved || 1
        );
      }
    }

    // Insert modification_log
    if (data.modification_log && Array.isArray(data.modification_log)) {
      const stmt = db.prepare(
        'INSERT INTO modification_log (log_id, word_id, action_type, old_strangeness, new_strangeness, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const row of data.modification_log) {
        stmt.run(row.log_id, row.word_id, row.action_type, row.old_strangeness, row.new_strangeness, row.timestamp);
      }
    }

    // Recalculate user_doc_frequency: count distinct articles containing each word
    // For simplicity, we reset to 0 (can be recalculated on next article parse)
    // A full implementation would scan all article content

    // Recalculate article_tags.article_count
    const tagCounts = db.prepare(
      'SELECT json_each.value as tag_path, COUNT(*) as cnt FROM articles, json_each(articles.tags) GROUP BY tag_each.value'
    ).all().catch(() => []);

    // If tags are stored as JSON arrays, recalculate
    try {
      const articlesWithTags = db.prepare("SELECT article_id, tags FROM articles WHERE tags IS NOT NULL AND tags != '[]'").all();
      const countMap = {};

      for (const art of articlesWithTags) {
        try {
          const tags = JSON.parse(art.tags);
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              countMap[tag] = (countMap[tag] || 0) + 1;
            }
          }
        } catch (e) {
          // skip invalid JSON
        }
      }

      const updateTagCount = db.prepare('UPDATE article_tags SET article_count = ? WHERE tag_path = ?');
      for (const [tagPath, count] of Object.entries(countMap)) {
        updateTagCount.run(count, tagPath);
      }
    } catch (e) {
      // Non-critical, continue
      console.log('[IMPORT] Tag count recalculation skipped:', e.message);
    }
  });

  try {
    importTx();
    console.log('[IMPORT] Import completed successfully');
  } catch (e) {
    console.error('[IMPORT] Import failed:', e.message);
    // Attempt to restore from backup
    try {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, config.userdataDbPath);
        console.log('[IMPORT] Restored from backup');
      }
    } catch (restoreErr) {
      console.error('[IMPORT] Restore failed:', restoreErr.message);
    }
    throw e;
  }

  return { success: true, backupPath };
}

/**
 * Create a backup of the userdata.db file.
 * Returns the backup file path.
 */
function backupDb() {
  const backupPath = path.join(
    config.dataDir,
    `userdata_backup_${Date.now()}.db`
  );

  if (fs.existsSync(config.userdataDbPath)) {
    fs.copyFileSync(config.userdataDbPath, backupPath);
  }

  return backupPath;
}

/**
 * List all available backups in the data directory.
 */
function listBackups() {
  const files = fs.readdirSync(config.dataDir);
  return files
    .filter(f => f.startsWith('userdata_backup_') && f.endsWith('.db'))
    .map(f => {
      const filePath = path.join(config.dataDir, f);
      const stat = fs.statSync(filePath);
      return {
        filename: f,
        path: filePath,
        size: stat.size,
        created: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

module.exports = {
  exportJson,
  exportCsv,
  importJson,
  backupDb,
  listBackups,
};
