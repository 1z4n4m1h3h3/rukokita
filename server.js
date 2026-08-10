require('dotenv').config();
const express = require("express");
// Menggunakan @libsql/sqlite3 sebagai drop-in replacement untuk mendukung Turso Cloud,
// jika berjalan di Vercel atau environment TURSO_DATABASE_URL di-set.
const sqlite3 = require(process.env.TURSO_DATABASE_URL ? "@libsql/sqlite3" : "sqlite3").verbose();
const { put } = require("@vercel/blob"); // Tambahan untuk upload logo ke Vercel Blob
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt"); // 🔥 Tambahan untuk keamanan password
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const app = express();
const SALT_ROUNDS = 10; // Standar enkripsi bcrypt
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_123";

/* =========================
MIDDLEWARE
========================= */
app.set('trust proxy', 1); // Wajib untuk Vercel & express-rate-limit
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, "Public")));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: "Terlalu banyak percobaan login, coba lagi dalam 15 menit!" }
});

const pinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: "Terlalu banyak percobaan PIN, coba lagi nanti!" }
});

/* =========================
DATABASE CONNECTION
========================= */
let dbPath = process.env.TURSO_DATABASE_URL || "database.db";
if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    dbPath = `${process.env.TURSO_DATABASE_URL}?authToken=${process.env.TURSO_AUTH_TOKEN}`;
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("❌ Gagal terhubung ke database:", err.message);
    } else {
        console.log(`💾 Terhubung ke database: ${dbPath.includes("libsql") ? "Turso Cloud" : "Lokal (database.db)"}`);
    }
});

/* =========================
INITIALIZE TABLES (SERIALIZED)
========================= */
db.serialize(() => {

    // 1. Tabel Stock & Otomatisasi Kolom
    db.run(`
        CREATE TABLE IF NOT EXISTS stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT,
            kategori TEXT,
            masuk INTEGER DEFAULT 0,
            keluar INTEGER DEFAULT 0,
            oleh TEXT DEFAULT 'admin'
        )
    `, (err) => {
        if (!err) {
            // Cek apakah kolom 'oleh' perlu disuntik (untuk versi DB lama)
            db.run(`ALTER TABLE stock ADD COLUMN oleh TEXT`, (alterErr) => {
                if (!alterErr) console.log("🚀 Kolom 'oleh' berhasil disuntikkan!");
            });
        }
    });

    // 2. Tabel Users + Enkripsi Password Default + PIN Column
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'user',
            pin TEXT DEFAULT NULL
        )
    `, async (err) => {
        if (!err) {
            // Migrasi: tambah kolom PIN untuk database lama
            db.run(`ALTER TABLE users ADD COLUMN pin TEXT DEFAULT NULL`, (alterErr) => {
                if (!alterErr) console.log("🔐 Kolom PIN berhasil ditambahkan!");
            });

            // Migrasi: Upgrade akun 'admin' default menjadi 'superadmin'
            db.run(`UPDATE users SET role = 'superadmin' WHERE username = 'admin' AND role = 'admin'`, function (err) {
                if (!err && this.changes > 0) console.log("👑 Akun 'admin' berhasil di-upgrade menjadi Super Admin!");
            });

            db.get(`SELECT id FROM users WHERE username = ?`, ["admin"], async (searchErr, row) => {
                if (!row && !searchErr) {
                    const hashedPassword = await bcrypt.hash("admin123", SALT_ROUNDS);
                    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
                        ["admin", hashedPassword, "superadmin"],
                        (insErr) => {
                            if (!insErr) console.log("🔑 Akun Super Admin Siap -> User: admin | Pass: admin123");
                        }
                    );
                }
            });
        }
    });

    // 3. Tabel Settings Harga (Diperbarui untuk mendukung LPG & Aqua Galon)
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            id TEXT PRIMARY KEY,
            modalWarung INTEGER DEFAULT 16000,
            jualWarung INTEGER DEFAULT 18000,
            modalEcer INTEGER DEFAULT 16000,
            jualEcer INTEGER DEFAULT 19000,
            modalAquaWarung INTEGER DEFAULT 14000,
            jualAquaWarung INTEGER DEFAULT 16000,
            modalAquaEcer INTEGER DEFAULT 15000,
            jualAquaEcer INTEGER DEFAULT 18000
        )
    `, (err) => {
        if (!err) {
            // Suntik kolom Aqua jika database lama belum memilikinya
            db.run(`ALTER TABLE settings ADD COLUMN modalAquaWarung INTEGER DEFAULT 14000`, (alterErr) => { });
            db.run(`ALTER TABLE settings ADD COLUMN jualAquaWarung INTEGER DEFAULT 16000`, (alterErr) => { });
            db.run(`ALTER TABLE settings ADD COLUMN modalAquaEcer INTEGER DEFAULT 15000`, (alterErr) => { });
            db.run(`ALTER TABLE settings ADD COLUMN jualAquaEcer INTEGER DEFAULT 18000`, (alterErr) => { });

            db.run(`
                INSERT OR IGNORE INTO settings (
                    id, modalWarung, jualWarung, modalEcer, jualEcer, 
                    modalAquaWarung, jualAquaWarung, modalAquaEcer, jualAquaEcer
                ) 
                VALUES ('config_harga', 16000, 18000, 16000, 19000, 14000, 16000, 15000, 18000)
            `, (insErr) => {
                if (!insErr) console.log("⚙️ Database Setting Harga LPG & Aqua Siap!");
            });
        }
    });

    // 4. Tabel Logs Aktivitas
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            waktu TEXT DEFAULT (datetime('now', 'localtime')),
            eksekutor TEXT NOT NULL,
            tipe_aksi TEXT NOT NULL,
            deskripsi TEXT NOT NULL
        )
    `, (err) => {
        if (!err) console.log("📝 Database Log Aktivitas Siap! ✅");
    });

    // 5. Tabel Pengeluaran (Expenses)
    db.run(`
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            kategori TEXT NOT NULL,
            jumlah INTEGER NOT NULL DEFAULT 0,
            keterangan TEXT,
            oleh TEXT DEFAULT 'admin'
        )
    `, (err) => {
        if (!err) console.log("💸 Database Pengeluaran Siap! ✅");
    });
});

/* ==========================================
   FUNGSI HELPER: LOG LOGGER & JWT
========================================== */
function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ success: false, message: "Akses Ditolak! Token tidak ditemukan." });

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, message: "Format token salah!" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: "Token tidak valid atau sudah kadaluarsa!" });
        req.user = decoded; // { id, username, role }
        next();
    });
}

function catatLog(eksekutor, tipe_aksi, deskripsi) {
    const query = `INSERT INTO logs (eksekutor, tipe_aksi, deskripsi) VALUES (?, ?, ?)`;
    db.run(query, [eksekutor, tipe_aksi, deskripsi], (err) => {
        if (err) console.error("❌ Gagal mencatat log:", err.message);
    });
}

/* ==========================================
   API ENDPOINTS: LOGS & SETTINGS (PROTECTED)
========================================== */
app.get("/api/logs", verifyToken, (req, res) => {
    const query = `SELECT waktu, eksekutor, tipe_aksi, deskripsi FROM logs ORDER BY id DESC`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal mengambil data log" });
        res.json(rows);
    });
});

app.get("/api/setting-harga", verifyToken, (req, res) => {
    const query = `SELECT * FROM settings WHERE id = 'config_harga'`;
    db.get(query, [], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal mengambil setting harga" });
        res.json(row || {
            modalWarung: 16000, jualWarung: 18000, modalEcer: 16000, jualEcer: 19000,
            modalAquaWarung: 14000, jualAquaWarung: 16000, modalAquaEcer: 15000, jualAquaEcer: 18000
        });
    });
});

app.post("/api/setting-harga", verifyToken, (req, res) => {
    const {
        modalWarung, jualWarung, modalEcer, jualEcer,
        modalAquaWarung, jualAquaWarung, modalAquaEcer, jualAquaEcer
    } = req.body;

    const penanggungJawab = req.user.username;
    const queryGetOld = `SELECT * FROM settings WHERE id = 'config_harga'`;

    db.get(queryGetOld, [], (err, oldRow) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal memproses data lama" });

        const old = oldRow || {
            modalWarung: 16000, jualWarung: 18000, modalEcer: 16000, jualEcer: 19000,
            modalAquaWarung: 14000, jualAquaWarung: 16000, modalAquaEcer: 15000, jualAquaEcer: 18000
        };

        const queryUpdate = `
            UPDATE settings 
            SET modalWarung = ?, jualWarung = ?, modalEcer = ?, jualEcer = ?, 
                modalAquaWarung = ?, jualAquaWarung = ?, modalAquaEcer = ?, jualAquaEcer = ? 
            WHERE id = 'config_harga'
        `;

        const params = [
            modalWarung, jualWarung, modalEcer, jualEcer,
            modalAquaWarung, jualAquaWarung, modalAquaEcer, jualAquaEcer
        ];

        db.run(queryUpdate, params, function (updateErr) {
            if (updateErr) return res.status(500).json({ success: false, message: "Gagal memperbarui harga" });

            const deskripsiDetailLog =
                `Mengubah set harga modal/jual. ` +
                `[LPG Warung - M: ${old.modalWarung}->${modalWarung} | J: ${old.jualWarung}->${jualWarung}] ` +
                `[LPG Ecer - M: ${old.modalEcer}->${modalEcer} | J: ${old.jualEcer}->${jualEcer}] ` +
                `[Aqua Warung - M: ${old.modalAquaWarung}->${modalAquaWarung} | J: ${old.jualAquaWarung}->${jualAquaWarung}] ` +
                `[Aqua Ecer - M: ${old.modalAquaEcer}->${modalAquaEcer} | J: ${old.jualAquaEcer}->${jualAquaEcer}]`;

            catatLog(penanggungJawab, "EDIT HARGA", deskripsiDetailLog);
            res.json({ success: true, message: "Harga berhasil diperbarui!" });
        });
    });
});

/* ==========================================
   API ENDPOINTS: AUTHENTICATION (SECURED)
========================================== */
app.post("/api/login", loginLimiter, (req, res) => {
    const { username, password } = req.body;

    const query = `SELECT * FROM users WHERE username = ?`;
    db.get(query, [username], async (err, row) => {
        if (err) {
            console.error("❌ DB Error on login:", err);
            return res.status(500).json({ success: false, message: "Error pada server" });
        }
        if (!row) return res.status(401).json({ success: false, message: "Username atau Password salah!" });

        try {
            let match = false;
            
            // Deteksi apakah password lama masih plain-text (tidak diawali $2)
            if (row.password && !row.password.startsWith('$2')) {
                if (password === row.password) {
                    match = true;
                    // Auto-upgrade ke bcrypt secara diam-diam
                    const newHash = await bcrypt.hash(password, 10);
                    db.run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, row.id], (err) => {
                        if (err) console.error("Gagal auto-upgrade password:", err);
                    });
                }
            } else {
                match = await bcrypt.compare(password, row.password);
            }

            if (match) {
                res.json({
                    success: true,
                    message: "Kredensial valid! Lanjut ke verifikasi PIN.",
                    username: row.username,
                    role: row.role,
                    hasPin: !!row.pin
                });
            } else {
                res.status(401).json({ success: false, message: "Username atau Password salah!" });
            }
        } catch (e) {
            console.error("❌ Error on compare login:", e);
            res.status(500).json({ success: false, message: "Gagal memproses password" });
        }
    });
});

/* ==========================================
   API ENDPOINTS: FORGOT PASSWORD
========================================== */
app.post("/api/forgot-password", loginLimiter, (req, res) => {
    const { username, pin, newPassword } = req.body;
    if (!username || !pin || !newPassword) {
        return res.status(400).json({ success: false, message: "Username, PIN, dan Password Baru wajib diisi!" });
    }

    db.get(`SELECT pin FROM users WHERE username = ?`, [username], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: "Error pada server" });
        if (!row) return res.status(404).json({ success: false, message: "Username tidak ditemukan" });
        if (!row.pin) return res.status(400).json({ success: false, message: "Akun ini belum memiliki PIN!" });

        try {
            const pinMatch = await bcrypt.compare(pin, row.pin);
            if (pinMatch) {
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                db.run(`UPDATE users SET password = ? WHERE username = ?`, [hashedPassword, username], (updateErr) => {
                    if (updateErr) return res.status(500).json({ success: false, message: "Gagal mereset password" });
                    catatLog(username, "RESET PASSWORD", `User ${username} mereset password menggunakan PIN`);
                    res.json({ success: true, message: "Password berhasil di-reset! Silakan login." });
                });
            } else {
                res.status(401).json({ success: false, message: "PIN salah! Gagal mereset password." });
            }
        } catch (e) {
            console.error("❌ Error on reset password:", e);
            res.status(500).json({ success: false, message: "Gagal memproses password baru" });
        }
    });
});

/* ==========================================
   API ENDPOINTS: PIN AUTHENTICATOR
========================================== */
app.post("/api/verify-pin", pinLimiter, (req, res) => {
    const { username, pin } = req.body;
    if (!username || !pin) return res.status(400).json({ success: false, message: "Username dan PIN wajib diisi!" });

    db.get(`SELECT pin FROM users WHERE username = ?`, [username], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: "Error server" });
        if (!row) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        if (!row.pin) return res.status(400).json({ success: false, message: "PIN belum diatur" });

        try {
            const pinMatch = await bcrypt.compare(pin, row.pin);
            if (pinMatch) {
                db.get(`SELECT id, role FROM users WHERE username = ?`, [username], (errRole, roleRow) => {
                    const token = jwt.sign({ id: roleRow.id, username: username, role: roleRow.role }, JWT_SECRET, { expiresIn: '12h' });
                    res.json({ success: true, message: "PIN terverifikasi! Selamat datang.", token });
                });
            } else {
                res.status(401).json({ success: false, message: "PIN salah! Coba lagi." });
            }
        } catch (e) {
            console.error("❌ Error on verify pin compare:", e);
            res.status(500).json({ success: false, message: "Gagal memverifikasi PIN" });
        }
    });
});

app.post("/api/set-pin", async (req, res) => {
    const { username, pin } = req.body;
    if (!username || !pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
        return res.status(400).json({ success: false, message: "PIN harus 6 digit angka!" });
    }

    try {
        const hashedPin = await bcrypt.hash(pin, SALT_ROUNDS);
        db.run(`UPDATE users SET pin = ? WHERE username = ?`, [hashedPin, username], function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal menyimpan PIN" });
            if (this.changes === 0) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
            catatLog(username, "SET PIN", `User ${username} mengatur PIN authenticator baru`);
            
            db.get(`SELECT id, role FROM users WHERE username = ?`, [username], (errRole, roleRow) => {
                const token = jwt.sign({ id: roleRow.id, username: username, role: roleRow.role }, JWT_SECRET, { expiresIn: '12h' });
                res.json({ success: true, message: "PIN berhasil diatur!", token });
            });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Gagal enkripsi PIN" });
    }
});

app.post("/api/reset-pin/:id", verifyToken, (req, res) => {
    const id = req.params.id;
    const adminUser = req.user.username;
    const requesterRole = req.user.role;

    db.get(`SELECT username, role FROM users WHERE id = ?`, [id], (searchErr, row) => {
        if (searchErr || !row) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        if ((row.role === "admin" || row.role === "superadmin") && requesterRole !== "superadmin") {
            return res.status(403).json({ success: false, message: "Hanya Super Admin yang bisa mereset PIN akun Admin/Super Admin!" });
        }

        db.run(`UPDATE users SET pin = NULL WHERE id = ?`, [id], function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal reset PIN" });
            catatLog(adminUser, "RESET PIN", `Admin ${adminUser} mereset PIN authenticator user ${row.username}`);
            res.json({ success: true, message: `PIN user ${row.username} berhasil direset!` });
        });
    });
});

app.post("/register", verifyToken, async (req, res) => {
    const { username, password, role } = req.body;
    const requesterRole = req.user.role;
    const userRole = role || "user";

    if (!username || !password || password.trim() === "") {
        return res.status(400).json({ success: false, message: "Username & Password wajib diisi!" });
    }

    if (userRole === "superadmin") {
        return res.status(403).json({ success: false, message: "Tidak diizinkan membuat akun superadmin secara manual!" });
    }

    if (userRole === "admin" && requesterRole !== "superadmin") {
        return res.status(403).json({ success: false, message: "Hanya Super Admin yang bisa membuat akun Admin baru!" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const query = `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`;

        db.run(query, [username, hashedPassword, userRole], function (err) {
            if (err) {
                if (err.message.includes("UNIQUE constraint failed")) {
                    return res.status(400).json({ success: false, message: "Username sudah terdaftar bro!" });
                }
                return res.status(500).json({ success: false, message: "Gagal menyimpan ke database" });
            }
            res.status(200).json({ success: true, message: "Akun berhasil dibuat!" });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Proses enkripsi gagal" });
    }
});

app.get("/api/users", verifyToken, (req, res) => {
    db.all(`SELECT id, username, role FROM users ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal mengambil data user" });
        res.json(rows);
    });
});

app.post("/api/users/update/:id", verifyToken, async (req, res) => {
    const id = req.params.id;
    const { username, password, role } = req.body;
    const requesterRole = req.user.role;

    if (!id || !username || !role) {
        return res.status(400).json({ success: false, message: "Data ID, Username, dan Role wajib ada!" });
    }

    db.get(`SELECT role FROM users WHERE id = ?`, [id], async (searchErr, row) => {
        if (searchErr || !row) return res.status(404).json({ success: false, message: "User tidak ditemukan!" });

        if (role === "superadmin" && row.role !== "superadmin") {
            return res.status(403).json({ success: false, message: "Tidak bisa mengubah role menjadi superadmin!" });
        }

        if ((row.role === "admin" || row.role === "superadmin") && requesterRole !== "superadmin") {
            return res.status(403).json({ success: false, message: "Akses ditolak! Hanya Super Admin yang bisa mengedit akun Admin/Super Admin." });
        }

        const runUpdate = async () => {
            try {
                if (password && password.trim() !== "") {
                    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
                    const query = `UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?`;
                    db.run(query, [username, hashedPassword, role, id], function (err) {
                        if (err) {
                            if (err.message.includes("UNIQUE constraint failed")) return res.status(400).json({ success: false, message: "Username sudah dipakai!" });
                            return res.status(500).json({ success: false, message: "Gagal memperbarui profil" });
                        }
                        res.json({ success: true, message: "Profil dan password berhasil diupdate!" });
                    });
                } else {
                    const query = `UPDATE users SET username = ?, role = ? WHERE id = ?`;
                    db.run(query, [username, role, id], function (err) {
                        if (err) {
                            if (err.message.includes("UNIQUE constraint failed")) return res.status(400).json({ success: false, message: "Username sudah dipakai!" });
                            return res.status(500).json({ success: false, message: "Gagal memperbarui profil" });
                        }
                        res.json({ success: true, message: "Profil berhasil diupdate!" });
                    });
                }
            } catch (updateErr) {
                console.error("❌ Error on user update bcrypt:", updateErr);
                res.status(500).json({ success: false, message: "Gagal mengenkripsi password" });
            }
        };

        runUpdate();
    });
});

app.post("/api/users/delete/:id", verifyToken, (req, res) => {
    const requesterRole = req.user.role;

    db.get(`SELECT role FROM users WHERE id = ?`, [req.params.id], (searchErr, row) => {
        if (searchErr || !row) return res.status(404).json({ success: false, message: "User tidak ditemukan!" });

        if (row.role === "superadmin") {
            return res.status(403).json({ success: false, message: "Akun Super Admin tidak bisa dihapus!" });
        }

        if (row.role === "admin" && requesterRole !== "superadmin") {
            return res.status(403).json({ success: false, message: "Hanya Super Admin yang bisa menghapus akun Admin!" });
        }

        db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal menghapus user" });
            res.json({ success: true, message: "User deleted successfully" });
        });
    });
});

app.post("/api/users/change-password", verifyToken, async (req, res) => {
    const username = req.user.username;
    const { oldPassword, newPassword } = req.body;

    if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({ success: false, message: "Semua field harus diisi!" });
    }

    db.get(`SELECT id, password FROM users WHERE username = ?`, [username], async (err, row) => {
        if (err || !row) return res.status(404).json({ success: false, message: "User tidak ditemukan!" });

        try {
            const isMatch = await bcrypt.compare(oldPassword, row.password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: "Password lama salah!" });
            }

            const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedNewPassword, row.id], function (updateErr) {
                if (updateErr) return res.status(500).json({ success: false, message: "Gagal memperbarui password" });
                catatLog(username, "UBAH PASSWORD", `User ${username} mengubah passwordnya sendiri`);
                res.json({ success: true, message: "Password berhasil diubah!" });
            });
        } catch (e) {
            res.status(500).json({ success: false, message: "Error saat verifikasi password" });
        }
    });
});

/* ==========================================
   API ENDPOINTS: STOCK MANAGEMENT
========================================== */
app.post("/add", verifyToken, (req, res) => {
    const { tanggal, kategori, masuk, keluar } = req.body;
    const numMasuk = Number(masuk) || 0;
    const numKeluar = Number(keluar) || 0;
    const olehUser = req.user.username;

    if (!tanggal || !kategori) {
        return res.status(400).json({ success: false, message: "Tanggal dan Kategori wajib diisi!" });
    }
    if (numMasuk < 0 || numKeluar < 0) {
        return res.status(400).json({ success: false, message: "Jumlah masuk dan keluar tidak boleh negatif!" });
    }
    if (numMasuk === 0 && numKeluar === 0) {
        return res.status(400).json({ success: false, message: "Jumlah masuk atau keluar harus lebih dari 0!" });
    }

    db.run(
        `INSERT INTO stock (tanggal, kategori, masuk, keluar, oleh) VALUES (?, ?, ?, ?, ?)`,
        [tanggal, kategori, numMasuk, numKeluar, olehUser],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal input stok" });
            catatLog(olehUser, "INPUT", `Menambah stock ${kategori} (Masuk: ${numMasuk}, Keluar: ${numKeluar}) untuk tanggal ${tanggal}`);
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.get("/data", verifyToken, (req, res) => {
    db.all(`SELECT * FROM stock ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal mengambil data" });
        const fixedRows = rows.map(item => ({
            ...item,
            masuk: Number(item.masuk) || 0,
            keluar: Number(item.keluar) || 0,
            oleh: item.oleh || "admin"
        }));
        res.json(fixedRows);
    });
});

app.post("/delete/:id", verifyToken, (req, res) => {
    const id = req.params.id;
    const olehUser = req.user.username;

    db.get(`SELECT tanggal, kategori, oleh FROM stock WHERE id = ?`, [id], (searchErr, row) => {
        let deskripsiHapus = `Menghapus data stock dengan ID: ${id}`;
        if (!searchErr && row) {
            deskripsiHapus = `Menghapus data stock ${row.kategori} tanggal ${row.tanggal} (ID: ${id}) oleh ${row.oleh || 'admin'}`;
        }

        db.run(`DELETE FROM stock WHERE id = ?`, [id], function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal menghapus data" });
            catatLog(olehUser, "DELETE", deskripsiHapus);
            res.json({ success: true });
        });
    });
});

app.post("/edit/:id", verifyToken, (req, res) => {
    const id = req.params.id;
    const { tanggal, kategori, masuk, keluar } = req.body;
    const numMasuk = Number(masuk) || 0;
    const numKeluar = Number(keluar) || 0;
    const olehUser = req.user.username;

    if (!tanggal || !kategori) {
        return res.status(400).json({ success: false, message: "Tanggal dan Kategori wajib diisi!" });
    }
    if (numMasuk < 0 || numKeluar < 0) {
        return res.status(400).json({ success: false, message: "Jumlah masuk dan keluar tidak boleh negatif!" });
    }
    if (numMasuk === 0 && numKeluar === 0) {
        return res.status(400).json({ success: false, message: "Jumlah masuk atau keluar harus lebih dari 0!" });
    }

    db.get(`SELECT tanggal, kategori, masuk, keluar FROM stock WHERE id = ?`, [id], (searchErr, oldData) => {
        if (searchErr || !oldData) return res.status(404).json({ success: false, message: "Data tidak ditemukan!" });

        db.run(
            `UPDATE stock SET tanggal = ?, kategori = ?, masuk = ?, keluar = ?, oleh = ? WHERE id = ?`,
            [tanggal, kategori, numMasuk, numKeluar, olehUser, id],
            function (err) {
                if (err) return res.status(500).json({ success: false, message: "Gagal update stok" });
                
                const deskripsiLog = `Mengubah stock (ID: ${id}) dari [${oldData.tanggal} - ${oldData.kategori} | M: ${oldData.masuk}, K: ${oldData.keluar}] menjadi [${tanggal} - ${kategori} | M: ${numMasuk}, K: ${numKeluar}]`;
                catatLog(olehUser, "EDIT STOCK", deskripsiLog);
                res.json({ success: true });
            }
        );
    });
});

/* ==========================================
   API ENDPOINTS: PENGELUARAN (EXPENSES)
========================================== */
app.get("/api/expenses", verifyToken, (req, res) => {
    db.all(`SELECT * FROM expenses ORDER BY tanggal DESC, id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal mengambil data pengeluaran" });
        res.json(rows);
    });
});

app.post("/api/expenses/add", verifyToken, (req, res) => {
    const { tanggal, kategori, jumlah, keterangan } = req.body;
    const numJumlah = Number(jumlah) || 0;
    const olehUser = req.user.username;

    if (!tanggal || !kategori || numJumlah <= 0) {
        return res.status(400).json({ success: false, message: "Data pengeluaran tidak valid!" });
    }

    db.run(
        `INSERT INTO expenses (tanggal, kategori, jumlah, keterangan, oleh) VALUES (?, ?, ?, ?, ?)`,
        [tanggal, kategori, numJumlah, keterangan, olehUser],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal input pengeluaran" });
            catatLog(olehUser, "INPUT EXPENSE", `Menambah pengeluaran [${kategori}]: Rp ${numJumlah} pada ${tanggal}`);
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.post("/api/expenses/delete/:id", verifyToken, (req, res) => {
    const id = req.params.id;
    const olehUser = req.user.username;

    db.get(`SELECT tanggal, kategori, jumlah FROM expenses WHERE id = ?`, [id], (searchErr, row) => {
        if (searchErr || !row) return res.status(404).json({ success: false, message: "Data tidak ditemukan" });

        db.run(`DELETE FROM expenses WHERE id = ?`, [id], function (err) {
            if (err) return res.status(500).json({ success: false, message: "Gagal menghapus pengeluaran" });
            catatLog(olehUser, "DELETE EXPENSE", `Menghapus pengeluaran [${row.kategori}]: Rp ${row.jumlah} tanggal ${row.tanggal}`);
            res.json({ success: true });
        });
    });
});

/* =========================
SERVER & SAFE SHUTDOWN
========================= */

/* =========================
   UPLOAD LOGO API
========================= */
app.post("/api/upload-logo", verifyToken, async (req, res) => {
    const { logoBase64 } = req.body;
    if (!logoBase64) {
        return res.status(400).json({ success: false, error: "Tidak ada data gambar yang dikirim!" });
    }

    try {
        const base64Data = logoBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        
        // Vercel Blob Storage jika env BLOB_READ_WRITE_TOKEN di-set
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            const blob = await put('ADEQUA-LOGO.png', buffer, {
                access: 'public',
                addRandomSuffix: false
            });
            // Opsional: Simpan URL blob ini di database tabel settings jika ingin dinamis,
            // saat ini kita menggunakan nama statis sehingga URL-nya tetap.
            res.json({ success: true, message: "Logo berhasil diupdate di Vercel Blob!", url: blob.url });
        } else {
            // Mode Lokal
            const logoPath = path.join(__dirname, "Public", "ADEQUA-LOGO.png");
            fs.writeFileSync(logoPath, buffer);
            res.json({ success: true, message: "Logo berhasil diupdate secara lokal!" });
        }
    } catch (err) {
        console.error("❌ Gagal mengunggah logo:", err);
        res.status(500).json({ success: false, error: "Gagal menyimpan logo di server." });
    }
});

/* =========================
   EXPORT / SERVER START
========================= */
if (process.env.VERCEL) {
    // Jalankan sebagai Serverless Function di Vercel
    module.exports = app;
} else {
    // Jalankan sebagai Server lokal
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    });

    process.on("SIGINT", () => {
        db.close((err) => {
            if (err) console.error(err.message);
            console.log("💾 Koneksi SQLite ditutup dengan aman.");
            process.exit(0);
        });
    });
}