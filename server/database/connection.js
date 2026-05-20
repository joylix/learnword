const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let _dictDb = null;
let _userDb = null;

function initDictionaryDb() {
  const dir = path.dirname(config.dictionaryDbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const exists = fs.existsSync(config.dictionaryDbPath);
  const db = new Database(config.dictionaryDbPath);
  db.pragma('journal_mode = WAL');

  if (!exists) {
    console.log('[DB] Creating dictionary.db...');
    db.exec(`
      CREATE TABLE dictionary (
        word_id TEXT PRIMARY KEY,
        lemma TEXT NOT NULL,
        pos TEXT,
        translation TEXT,
        phonetic_us TEXT,
        phonetic_uk TEXT,
        static_frequency INTEGER,
        standard_level INTEGER NOT NULL CHECK(standard_level BETWEEN 1 AND 10),
        collocations TEXT,
        example_sentences TEXT
      );
      CREATE INDEX idx_dict_lemma ON dictionary(lemma);
      CREATE INDEX idx_dict_level ON dictionary(standard_level);

      CREATE TABLE lemma_map (
        inflected_form TEXT PRIMARY KEY,
        lemma TEXT NOT NULL
      );

      CREATE TABLE common_abbreviations (
        abbr TEXT PRIMARY KEY,
        full_form TEXT
      );

      CREATE TABLE phrases (
        phrase_id TEXT PRIMARY KEY,
        phrase_text TEXT NOT NULL,
        separable INTEGER DEFAULT 0,
        max_distance INTEGER DEFAULT 0,
        members TEXT,
        pos TEXT,
        translation TEXT,
        standard_level INTEGER
      );
      CREATE INDEX idx_phrases_text ON phrases(phrase_text);
    `);
    seedDictionary(db);
  }

  return db;
}

function seedDictionary(db) {
  const seedDir = path.join(__dirname, 'seed');

  // Seed dictionary entries
  const dictData = JSON.parse(fs.readFileSync(path.join(seedDir, 'dictionary.json'), 'utf-8'));
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO dictionary (word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((entries) => {
    for (const e of entries) {
      stmt.run(e.word_id, e.lemma, e.pos, e.translation, e.phonetic_us, e.phonetic_uk, e.static_frequency, e.standard_level, e.collocations, e.example_sentences);
    }
  });
  insertMany(dictData);

  // Seed lemma_map
  const lemmaData = JSON.parse(fs.readFileSync(path.join(seedDir, 'lemma_map.json'), 'utf-8'));
  const stmt2 = db.prepare('INSERT OR REPLACE INTO lemma_map (inflected_form, lemma) VALUES (?, ?)');
  const insertLemma = db.transaction((entries) => {
    for (const e of entries) {
      stmt2.run(e.inflected_form, e.lemma);
    }
  });
  insertLemma(lemmaData);

  // Seed abbreviations
  const abbrData = JSON.parse(fs.readFileSync(path.join(seedDir, 'abbreviations.json'), 'utf-8'));
  const stmt3 = db.prepare('INSERT OR REPLACE INTO common_abbreviations (abbr, full_form) VALUES (?, ?)');
  const insertAbbr = db.transaction((entries) => {
    for (const e of entries) {
      stmt3.run(e.abbr, e.full_form);
    }
  });
  insertAbbr(abbrData);

  // Seed phrases
  const phraseData = JSON.parse(fs.readFileSync(path.join(seedDir, 'phrases.json'), 'utf-8'));
  const stmt4 = db.prepare('INSERT OR REPLACE INTO phrases (phrase_id, phrase_text, separable, max_distance, members, pos, translation, standard_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertPhrases = db.transaction((entries) => {
    for (const e of entries) {
      stmt4.run(e.phrase_id, e.phrase_text, e.separable || 0, e.max_distance || 0, e.members, e.pos, e.translation, e.standard_level);
    }
  });
  insertPhrases(phraseData);

  console.log(`[DB] Seeded: ${dictData.length} dictionary entries, ${lemmaData.length} lemma mappings, ${abbrData.length} abbreviations, ${phraseData.length} phrases`);
}

function initUserDb() {
  const dir = path.dirname(config.userdataDbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(config.userdataDbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS user_vocab (
      word_id TEXT PRIMARY KEY,
      custom_strangeness INTEGER NOT NULL CHECK(custom_strangeness IN (1,3,5,7,9)),
      source_type TEXT DEFAULT 'manual',
      user_doc_frequency INTEGER DEFAULT 0,
      first_learned_at TEXT,
      last_reviewed_at TEXT,
      user_definition TEXT,
      user_pos TEXT,
      is_custom_word INTEGER DEFAULT 0,
      mastered_at TEXT,
      ease_factor REAL,
      interval_days INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_review ON user_vocab(last_reviewed_at, custom_strangeness);
    CREATE TABLE IF NOT EXISTS articles (
      article_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      new_word_count INTEGER DEFAULT 0,
      first_study_time TEXT,
      last_study_time TEXT,
      is_completed INTEGER DEFAULT 0,
      user_difficulty_rating INTEGER,
      star_rating INTEGER,
      global_views INTEGER DEFAULT 0,
      global_avg_rating REAL,
      difficulty_score REAL,
      media_links TEXT
    );
    CREATE TABLE IF NOT EXISTS article_tags (
      tag_id TEXT PRIMARY KEY,
      tag_path TEXT NOT NULL UNIQUE,
      article_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS article_annotations (
      annotation_id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      start_char_index INTEGER NOT NULL,
      end_char_index INTEGER NOT NULL,
      selected_text TEXT,
      note_content TEXT,
      created_at TEXT,
      user_id TEXT,
      upvotes INTEGER DEFAULT 0,
      is_approved INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS modification_log (
      log_id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      old_strangeness INTEGER,
      new_strangeness INTEGER,
      timestamp TEXT NOT NULL
    );
  `);

  // Insert default config
  const defaults = {
    user_level: '3',
    init_mode: 'gradient',
    color_blind_mode: 'false',
    density_threshold: '40',
    onboarding_completed: 'false',
    oov_default_strangeness: '9',
    color_scheme: 'light',
    schema_version: '1',
  };

  const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(key, value);
  }

  return db;
}

function getDictDb() {
  if (!_dictDb) _dictDb = initDictionaryDb();
  return _dictDb;
}

function getUserDb() {
  if (!_userDb) _userDb = initUserDb();
  return _userDb;
}

function getUserDbWithAttach() {
  const userDb = getUserDb();
  // Attach dictionary db to user db connection
  try {
    userDb.exec(`ATTACH DATABASE '${config.dictionaryDbPath}' AS dict`);
  } catch (e) {
    // Already attached
  }
  return userDb;
}

module.exports = {
  initDictionaryDb,
  initUserDb,
  getDictDb,
  getUserDb,
  getUserDbWithAttach,
};
