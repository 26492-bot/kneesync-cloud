// ============================================================
//  KneeSync AI — Database Setup & Auto-Migration
//  Supports both SQLite (Local) and PostgreSQL (Render)
// ============================================================

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let dbPromise = null;
let isPostgres = false;

// Convert SQLite '?' placeholders to PostgreSQL '$1, $2...'
function convertSql(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

async function setupDB() {
  if (dbPromise) return dbPromise;

  isPostgres = !!process.env.DATABASE_URL;
  let dbInstance;

  dbPromise = (async () => {
    if (isPostgres) {
      console.log('🔗 Connecting to PostgreSQL...');
      dbInstance = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
      });
    } else {
      console.log('🔗 Connecting to SQLite (Local)...');
      dbInstance = await open({
        filename: path.join(__dirname, 'kneesync.db'),
        driver: sqlite3.Database
      });
      await dbInstance.exec('PRAGMA journal_mode = WAL');
      await dbInstance.exec('PRAGMA foreign_keys = ON');
    }

    // ============================================================
    //  Schema Creation
    // ============================================================
    const pk = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsDefault = isPostgres ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : "TEXT DEFAULT (datetime('now','localtime'))";

    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        user_id ${pk},
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'patient',
        created_at ${tsDefault}
      );

      CREATE TABLE IF NOT EXISTS patients (
        patient_id ${pk},
        user_id INTEGER,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        full_name VARCHAR(255) NOT NULL,
        age INTEGER,
        gender VARCHAR(50),
        condition_desc TEXT,
        baseline_angle REAL DEFAULT NULL,
        baseline_status VARCHAR(20) DEFAULT 'pending',
        baseline_samples INTEGER DEFAULT 0,
        baseline_mean REAL DEFAULT NULL,
        baseline_sd REAL DEFAULT NULL,
        running_avg_tilt REAL DEFAULT 0,
        running_avg_tremor REAL DEFAULT 0,
        running_avg_angle REAL DEFAULT 0,
        reading_count INTEGER DEFAULT 0,
        device_id VARCHAR(100),
        battery_level REAL DEFAULT NULL,
        firmware_version VARCHAR(50) DEFAULT NULL,
        profile_image TEXT DEFAULT NULL,
        created_at ${tsDefault},
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id ${pk},
        patient_id INTEGER NOT NULL,
        session_date VARCHAR(50) NOT NULL,
        steps INTEGER DEFAULT 0,
        avg_angle REAL,
        max_angle REAL,
        min_angle REAL,
        gait_score INTEGER,
        fall_risk INTEGER,
        symmetry INTEGER,
        duration_min INTEGER,
        alert_count INTEGER DEFAULT 0,
        ai_insight TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        reading_id ${pk},
        session_id INTEGER NOT NULL,
        ts VARCHAR(50) NOT NULL,
        knee_angle REAL,
        tilt_angle REAL,
        tremor_rms REAL,
        gait_phase VARCHAR(50),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS alerts (
        alert_id ${pk},
        patient_id INTEGER NOT NULL,
        session_id INTEGER,
        alert_time VARCHAR(50) NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        knee_angle REAL,
        fall_risk INTEGER,
        gait_phase VARCHAR(50),
        detail TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS baseline_steps (
        step_id ${pk},
        patient_id INTEGER NOT NULL,
        knee_angle REAL NOT NULL,
        recorded_at VARCHAR(50) NOT NULL,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );
    `;

    if (isPostgres) {
      await dbInstance.query(schema);
      
      // Auto-migrate missing columns for existing PostgreSQL databases
      const pgMigrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'patient';",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS baseline_status VARCHAR(20) DEFAULT 'pending';",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS baseline_samples INTEGER DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS baseline_mean REAL DEFAULT NULL;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS baseline_sd REAL DEFAULT NULL;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS running_avg_tilt REAL DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS running_avg_tremor REAL DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS running_avg_angle REAL DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS reading_count INTEGER DEFAULT 0;",
      ];
      for (const sql of pgMigrations) {
        await dbInstance.query(sql).catch(e => console.log('Migration Notice:', e.message));
      }
      
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_sessions_patient_date ON sessions(patient_id, session_date);').catch(()=>{});
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_readings_session ON sensor_readings(session_id, ts);').catch(()=>{});
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, alert_time);').catch(()=>{});
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_baseline_steps_patient ON baseline_steps(patient_id);').catch(()=>{});
    } else {
      await dbInstance.exec(schema);
      
      // Auto-migrate missing columns for existing SQLite databases (ignores error if column exists)
      const sqliteMigrations = [
        "ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'patient';",
        "ALTER TABLE patients ADD COLUMN user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE;",
        "ALTER TABLE patients ADD COLUMN baseline_status VARCHAR(20) DEFAULT 'pending';",
        "ALTER TABLE patients ADD COLUMN baseline_samples INTEGER DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN baseline_mean REAL DEFAULT NULL;",
        "ALTER TABLE patients ADD COLUMN baseline_sd REAL DEFAULT NULL;",
        "ALTER TABLE patients ADD COLUMN running_avg_tilt REAL DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN running_avg_tremor REAL DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN running_avg_angle REAL DEFAULT 0;",
        "ALTER TABLE patients ADD COLUMN reading_count INTEGER DEFAULT 0;",
      ];
      for (const sql of sqliteMigrations) {
        try { await dbInstance.exec(sql); } catch(e) {}
      }
      
      await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_sessions_patient_date ON sessions(patient_id, session_date);');
      await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_readings_session ON sensor_readings(session_id, ts);');
      await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, alert_time);');
      try { await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_baseline_steps_patient ON baseline_steps(patient_id);'); } catch(e) {}
    }
    
    // ============================================================
    //  Seed Admin User (password from env, NOT hardcoded)
    // ============================================================
    const deleteAdminSql = "DELETE FROM users WHERE email = 'admin@kneesync.com'";
    if (isPostgres) {
      await dbInstance.query(deleteAdminSql).catch(e => console.log(e.message));
    } else {
      try { await dbInstance.run(deleteAdminSql); } catch(e) {}
    }

    let checkAdminSql = "SELECT user_id FROM users WHERE email = 'admin@kneesync.com'";
    let adminExists = false;
    if (isPostgres) {
      const res = await dbInstance.query(checkAdminSql);
      adminExists = res.rows.length > 0;
    } else {
      const res = await dbInstance.get(checkAdminSql);
      adminExists = !!res;
    }

    if (!adminExists) {
      console.log('🌱 Seeding default Admin user...');
      
      // Read password from env variable; generate random if not set
      let adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;
      if (!adminPassword) {
        adminPassword = crypto.randomBytes(12).toString('base64url');
        console.log('');
        console.log('  ╔══════════════════════════════════════════════════════════╗');
        console.log('  ║  ⚠️  No ADMIN_DEFAULT_PASSWORD set in .env              ║');
        console.log(`  ║  🔑 Generated Admin Password: ${adminPassword.padEnd(20)}   ║`);
        console.log('  ║  📧 Admin Email: admin@kneesync.com                     ║');
        console.log('  ║  💾 Save this password! It won\'t be shown again.        ║');
        console.log('  ╚══════════════════════════════════════════════════════════╝');
        console.log('');
      }
      
      const adminPass = await bcrypt.hash(adminPassword, 10);
      const insertAdminSql = "INSERT INTO users (email, password, full_name, role) VALUES ($1, $2, $3, $4)";
      const insertAdminSqlite = "INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)";
      
      if (isPostgres) {
        await dbInstance.query(insertAdminSql, ['admin@kneesync.com', adminPass, 'System Administrator', 'admin']);
      } else {
        await dbInstance.run(insertAdminSqlite, ['admin@kneesync.com', adminPass, 'System Administrator', 'admin']);
      }
    }

    console.log('✅ Database Schema Initialized.');

    // Wrapper Object to handle dialect differences
    return {
      isPostgres,
      get: async (sql, params = []) => {
        if (isPostgres) {
          const pgSql = convertSql(sql);
          const res = await dbInstance.query(pgSql, params);
          return res.rows[0];
        } else {
          return await dbInstance.get(sql, params);
        }
      },
      all: async (sql, params = []) => {
        if (isPostgres) {
          const pgSql = convertSql(sql);
          const res = await dbInstance.query(pgSql, params);
          return res.rows;
        } else {
          return await dbInstance.all(sql, params);
        }
      },
      run: async (sql, params = []) => {
        if (isPostgres) {
          let pgSql = convertSql(sql);
          // Auto-append RETURNING * for Postgres INSERTS to mimic lastID
          if (pgSql.trim().toUpperCase().startsWith('INSERT') && !pgSql.includes('RETURNING')) {
             pgSql += ' RETURNING *';
          }
          const res = await dbInstance.query(pgSql, params);
          if (res.command === 'INSERT' && res.rows.length > 0) {
            const keys = Object.keys(res.rows[0]);
            return { lastID: res.rows[0][keys[0]], changes: res.rowCount };
          }
          return { changes: res.rowCount };
        } else {
          return await dbInstance.run(sql, params);
        }
      }
    };
  })();

  return dbPromise;
}

module.exports = { setupDB };
