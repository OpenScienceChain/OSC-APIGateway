const fs = require('node:fs');

if (!process.env.OSC_SENTINEL_PATH) {
  throw new Error('OSC_SENTINEL_PATH is required');
}

fs.writeFileSync(process.env.OSC_SENTINEL_PATH, 'lifecycle script executed\n');
