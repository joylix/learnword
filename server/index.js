const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initDictionaryDb, initUserDb } = require('./database/connection');
const { migrate } = require('./database/migrate');
const errorHandler = require('./middleware/errorHandler');

// Initialize databases
initDictionaryDb();
initUserDb();
migrate();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static audio files
app.use('/api/audio', express.static(config.audioDir));

// API routes
app.use('/api/config', require('./routes/config'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/vocab', require('./routes/vocab'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/dictionary', require('./routes/dictionary'));
app.use('/api/export', require('./routes/export'));
app.use('/api/level-test', require('./routes/levelTest'));

// Serve client build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[SERVER] WordMaster running at http://localhost:${config.port}`);
});
