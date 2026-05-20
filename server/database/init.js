const { initDictionaryDb, initUserDb } = require('./connection');
const { migrate } = require('./migrate');

console.log('[INIT] Initializing databases...');
initDictionaryDb();
initUserDb();
migrate();
console.log('[INIT] Done.');
