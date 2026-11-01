const p = require('puppeteer');
p.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  .then(async (b) => {
    console.log('CHROME OK: ' + await b.version());
    await b.close();
  })
  .catch((e) => { console.error('CHROME FAIL FULL:\n' + e.message); process.exit(1); });
