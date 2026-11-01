const p = require('puppeteer');
p.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  .then(async (b) => {
    const pg = await b.newPage();
    await pg.goto('https://example.com', { timeout: 20000 });
    const title = await pg.title();
    console.log('CHROME OK: ' + await b.version() + ' | page title: ' + title);
    await b.close();
  })
  .catch((e) => { console.error('CHROME FAIL: ' + e.message.split('\n')[0]); process.exit(1); });
