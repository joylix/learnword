/**
 * Config Routes
 * GET /api/config - Get all config
 * PUT /api/config - Update config
 */

const express = require('express');
const router = express.Router();
const { getUserDbWithAttach } = require('../database/connection');

// GET /api/config
router.get('/', (req, res, next) => {
  try {
    const db = getUserDbWithAttach();
    const rows = db.prepare('SELECT key, value FROM config').all();

    const config = {};
    for (const row of rows) {
      // Exclude internal keys from public API
      if (row.key === 'schema_version') continue;
      config[row.key] = row.value;
    }

    res.json({ success: true, data: config, error: null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/config
router.put('/', (req, res, next) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      const err = new Error('Request body must be an object');
      err.type = 'validation';
      throw err;
    }

    const db = getUserDbWithAttach();
    const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');

    const allowedKeys = [
      'user_level', 'init_mode', 'color_blind_mode',
      'density_threshold', 'onboarding_completed',
      'oov_default_strangeness', 'color_scheme'
    ];

    const updateTx = db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (!allowedKeys.includes(key)) {
          const err = new Error(`Invalid config key: ${key}`);
          err.type = 'validation';
          throw err;
        }
        stmt.run(key, String(value));
      }
    });

    updateTx();

    // Return updated config
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const row of rows) {
      if (row.key === 'schema_version') continue;
      config[row.key] = row.value;
    }

    res.json({ success: true, data: config, error: null });
  } catch (e) {
    if (e.type) {
      next(e);
    } else {
      next(e);
    }
  }
});

module.exports = router;
