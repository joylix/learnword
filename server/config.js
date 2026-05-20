const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  clientPort: parseInt(process.env.CLIENT_PORT, 10) || 5173,
  dataDir: path.join(__dirname, 'data'),
  dictionaryDbPath: path.join(__dirname, 'data', 'dictionary.db'),
  userdataDbPath: path.join(__dirname, 'data', 'userdata.db'),
  audioDir: path.join(__dirname, 'data', 'audio'),
  latestSchema: 1,
};
