/**
 * Level Test Routes
 * POST /api/level-test/start    - Start a new level test
 * POST /api/level-test/feedback - Submit feedback
 * GET  /api/level-test/status   - Get current test status
 */

const express = require('express');
const router = express.Router();
const { startTest, submitFeedback, getSession } = require('../services/levelTest');

// POST /api/level-test/start
router.post('/start', (req, res, next) => {
  try {
    const result = startTest();
    res.json({ success: true, data: result, error: null });
  } catch (e) {
    next(e);
  }
});

// POST /api/level-test/feedback
router.post('/feedback', (req, res, next) => {
  try {
    const { sessionId, level, feedback } = req.body;
    if (!sessionId || level === undefined || !feedback) {
      const err = new Error('sessionId, level, and feedback are required');
      err.type = 'validation';
      throw err;
    }

    const result = submitFeedback(sessionId, level, feedback);
    res.json({ success: true, data: result, error: null });
  } catch (e) {
    next(e);
  }
});

// GET /api/level-test/status/:sessionId
router.get('/status/:sessionId', (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId);
    if (!session) {
      const err = new Error('Session not found');
      err.type = 'not_found';
      throw err;
    }
    res.json({ success: true, data: session, error: null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
