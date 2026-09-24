const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'voley.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora_inicio INTEGER NOT NULL,
      hora_fin INTEGER NOT NULL,
      nombre_cliente TEXT NOT NULL,
      telefono TEXT NOT NULL,
      metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('yape', 'plin', 'transferencia')),
      comprobante_path TEXT NOT NULL,
      monto_total REAL NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'confirmada', 'rechazada', 'expirada', 'cancelada')),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      confirmed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reservas_fecha ON reservas(fecha);
    CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado);
    CREATE INDEX IF NOT EXISTS idx_reservas_fecha_estado ON reservas(fecha, estado);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

module.exports = { db, initializeDatabase };
