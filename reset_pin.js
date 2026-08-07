const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.run(`UPDATE users SET pin = NULL WHERE username = 'admin'`, function(err) {
    if (err) {
        console.error('Error:', err.message);
    } else {
        console.log(`✅ PIN admin berhasil direset! (${this.changes} row updated)`);
    }
    
    // Verify
    db.get(`SELECT id, username, role, pin FROM users WHERE username = 'admin'`, (err2, row) => {
        if (row) {
            console.log('Admin row:', row);
            console.log('hasPin:', !!row.pin);
        }
        db.close();
    });
});
