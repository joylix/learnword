/**
 * Text Parser Service
 * Tokenization, abbreviation detection, lemmatization, phrase matching.
 */

const { getUserDbWithAttach } = require('../database/connection');

// Word tokenization regex: matches words with hyphens and apostrophes
const WORD_REGEX = /\b[a-zA-Z]+(?:[-'][a-zA-Z]+)*\b/g;

/**
 * Load abbreviations from dictionary.db into a Map
 */
function loadAbbreviations() {
  const db = getUserDbWithAttach();
  const rows = db.prepare('SELECT abbr, full_form FROM dict.common_abbreviations').all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.abbr.toLowerCase(), row.full_form);
  }
  return map;
}

/**
 * Load lemma mappings from dictionary.db into a Map
 */
function loadLemmaMap() {
  const db = getUserDbWithAttach();
  const rows = db.prepare('SELECT inflected_form, lemma FROM dict.lemma_map').all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.inflected_form.toLowerCase(), row.lemma);
  }
  return map;
}

/**
 * Load all phrases from dictionary.db
 * Returns { contiguous: [{phrase_id, phrase_text, members, standard_level}],
 *           separable: [{phrase_id, phrase_text, members, max_distance, standard_level, verb}] }
 */
function loadPhrases() {
  const db = getUserDbWithAttach();
  const rows = db.prepare('SELECT phrase_id, phrase_text, separable, max_distance, members, standard_level FROM phrases').all();

  const contiguous = [];
  const separable = [];

  for (const row of rows) {
    const members = JSON.parse(row.members || '[]');
    if (row.separable) {
      // For separable phrases, the first member is the verb
      separable.push({
        phrase_id: row.phrase_id,
        phrase_text: row.phrase_text,
        members,
        max_distance: row.max_distance || 0,
        standard_level: row.standard_level,
        verb: members[0] ? members[0].toLowerCase() : '',
      });
    } else {
      contiguous.push({
        phrase_id: row.phrase_id,
        phrase_text: row.phrase_text,
        members,
        standard_level: row.standard_level,
      });
    }
  }

  return { contiguous, separable };
}

/**
 * Look up a word in the dictionary by its lemma
 * Returns { word_id, lemma, pos, translation, standard_level, ... } or null
 */
function lookupWord(lemma) {
  const db = getUserDbWithAttach();
  return db.prepare(
    'SELECT word_id, lemma, pos, translation, phonetic_us, phonetic_uk, static_frequency, standard_level, collocations, example_sentences FROM dict.dictionary WHERE lemma = ? COLLATE NOCASE'
  ).get(lemma) || null;
}

/**
 * Step 1: Tokenize text into word and non-word tokens.
 * Each token: { text, start_char, end_char, is_word }
 */
function tokenize(text) {
  const tokens = [];
  let match;
  let lastIndex = 0;

  WORD_REGEX.lastIndex = 0;

  while ((match = WORD_REGEX.exec(text)) !== null) {
    // Add non-word token before this word if there's a gap
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        start_char: lastIndex,
        end_char: match.index,
        is_word: false,
      });
    }

    tokens.push({
      text: match[0],
      start_char: match.index,
      end_char: match.index + match[0].length,
      is_word: true,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add trailing non-word token
  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      start_char: lastIndex,
      end_char: text.length,
      is_word: false,
    });
  }

  return tokens;
}

/**
 * Step 2: Detect abbreviations in word tokens.
 * Marks tokens with is_abbreviation and full_form.
 * Also detects parenthetical definitions like "Retrieval-Augmented Generation (RAG)".
 */
function detectAbbreviations(tokens) {
  const abbrMap = loadAbbreviations();

  // Build a map for parenthetical abbreviation detection
  const parenAbbrs = new Map(); // Maps position -> { abbr, full_form }

  // First pass: detect parenthetical definitions in the raw text
  // Pattern: "Full Name (ABBR)" - we look for this in the token stream
  const fullText = tokens.map(t => t.text).join('');
  const parenRegex = /\(([A-Z]{2,})\)/g;
  let parenMatch;
  while ((parenMatch = parenRegex.exec(fullText)) !== null) {
    const abbr = parenMatch[1];
    const parenStart = parenMatch.index;
    // Look backwards for the full form (heuristic: words before the parenthesis)
    const beforeText = fullText.slice(0, parenStart).trim();
    // Simple heuristic: take last 1-4 words as the full form
    const words = beforeText.split(/\s+/);
    const fullForm = words.slice(-4).join(' ');
    if (fullForm) {
      parenAbbrs.set(abbr.toLowerCase(), fullForm);
    }
  }

  // Second pass: mark abbreviation tokens
  for (const token of tokens) {
    if (!token.is_word) continue;

    const lower = token.text.toLowerCase();

    // Check common abbreviations table
    if (abbrMap.has(lower)) {
      token.is_abbreviation = true;
      token.full_form = abbrMap.get(lower);
      continue;
    }

    // Check parenthetical-detected abbreviations
    if (parenAbbrs.has(lower)) {
      token.is_abbreviation = true;
      token.full_form = parenAbbrs.get(lower);
      continue;
    }

    token.is_abbreviation = false;
  }

  return tokens;
}

/**
 * Step 3: Lemmatize word tokens.
 * Uses the lemmatizer service for comprehensive lemma lookup:
 *   1. lemma_map (irregular forms)
 *   2. direct dictionary lookup
 *   3. rule-based suffix stripping
 * Sets token.lemma, token.word_id, token.standard_level, token.is_oov
 */
function lemmatize(tokens) {
  const { findLemma } = require('./lemmatizer');

  for (const token of tokens) {
    if (!token.is_word) continue;

    const lower = token.text.toLowerCase();
    let lemma = lower;
    let dictEntry = null;

    // Use the lemmatizer service
    const result = findLemma(lower);
    if (result) {
      lemma = result.lemma;
      dictEntry = result.dictEntry;
    } else {
      // Fallback: try hyphenated word parts
      if (lower.includes('-')) {
        const parts = lower.split('-');
        for (const part of parts) {
          const partResult = findLemma(part);
          if (partResult) {
            lemma = partResult.lemma;
            dictEntry = partResult.dictEntry;
            break;
          }
        }
      }
    }

    token.lemma = lemma;

    if (dictEntry) {
      token.word_id = dictEntry.word_id;
      token.standard_level = dictEntry.standard_level;
      token.pos = dictEntry.pos;
      token.translation = dictEntry.translation;
      token.phonetic_us = dictEntry.phonetic_us;
      token.phonetic_uk = dictEntry.phonetic_uk;
      token.collocations = dictEntry.collocations;
      token.example_sentences = dictEntry.example_sentences;
      token.is_oov = false;
    } else {
      token.word_id = null;
      token.standard_level = null;
      token.is_oov = true;
    }
  }

  return tokens;
}

/**
 * Step 4: Phrase matching.
 * - Contiguous phrases: simple includes scan on the token stream
 * - Separable phrases: scan token stream, hit verb, search ≤5 tokens for particle
 *
 * Sets token.phrase_id, token.phrase_text, token.is_phrase_member
 */
function matchPhrases(tokens) {
  const { contiguous, separable } = loadPhrases();

  // Build contiguous phrase lookup: map from first word -> list of phrases
  const contigByFirst = new Map();
  for (const ph of contiguous) {
    const firstWord = ph.members[0] ? ph.members[0].toLowerCase() : '';
    if (!contigByFirst.has(firstWord)) contigByFirst.set(firstWord, []);
    contigByFirst.get(firstWord).push(ph);
  }

  // Build separable phrase lookup: map from verb -> list of phrases
  const separByVerb = new Map();
  for (const ph of separable) {
    if (!separByVerb.has(ph.verb)) separByVerb.set(ph.verb, []);
    separByVerb.get(ph.verb).push(ph);
  }

  // Get word tokens only for phrase matching
  const wordTokens = tokens.filter(t => t.is_word);

  // Track which token indices are already part of a phrase (for overlap resolution)
  const claimed = new Set(); // Set of wordToken indices

  // --- Contiguous phrase matching ---
  // Simple scan: for each word token, check if any contiguous phrase starts here
  const phraseMatches = []; // [{ startIdx, endIdx, phrase, length }]

  for (let i = 0; i < wordTokens.length; i++) {
    const token = wordTokens[i];
    const lower = token.text.toLowerCase();
    const candidates = contigByFirst.get(lower);
    if (!candidates) continue;

    for (const ph of candidates) {
      const memberCount = ph.members.length;
      if (i + memberCount > wordTokens.length) continue;

      // Check if all members match consecutively
      let match = true;
      for (let j = 0; j < memberCount; j++) {
        if (wordTokens[i + j].text.toLowerCase() !== ph.members[j].toLowerCase()) {
          match = false;
          break;
        }
      }

      if (match) {
        phraseMatches.push({
          startIdx: i,
          endIdx: i + memberCount - 1,
          phrase: ph,
          length: memberCount,
          type: 'contiguous',
        });
      }
    }
  }

  // --- Separable phrase matching ---
  for (let i = 0; i < wordTokens.length; i++) {
    const token = wordTokens[i];
    const lower = token.text.toLowerCase();
    const candidates = separByVerb.get(lower);
    if (!candidates) continue;

    for (const ph of candidates) {
      const maxDist = ph.max_distance || 5;
      const particle = ph.members[ph.members.length - 1].toLowerCase();

      // Search forward up to maxDist tokens for the particle
      for (let d = 1; d <= maxDist && i + d < wordTokens.length; d++) {
        if (wordTokens[i + d].text.toLowerCase() === particle) {
          phraseMatches.push({
            startIdx: i,
            endIdx: i + d,
            phrase: ph,
            length: d + 1,
            type: 'separable',
          });
          break; // First match wins for this phrase at this position
        }
      }
    }
  }

  // Sort by length descending, then by startIdx ascending for overlap resolution
  phraseMatches.sort((a, b) => b.length - a.length || a.startIdx - b.startIdx);

  // Apply non-overlapping matches (longest first)
  const applied = [];
  for (const pm of phraseMatches) {
    let overlap = false;
    for (let idx = pm.startIdx; idx <= pm.endIdx; idx++) {
      if (claimed.has(idx)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      for (let idx = pm.startIdx; idx <= pm.endIdx; idx++) {
        claimed.add(idx);
      }
      applied.push(pm);
    }
  }

  // Mark tokens with phrase info
  for (const pm of applied) {
    for (let idx = pm.startIdx; idx <= pm.endIdx; idx++) {
      wordTokens[idx].phrase_id = pm.phrase.phrase_id;
      wordTokens[idx].phrase_text = pm.phrase.phrase_text;
      wordTokens[idx].is_phrase_member = true;
      // For phrase members, use the phrase's standard_level
      if (pm.phrase.standard_level) {
        wordTokens[idx].phrase_standard_level = pm.phrase.standard_level;
      }
    }
    // Mark the first token as phrase head
    wordTokens[pm.startIdx].is_phrase_head = true;
  }

  return tokens;
}

/**
 * Full text parsing pipeline.
 * Takes raw text, returns fully annotated tokens.
 *
 * @param {string} text - Raw text content
 * @returns {Array} Fully annotated tokens
 */
function parse(text) {
  if (!text || typeof text !== 'string') return [];

  // Step 1: Tokenize
  let tokens = tokenize(text);

  // Step 2: Detect abbreviations
  tokens = detectAbbreviations(tokens);

  // Step 3: Lemmatize
  tokens = lemmatize(tokens);

  // Step 4: Match phrases
  tokens = matchPhrases(tokens);

  return tokens;
}

/**
 * Parse text and compute strangeness for each token.
 * Returns tokens enriched with strangeness info.
 *
 * @param {string} text - Raw text content
 * @returns {Array} Tokens with strangeness data
 */
function parseWithStrangeness(text) {
  const tokens = parse(text);

  // Collect word tokens for batch strangeness calculation
  const wordTokens = tokens.filter(t => t.is_word);
  const items = wordTokens.map(t => ({
    word_id: t.word_id || null,
    standard_level: t.is_phrase_member && t.phrase_standard_level
      ? t.phrase_standard_level
      : (t.standard_level || null),
    is_phrase: !!t.is_phrase_member,
  }));

  const { batchCalcStrangeness } = require('./strangeness');
  const results = batchCalcStrangeness(items);

  // Assign strangeness back to word tokens
  for (let i = 0; i < wordTokens.length; i++) {
    wordTokens[i].strangeness = results[i].strangeness;
    wordTokens[i].strangeness_source = results[i].source;
  }

  return tokens;
}

module.exports = {
  tokenize,
  detectAbbreviations,
  lemmatize,
  matchPhrases,
  parse,
  parseWithStrangeness,
  lookupWord,
  loadAbbreviations,
  loadLemmaMap,
  loadPhrases,
};
