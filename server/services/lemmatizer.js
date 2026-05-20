/**
 * Lemmatizer Service
 * English word lemmatization with rule-based suffix stripping + irregular form lookup.
 *
 * Strategy:
 * 1. Check lemma_map (irregular forms)
 * 2. Apply rule-based suffix stripping
 * 3. Check dictionary for resulting lemma
 */

const { getUserDbWithAttach } = require('../database/connection');

// Cache for lemma map
let _lemmaMap = null;

function getLemmaMap() {
  if (!_lemmaMap) {
    const fs = require('fs');
    const path = require('path');
    const seedDir = path.join(__dirname, '..', 'database', 'seed');
    const data = JSON.parse(fs.readFileSync(path.join(seedDir, 'lemma_map.json'), 'utf-8'));
    _lemmaMap = new Map();
    for (const entry of data) {
      _lemmaMap.set(entry.inflected_form.toLowerCase(), entry.lemma);
    }
  }
  return _lemmaMap;
}

/**
 * Look up a word in the dictionary by lemma
 */
function lookupInDict(lemma) {
  const db = getUserDbWithAttach();
  return db.prepare(
    'SELECT word_id, lemma, pos, translation, phonetic_us, phonetic_uk, standard_level, collocations, example_sentences FROM dict.dictionary WHERE lemma = ? COLLATE NOCASE'
  ).get(lemma) || null;
}

/**
 * Rule-based suffix stripping for English words.
 * Returns array of candidate lemmas (most likely first).
 */
function ruleBasedStrip(word) {
  const w = word.toLowerCase();
  const candidates = [];

  // -ies → -y (e.g., carries → carry, cities → city)
  if (w.endsWith('ies') && w.length > 4) {
    candidates.push(w.slice(0, -3) + 'y');
  }

  // -ied → -y (e.g., carried → carry)
  if (w.endsWith('ied') && w.length > 4) {
    candidates.push(w.slice(0, -3) + 'y');
  }

  // -ying → -y (e.g., carrying → carry) — but also -ying → -ie (dying → die)
  if (w.endsWith('ying') && w.length > 5) {
    candidates.push(w.slice(0, -3) + 'y');
    candidates.push(w.slice(0, -3) + 'ie');
  }

  // -ing (e.g., running → run, making → make)
  if (w.endsWith('ing') && w.length > 4) {
    const base = w.slice(0, -3);
    candidates.push(base);           // making → mak (not great)
    candidates.push(base + 'e');     // making → make
    if (base.length > 2) {
      // doubled consonant: running → run
      const lastChar = base[base.length - 1];
      const secondLast = base[base.length - 2];
      if (lastChar === secondLast && !'aeiou'.includes(lastChar)) {
        candidates.push(base.slice(0, -1)); // running → run
      }
    }
  }

  // -ed (e.g., walked → walk, wanted → want)
  if (w.endsWith('ed') && w.length > 3) {
    const base = w.slice(0, -2);
    candidates.push(base);           // walked → walk
    candidates.push(base + 'e');     // hoped → hope
    if (base.length > 2) {
      const lastChar = base[base.length - 1];
      const secondLast = base[base.length - 2];
      if (lastChar === secondLast && !'aeiou'.includes(lastChar)) {
        candidates.push(base.slice(0, -1)); // stopped → stop
      }
    }
  }

  // -er (comparative: bigger → big, player → play)
  if (w.endsWith('er') && w.length > 3) {
    const base = w.slice(0, -2);
    candidates.push(base);
    candidates.push(base + 'e');
    if (base.length > 2) {
      const lastChar = base[base.length - 1];
      const secondLast = base[base.length - 2];
      if (lastChar === secondLast && !'aeiou'.includes(lastChar)) {
        candidates.push(base.slice(0, -1));
      }
    }
  }

  // -est (superlative: biggest → big)
  if (w.endsWith('est') && w.length > 4) {
    const base = w.slice(0, -3);
    candidates.push(base);
    candidates.push(base + 'e');
    if (base.length > 2) {
      const lastChar = base[base.length - 1];
      const secondLast = base[base.length - 2];
      if (lastChar === secondLast && !'aeiou'.includes(lastChar)) {
        candidates.push(base.slice(0, -1));
      }
    }
  }

  // -ly (adverb: quickly → quick, happily → happy)
  if (w.endsWith('ly') && w.length > 3) {
    const base = w.slice(0, -2);
    candidates.push(base);
    if (base.endsWith('i')) {
      candidates.push(base.slice(0, -1) + 'y'); // happily → happy
    }
  }

  // -ness (noun: happiness → happy)
  if (w.endsWith('ness') && w.length > 5) {
    const base = w.slice(0, -4);
    candidates.push(base);
    if (base.endsWith('i')) {
      candidates.push(base.slice(0, -1) + 'y');
    }
  }

  // -ment (noun: development → develop)
  if (w.endsWith('ment') && w.length > 5) {
    candidates.push(w.slice(0, -4));
  }

  // -tion/-sion (noun: action → act, decision → decide)
  if (w.endsWith('tion') && w.length > 5) {
    const base = w.slice(0, -4);
    candidates.push(base);
    candidates.push(base + 'e'); // creation → create
  }
  if (w.endsWith('sion') && w.length > 5) {
    const base = w.slice(0, -4);
    candidates.push(base);
    candidates.push(base + 'de'); // decision → decide
    candidates.push(base + 'te'); // conversion → convert
  }

  // -ity (noun: ability → able)
  if (w.endsWith('ity') && w.length > 4) {
    const base = w.slice(0, -3);
    candidates.push(base);
    candidates.push(base + 'e'); // ability → able
  }

  // -ful (adjective: beautiful → beauty — reverse is hard, skip)
  // -less (adjective: homeless → home)
  if (w.endsWith('less') && w.length > 5) {
    candidates.push(w.slice(0, -4));
  }

  // -es (boxes → box, watches → watch, buses → bus)
  if (w.endsWith('es') && w.length > 3) {
    const base = w.slice(0, -2);
    candidates.push(base);
    if (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes') || w.endsWith('zes') || w.endsWith('ses')) {
      candidates.push(w.slice(0, -1)); // buses → bus
    }
  }

  // -s (cats → cat)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2) {
    candidates.push(w.slice(0, -1));
  }

  return candidates;
}

/**
 * Try to find the lemma for a word.
 * Returns { lemma, dictEntry, method } or null.
 *
 * @param {string} word - The inflected word
 * @returns {{ lemma: string, dictEntry: object|null, method: string }|null}
 */
function findLemma(word) {
  const lower = word.toLowerCase();
  const lemmaMap = getLemmaMap();

  // Step 1: Check lemma_map (irregular forms)
  if (lemmaMap.has(lower)) {
    const lemma = lemmaMap.get(lower);
    const dictEntry = lookupInDict(lemma);
    if (dictEntry) {
      return { lemma, dictEntry, method: 'lemma_map' };
    }
  }

  // Step 2: Check dictionary directly (word might already be a lemma)
  const directEntry = lookupInDict(lower);
  if (directEntry) {
    return { lemma: lower, dictEntry: directEntry, method: 'direct' };
  }

  // Step 3: Rule-based suffix stripping
  const candidates = ruleBasedStrip(word);
  for (const candidate of candidates) {
    const dictEntry = lookupInDict(candidate);
    if (dictEntry) {
      return { lemma: candidate, dictEntry, method: 'rule' };
    }
  }

  // Step 3b: If no candidate found in dict, return the first candidate
  // with dictEntry=null (useful for auto-add to use the derived lemma)
  if (candidates.length > 0) {
    return { lemma: candidates[0], dictEntry: null, method: 'rule_nodict' };
  }

  // Step 4: Try the word itself as lemma (might be in dict with different casing)
  const selfEntry = lookupInDict(lower);
  if (selfEntry) {
    return { lemma: lower, dictEntry: selfEntry, method: 'self' };
  }

  return null;
}

/**
 * Add a new word to the dictionary.
 * Returns the created entry.
 */
function addWordToDict({ lemma, pos = null, translation = null, standard_level = 5 }) {
  const db = getUserDbWithAttach();
  const id = lemma.toLowerCase();

  const existing = db.prepare('SELECT word_id FROM dict.dictionary WHERE word_id = ?').get(id);
  if (existing) {
    return db.prepare('SELECT * FROM dict.dictionary WHERE word_id = ?').get(id);
  }

  db.prepare(
    'INSERT INTO dict.dictionary (word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, lemma, pos, translation, null, null, 0, standard_level, '[]', '[]');

  return db.prepare('SELECT * FROM dict.dictionary WHERE word_id = ?').get(id);
}

module.exports = {
  findLemma,
  addWordToDict,
  ruleBasedStrip,
  lookupInDict,
  getLemmaMap,
};
