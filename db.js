// ============================================================
//  KneeSync AI — Database Setup & Auto-Migration
//  Supports both SQLite (Local) and PostgreSQL (Render)
// ============================================================

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Pool } = require('pg');
const path = require('path');

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
        role VARCHAR(50) DEFAULT 'therapist',
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
        baseline_angle REAL DEFAULT 58.30,
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
    `;

    if (isPostgres) {
      await dbInstance.query(schema);
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_sessions_patient_date ON sessions(patient_id, session_date);').catch(()=>{});
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_readings_session ON sensor_readings(session_id, ts);').catch(()=>{});
      await dbInstance.query('CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, alert_time);').catch(()=>{});
    } else {
      await dbInstance.exec(schema);
      await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_sessions_patient_date ON sessions(patient_id, session_date);');
      await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_readings_session ON sensor_readings(session_id, ts);');
      await dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, alert_time);');
    }

    console.log('✅ Database Schema Initialized. (Mock data seeding removed for production)');

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
