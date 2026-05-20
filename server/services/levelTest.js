/**
 * Adaptive Level Test Service
 * State machine for determining user's English level.
 */

const { getUserDbWithAttach } = require('../database/connection');
const fs = require('fs');
const path = require('path');

// Load level test texts from seed data
let levelTexts = null;

function getLevelTexts() {
  if (!levelTexts) {
    const filePath = path.join(__dirname, '..', 'database', 'seed', 'level_texts.json');
    levelTexts = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return levelTexts;
}

/**
 * Level Test State Machine
 *
 * Flow:
 * - Start at level 4 (default for new users)
 * - User reads text and provides feedback: 'easy', 'hard', 'confirm', 'skip', 'cancel'
 * - 'easy' -> go up one level
 * - 'hard' -> go down one level
 * - 'confirm' -> use current level as final, mark onboarding complete
 * - 'cancel' -> abort test, keep default level 4
 * - 'skip' -> use default level 4, mark onboarding complete
 *
 * Convergence: when range narrows to 1 level, or max 6 questions asked.
 */

const sessions = new Map();

function generateSessionId() {
  return 'lt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Start a new level test session.
 * Returns { sessionId, level, text }
 */
function startTest() {
  const texts = getLevelTexts();
  const sessionId = generateSessionId();

  // Start at level 4
  const startLevel = 4;
  const textObj = texts.find(t => t.level === startLevel);

  const session = {
    sessionId,
    currentLevel: startLevel,
    minLevel: 1,
    maxLevel: 10,
    asked: 0,
    history: [],
    completed: false,
    finalLevel: null,
  };

  sessions.set(sessionId, session);

  return {
    sessionId,
    level: startLevel,
    text: textObj ? { text_id: textObj.text_id, title: textObj.title, content: textObj.content } : null,
  };
}

/**
 * Submit feedback for the current level and get next step.
 */
function submitFeedback(sessionId, level, feedback) {
  const session = sessions.get(sessionId);
  if (!session) {
    const err = new Error('Level test session not found');
    err.type = 'not_found';
    throw err;
  }

  if (session.completed) {
    const err = new Error('Level test already completed');
    err.type = 'conflict';
    throw err;
  }

  // Handle cancel
  if (feedback === 'cancel') {
    session.completed = true;
    session.finalLevel = null; // No level determined
    return {
      completed: true,
      cancelled: true,
      finalLevel: null,
      nextLevel: null,
      text: null,
    };
  }

  // Handle skip
  if (feedback === 'skip') {
    session.completed = true;
    session.finalLevel = 4;

    const db = getUserDbWithAttach();
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('user_level', ?)").run('4');
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('onboarding_completed', ?)").run('true');

    return {
      completed: true,
      cancelled: false,
      finalLevel: 4,
      nextLevel: null,
      text: null,
    };
  }

  // Handle confirm
  if (feedback === 'confirm') {
    session.completed = true;
    session.finalLevel = session.currentLevel;

    const db = getUserDbWithAttach();
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('user_level', ?)").run(String(session.currentLevel));
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('onboarding_completed', ?)").run('true');

    return {
      completed: true,
      cancelled: false,
      finalLevel: session.currentLevel,
      nextLevel: null,
      text: null,
    };
  }

  // Record history
  session.history.push({ level, feedback });
  session.asked++;

  // Adjust level based on feedback
  if (feedback === 'easy') {
    session.minLevel = Math.max(session.minLevel, level + 1);
    session.currentLevel = Math.min(level + 1, 10);
  } else if (feedback === 'hard') {
    session.maxLevel = Math.min(session.maxLevel, level - 1);
    session.currentLevel = Math.max(level - 1, 1);
  }

  // Check convergence
  const maxQuestions = 6;

  if (session.asked >= maxQuestions || session.minLevel >= session.maxLevel) {
    session.completed = true;
    session.finalLevel = Math.round((session.minLevel + session.maxLevel) / 2);
    session.currentLevel = session.finalLevel;

    const db = getUserDbWithAttach();
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('user_level', ?)").run(String(session.finalLevel));
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('onboarding_completed', ?)").run('true');

    return {
      completed: true,
      cancelled: false,
      finalLevel: session.finalLevel,
      nextLevel: null,
      text: null,
    };
  }

  // Get next text
  const texts = getLevelTexts();
  const textObj = texts.find(t => t.level === session.currentLevel);

  return {
    completed: false,
    cancelled: false,
    finalLevel: null,
    nextLevel: session.currentLevel,
    text: textObj ? { text_id: textObj.text_id, title: textObj.title, content: textObj.content } : null,
    asked: session.asked,
  };
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const timestamp = parseInt(id.split('_')[1], 10);
    if (now - timestamp > 30 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}

module.exports = {
  startTest,
  submitFeedback,
  getSession,
  cleanupSessions,
};
