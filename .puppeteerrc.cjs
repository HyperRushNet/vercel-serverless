const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Verplaats de cache naar de huidige projectmap
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
