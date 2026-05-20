const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getUserDb } = require('./connection');

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema - all tables created in init, ensure schema_version',
    up: (db) => {
      // Schema version is already set in init, this is a no-op for fresh installs
      // For existing installs that don't have schema_version, set it
      const row = db.prepare("SELECT value FROM config WHERE key = 'schema_version'").get();
      if (!row) {
        db.prepare("INSERT INTO config (key, value) VALUES ('schema_version', '1')").run();
      }
    }
  }
];

function migrate() {
  const db = getUserDb();
  const currentRow = db.prepare("SELECT value FROM config WHERE key = 'schema_version'").get();
  const currentVersion = currentRow ? parseInt(currentRow.value, 10) : 0;
  const targetVersion = config.latestSchema;

  if (currentVersion >= targetVersion) {
    console.log(`[MIGRATE] Schema is up to date (v${currentVersion})`);
    return;
  }

  console.log(`[MIGRATE] Migrating from v${currentVersion} to v${targetVersion}`);

  const applicable = MIGRATIONS.filter(m => m.version > currentVersion && m.version <= targetVersion);
  applicable.sort((a, b) => a.version - b.version);

  const migrateTx = db.transaction(() => {
    for (const migration of applicable) {
      console.log(`[MIGRATE] Applying v${migration.version}: ${migration.description}`);
      migration.up(db);
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', ?)")
        .run(String(migration.version));
    }
  });

  migrateTx();
  console.log(`[MIGRATE] Migration complete (v${targetVersion})`);
}

module.exports = { migrate };
