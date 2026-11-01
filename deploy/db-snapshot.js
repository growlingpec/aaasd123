// Целостный снимок базы SQLite без остановки Premier: node deploy/db-snapshot.js data/premier.db /tmp/snap.db
const { DatabaseSync } = require('node:sqlite');
const [src, dst] = process.argv.slice(2);
const d = new DatabaseSync(src, { readOnly: true });
d.exec("VACUUM INTO '" + dst.replace(/'/g, "''") + "'"); d.close();
