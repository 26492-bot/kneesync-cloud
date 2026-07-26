// ============================================================
//  KneeSync AI — SQLite Database Setup & Auto-Migration
//  สร้างตาราง + seed ข้อมูลตัวอย่างอัตโนมัติ (Async with sqlite3)
// ============================================================

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let dbPromise = null;

async function setupDB() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const db = await open({
      filename: path.join(__dirname, 'kneesync.db'),
      driver: sqlite3.Database
    });

    // Performance settings
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA foreign_keys = ON');

    // ============================================================
    //  Schema — สร้างตาราง
    // ============================================================
    await db.exec(`
      CREATE TABLE IF NOT EXISTS patients (
        patient_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        email        TEXT UNIQUE,
        password     TEXT,
        full_name    TEXT NOT NULL,
        age          INTEGER,
        gender       TEXT CHECK(gender IN ('ชาย','หญิง')),
        condition_desc TEXT,
        baseline_angle REAL DEFAULT 58.30,
        device_id    TEXT,
        battery_level REAL DEFAULT NULL,
        firmware_version TEXT DEFAULT NULL,
        profile_image TEXT DEFAULT NULL,
        created_at   TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id   INTEGER NOT NULL,
        session_date TEXT NOT NULL,
        steps        INTEGER DEFAULT 0,
        avg_angle    REAL,
        max_angle    REAL,
        min_angle    REAL,
        gait_score   INTEGER,
        fall_risk    INTEGER,
        symmetry     INTEGER,
        duration_min INTEGER,
        alert_count  INTEGER DEFAULT 0,
        ai_insight   TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        reading_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   INTEGER NOT NULL,
        ts           TEXT NOT NULL,
        knee_angle   REAL,
        tilt_angle   REAL,
        tremor_rms   REAL,
        gait_phase   TEXT CHECK(gait_phase IN ('Stance','Swing')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS alerts (
        alert_id     INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id   INTEGER NOT NULL,
        session_id   INTEGER,
        alert_time   TEXT NOT NULL,
        alert_type   TEXT CHECK(alert_type IN ('posture','fall','tremor')) NOT NULL,
        knee_angle   REAL,
        fall_risk    INTEGER,
        gait_phase   TEXT CHECK(gait_phase IN ('Stance','Swing')),
        detail       TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_patient_date ON sessions(patient_id, session_date);
      CREATE INDEX IF NOT EXISTS idx_readings_session ON sensor_readings(session_id, ts);
      CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, alert_time);
    `);

    // ============================================================
    //  Seed — ข้อมูลตัวอย่าง (ถ้ายังไม่มีข้อมูล)
    // ============================================================
    const count = await db.get('SELECT COUNT(*) as cnt FROM patients');
    if (count.cnt === 0) {
      console.log('🌱 Seeding database with sample data...');

      await db.run(`
        INSERT INTO patients (patient_id, full_name, age, gender, condition_desc, baseline_angle, device_id)
        VALUES (1, 'สมชาย ใจดี', 65, 'ชาย', 'ฟื้นฟูหลังผ่าตัดข้อเข่า (TKR)', 58.30, 'KS-001')
      `);

      const sessions = [
        [1,1,'2026-05-30',1240,49.06,68.2,33.45,59,65,68,38,22],
        [2,1,'2026-05-31',1419,45.87,61.55,30.0,54,67,70,27,26],
        [3,1,'2026-06-01',1836,47.24,65.07,31.1,56,64,76,35,21],
        [4,1,'2026-06-02',1357,52.21,67.41,35.67,58,63,73,35,25],
        [5,1,'2026-06-03',1602,53.16,72.17,36.32,59,65,70,31,20],
        [6,1,'2026-06-04',2200,48.56,64.45,33.08,68,60,70,44,22],
        [7,1,'2026-06-05',1380,49.08,66.13,32.48,62,58,77,26,22],
        [8,1,'2026-06-06',1543,50.75,64.27,32.61,72,54,76,42,18],
        [9,1,'2026-06-07',2143,52.41,72.07,30.44,66,62,75,31,18],
        [10,1,'2026-06-08',2303,54.05,71.01,36.12,71,52,75,26,17],
        [11,1,'2026-06-09',2313,53.3,66.56,32.46,67,51,84,42,18],
        [12,1,'2026-06-10',2014,51.96,66.63,36.04,68,56,76,41,19],
        [13,1,'2026-06-11',1739,53.23,72.67,32.18,68,53,85,36,18],
        [14,1,'2026-06-12',1528,54.07,68.7,33.02,73,47,85,21,18],
        [15,1,'2026-06-13',1585,53.53,72.93,34.76,75,46,84,38,15],
        [16,1,'2026-06-14',1988,55.85,71.29,36.79,81,46,82,20,14],
        [17,1,'2026-06-15',1890,58.19,75.94,40.5,84,45,88,42,11],
        [18,1,'2026-06-16',2255,60.33,76.71,39.05,85,46,87,33,13],
        [19,1,'2026-06-17',1771,56.33,74.99,38.6,76,37,86,32,13],
        [20,1,'2026-06-18',1971,60.3,72.52,42.54,84,38,85,23,10],
        [21,1,'2026-06-19',2629,57.36,71.34,36.49,89,34,85,21,10],
        [22,1,'2026-06-20',1505,61.55,74.37,41.14,90,34,92,37,11],
        [23,1,'2026-06-21',2128,61.0,78.85,44.12,91,31,94,32,11]
      ];

      for (const s of sessions) {
        await db.run(`
          INSERT INTO sessions (session_id, patient_id, session_date, steps, avg_angle, max_angle, min_angle, gait_score, fall_risk, symmetry, duration_min, alert_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, s);
      }

      const readings = [
        [23,'2026-06-21 09:00:00',51.31,0.26,0.132,'Stance'],
        [23,'2026-06-21 09:00:30',52.97,3.42,0.057,'Stance'],
        [23,'2026-06-21 09:01:00',61.67,3.66,0.032,'Swing'],
        [23,'2026-06-21 09:01:30',60.5,7.16,0.105,'Stance'],
        [23,'2026-06-21 09:02:00',59.88,8.58,0.013,'Swing'],
        [23,'2026-06-21 09:02:30',65.84,9.01,0.104,'Swing'],
        [23,'2026-06-21 09:03:00',65.44,9.84,0.014,'Stance'],
        [23,'2026-06-21 09:03:30',65.46,8.8,0.087,'Stance'],
        [23,'2026-06-21 09:04:00',60.47,9.27,0.112,'Stance'],
        [23,'2026-06-21 09:04:30',57.72,8.6,0.038,'Stance'],
        [23,'2026-06-21 09:05:00',47.47,7.63,0.08,'Swing'],
        [23,'2026-06-21 09:05:30',42.01,7.12,0.073,'Swing'],
        [23,'2026-06-21 09:06:00',44.8,6.98,0.042,'Stance'],
        [23,'2026-06-21 09:06:30',32.56,4.81,0.027,'Stance'],
        [23,'2026-06-21 09:07:00',32.65,3.5,0.146,'Swing'],
        [23,'2026-06-21 09:07:30',32.38,1.51,0.13,'Stance'],
        [23,'2026-06-21 09:08:00',33.8,2.19,0.07,'Stance'],
        [23,'2026-06-21 09:08:30',28.18,2.2,0.141,'Stance'],
        [23,'2026-06-21 09:09:00',37.31,4.74,0.011,'Swing'],
        [23,'2026-06-21 09:09:30',33.62,5.34,0.084,'Stance'],
        [23,'2026-06-21 09:10:00',47.91,6.41,0.115,'Swing'],
        [23,'2026-06-21 09:10:30',51.21,7.65,0.078,'Stance'],
        [23,'2026-06-21 09:11:00',53.03,10.19,0.149,'Stance'],
        [23,'2026-06-21 09:11:30',59.62,9.78,0.111,'Swing'],
        [23,'2026-06-21 09:12:00',59.36,8.6,0.099,'Stance'],
        [23,'2026-06-21 09:12:30',61.62,7.9,0.0,'Stance'],
        [23,'2026-06-21 09:13:00',66.91,7.94,0.035,'Swing'],
        [23,'2026-06-21 09:13:30',67.49,7.54,0.103,'Swing'],
        [23,'2026-06-21 09:14:00',66.26,6.93,0.099,'Swing'],
        [23,'2026-06-21 09:14:30',59.18,5.35,0.097,'Swing'],
        [23,'2026-06-21 09:15:00',58.68,2.45,0.025,'Stance'],
        [23,'2026-06-21 09:15:30',52.73,2.37,0.043,'Stance'],
        [23,'2026-06-21 09:16:00',46.75,3.03,0.141,'Swing'],
        [23,'2026-06-21 09:16:30',39.7,2.73,0.006,'Stance'],
        [23,'2026-06-21 09:17:00',33.63,4.7,0.014,'Swing'],
        [23,'2026-06-21 09:17:30',35.53,6.98,0.143,'Swing'],
        [23,'2026-06-21 09:18:00',32.07,7.16,0.006,'Swing'],
        [23,'2026-06-21 09:18:30',29.8,9.14,0.137,'Stance'],
        [23,'2026-06-21 09:19:00',32.31,9.65,0.074,'Stance'],
        [23,'2026-06-21 09:19:30',32.76,8.99,0.101,'Swing'],
        [23,'2026-06-21 09:20:00',36.64,10.0,0.043,'Swing'],
        [23,'2026-06-21 09:20:30',46.4,9.18,0.068,'Stance'],
        [23,'2026-06-21 09:21:00',46.84,9.75,0.061,'Swing'],
        [23,'2026-06-21 09:21:30',58.78,7.85,0.081,'Stance'],
        [23,'2026-06-21 09:22:00',55.53,5.76,0.113,'Swing'],
        [23,'2026-06-21 09:22:30',65.07,3.91,0.082,'Swing'],
        [23,'2026-06-21 09:23:00',64.37,3.88,0.018,'Swing'],
        [23,'2026-06-21 09:23:30',67.08,0.92,0.024,'Swing'],
        [23,'2026-06-21 09:24:00',65.9,1.67,0.149,'Swing'],
        [23,'2026-06-21 09:24:30',62.84,3.28,0.125,'Stance'],
        [23,'2026-06-21 09:25:00',61.87,5.88,0.041,'Swing'],
        [23,'2026-06-21 09:25:30',59.94,6.33,0.083,'Stance'],
        [23,'2026-06-21 09:26:00',54.16,8.15,0.132,'Swing'],
        [23,'2026-06-21 09:26:30',42.33,9.75,0.062,'Swing'],
        [23,'2026-06-21 09:27:00',39.57,10.31,0.042,'Stance'],
        [23,'2026-06-21 09:27:30',36.06,11.0,0.073,'Stance'],
        [23,'2026-06-21 09:28:00',32.41,8.87,0.083,'Swing'],
        [23,'2026-06-21 09:28:30',29.84,8.32,0.028,'Swing'],
        [23,'2026-06-21 09:29:00',30.85,7.28,0.116,'Stance'],
        [23,'2026-06-21 09:29:30',34.02,7.66,0.122,'Stance']
      ];

      for (const r of readings) {
        await db.run(`
          INSERT INTO sensor_readings (session_id, ts, knee_angle, tilt_angle, tremor_rms, gait_phase)
          VALUES (?, ?, ?, ?, ?, ?)
        `, r);
      }

      const sampleAlerts = [
        [1,23,'2026-06-21 11:31:02','posture',47.58,61,'Swing','มุมต่ำกว่า baseline'],
        [1,23,'2026-06-21 16:06:33','fall',30.54,45,'Swing','Tilt เกิน 15 องศา'],
        [1,23,'2026-06-21 11:04:30','fall',41.85,64,'Swing','Tilt เกิน 15 องศา'],
        [1,22,'2026-06-20 10:50:36','posture',42.15,55,'Stance','มุมต่ำกว่า baseline'],
        [1,22,'2026-06-20 17:41:21','posture',59.74,69,'Stance','มุมต่ำกว่า baseline'],
        [1,22,'2026-06-20 14:40:57','fall',54.76,55,'Swing','Tilt เกิน 15 องศา'],
        [1,21,'2026-06-19 12:08:30','tremor',34.0,73,'Stance','ความถี่สั่น > 8Hz'],
        [1,21,'2026-06-19 13:49:23','posture',51.21,74,'Swing','มุมต่ำกว่า baseline'],
        [1,20,'2026-06-18 09:05:41','fall',34.75,56,'Stance','Tilt เกิน 15 องศา'],
        [1,20,'2026-06-18 15:20:13','fall',41.44,67,'Stance','Tilt เกิน 15 องศา']
      ];

      for (const a of sampleAlerts) {
        await db.run(`
          INSERT INTO alerts (patient_id, session_id, alert_time, alert_type, knee_angle, fall_risk, gait_phase, detail)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, a);
      }

      console.log('✅ Database seeded with sample data (1 patient, 23 sessions, 60 sensor readings, 10 alerts)');
    }

    return db;
  })();

  return dbPromise;
}

module.exports = { setupDB };
