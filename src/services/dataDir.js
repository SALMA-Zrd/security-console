const path = require('path');

// Directory for persistent JSON data (users, roles, audit, config).
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

module.exports = DATA_DIR;
