// ============================================================
//  KneeSync AI — Cloud API Server
//  Express.js + SQLite (async/await) — Production Ready
//  Deploy to Railway / Render / VPS
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { setupDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  Middleware
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Dependencies for Auth
const bcrypt = require('bcryptjs');

// ============================================================
//  API: Auth Routes
// ============================================================

// Register a new Admin/Doctor/Patient
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const existing = await db.get('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'Email already exists' });
    }
    
    const userRole = (role === 'doctor' || role === 'patient') ? role : 'patient';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.run(
      'INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)',
      [email, hashedPassword, full_name, userRole]
    );
    
    const userId = result.lastID;
    
    if (userRole === 'patient') {
      await db.run(
        'INSERT INTO patients (user_id, email, password, full_name) VALUES (?, ?, ?, ?)',
        [userId, email, hashedPassword, full_name]
      );
    }
    
    res.json({ ok: true, user_id: userId, role: userRole });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Missing credentials' });
    }
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    
    let patientId = null;
    if (user.role === 'patient') {
      const patient = await db.get('SELECT patient_id FROM patients WHERE user_id = ?', [user.user_id]);
      if (patient) {
        patientId = patient.patient_id;
      }
    }
    
    res.json({ ok: true, user: { user_id: user.user_id, email: user.email, full_name: user.full_name, role: user.role, patient_id: patientId } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get all patients (For Doctor Dashboard)
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await db.all(`
      SELECT p.patient_id, p.full_name, p.age, p.gender, p.condition_desc, p.device_id,
             (SELECT MAX(session_date) FROM sessions WHERE patient_id = p.patient_id) as last_session
      FROM patients p
      ORDER BY p.patient_id DESC
    `);
    res.json({ ok: true, data: patients });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: Admin Routes
// ============================================================

// Get all users
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await db.all('SELECT user_id, full_name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ ok: true, data: users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete user by ID
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'Invalid user ID' });
    }
    
    await db.run('DELETE FROM users WHERE user_id = ?', [userId]);
    // Note: Due to ON DELETE CASCADE on foreign keys, patients/sessions/readings/alerts will be deleted automatically.
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Initialize DB before starting server
let db;
setupDB().then(database => {
  db = database;
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   🦿 KneeSync AI — Cloud Server Running     ║');
    console.log(`  ║   📡 http://localhost:${PORT}                   ║`);
    console.log(`  ║   📡 API: http://localhost:${PORT}/api/realtime ║`);
    console.log('  ║   📊 Dashboard: Open URL in browser          ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
  });
}).catch(err => {
  console.error("Failed to initialize database", err);
  process.exit(1);
});

// ============================================================
//  API: POST /api/ingest — ESP32 ส่งข้อมูลเข้ามา
// ============================================================
app.post('/api/ingest', async (req, res) => {
  try {
    const input = req.body;

    const deviceId   = (input.device_id || '').trim();
    const kneeAngle  = input.knee_angle != null ? parseFloat(input.knee_angle) : null;
    const tiltAngle  = input.tilt_angle != null ? parseFloat(input.tilt_angle) : 0;
    const tremorRms  = input.tremor_rms != null ? parseFloat(input.tremor_rms) : 0;
    const gaitPhase  = input.gait_phase || 'Stance';
    const batteryLvl = input.battery_level != null ? parseFloat(input.battery_level) : null;
    const fwVersion  = input.firmware_version ? input.firmware_version.trim() : null;

    if (!deviceId || kneeAngle === null) {
      return res.json({ ok: false, error: 'device_id and knee_angle required' });
    }

    const patient = await db.get(
      'SELECT patient_id, full_name, baseline_angle FROM patients WHERE device_id = ?',
      [deviceId]
    );

    if (!patient) {
      return res.json({ ok: false, error: 'Device not registered' });
    }

    const patientId = patient.patient_id;
    const patientName = patient.full_name;
    const baselineAngle = patient.baseline_angle || 58.30;

    if (batteryLvl !== null || fwVersion !== null) {
      const updates = [];
      const params = [];
      if (batteryLvl !== null) { updates.push('battery_level = ?'); params.push(batteryLvl); }
      if (fwVersion !== null) { updates.push('firmware_version = ?'); params.push(fwVersion); }
      params.push(patientId);
      await db.run(`UPDATE patients SET ${updates.join(', ')} WHERE patient_id = ?`, params);
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    let session = await db.get(
      'SELECT session_id, steps, alert_count FROM sessions WHERE patient_id = ? AND session_date = ? ORDER BY session_id DESC LIMIT 1',
      [patientId, today]
    );

    let sessionId, stepCount, alertCount;

    if (!session) {
      const ins = await db.run(
        'INSERT INTO sessions (patient_id, session_date, steps, avg_angle, max_angle, min_angle, gait_score, fall_risk, symmetry, duration_min, alert_count) VALUES (?, ?, 0, ?, ?, ?, 0, 0, 0, 0, 0)',
        [patientId, today, kneeAngle, kneeAngle, kneeAngle]
      );
      sessionId = ins.lastID;
      stepCount = 0;
      alertCount = 0;
    } else {
      sessionId = session.session_id;
      stepCount = session.steps;
      alertCount = session.alert_count;
    }

    const readingResult = await db.run(
      'INSERT INTO sensor_readings (session_id, ts, knee_angle, tilt_angle, tremor_rms, gait_phase) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, now, kneeAngle, tiltAngle, tremorRms, gaitPhase]
    );

    if (gaitPhase === 'Stance') {
      const prev = await db.get(
        'SELECT gait_phase FROM sensor_readings WHERE session_id = ? AND reading_id < ? ORDER BY reading_id DESC LIMIT 1',
        [sessionId, readingResult.lastID]
      );
      if (prev && prev.gait_phase === 'Swing') {
        stepCount++;
      }
    }

    const stats = await db.get(
      'SELECT AVG(knee_angle) as avg_a, MAX(knee_angle) as max_a, MIN(knee_angle) as min_a, COUNT(*) as cnt FROM sensor_readings WHERE session_id = ?',
      [sessionId]
    );

    const avgAngle = Math.round(stats.avg_a * 100) / 100;
    const maxAngle = Math.round(stats.max_a * 100) / 100;
    const minAngle = Math.round(stats.min_a * 100) / 100;
    const readingCount = stats.cnt;

    const gaitScore = Math.min(100, Math.max(0, Math.round(
      (avgAngle / Math.max(baselineAngle, 1)) * 50
      + (1 - Math.min(Math.abs(tiltAngle) / 15, 1)) * 25
      + (1 - Math.min(tremorRms / 0.2, 1)) * 25
    )));

    const fallRisk = Math.min(100, Math.max(0, Math.round(
      Math.min(Math.abs(tiltAngle) / 12, 1) * 40
      + (1 - avgAngle / Math.max(baselineAngle, 1)) * 30
      + Math.min(tremorRms / 0.15, 1) * 30
    )));

    const symmetry = Math.min(100, Math.max(0, Math.round(100 - Math.abs(tiltAngle) * 3)));
    const durationMin = Math.max(1, Math.round(readingCount * 0.5));

    let alertType = null;
    let alertDetail = null;

    if (tiltAngle > 15 || tiltAngle < -15) {
      alertType = 'fall';
      alertDetail = 'Tilt เกิน 15 องศา';
    } else if (kneeAngle < baselineAngle * 0.7) {
      alertType = 'posture';
      alertDetail = 'มุมต่ำกว่า baseline';
    } else if (tremorRms > 0.12) {
      alertType = 'tremor';
      alertDetail = 'ความถี่สั่น > 8Hz';
    }

    if (alertType) {
      alertCount++;
      await db.run(
        'INSERT INTO alerts (patient_id, session_id, alert_time, alert_type, knee_angle, fall_risk, gait_phase, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [patientId, sessionId, now, alertType, kneeAngle, fallRisk, gaitPhase, alertDetail]
      );
    }

    await db.run(
      `UPDATE sessions SET
        steps = ?, avg_angle = ?, max_angle = ?, min_angle = ?,
        gait_score = ?, fall_risk = ?, symmetry = ?,
        duration_min = ?, alert_count = ?
      WHERE session_id = ?`,
      [stepCount, avgAngle, maxAngle, minAngle, gaitScore, fallRisk, symmetry, durationMin, alertCount, sessionId]
    );

    res.json({
      ok: true,
      session_id: sessionId,
      knee_angle: kneeAngle,
      gait_score: gaitScore,
      fall_risk: fallRisk,
      steps: stepCount,
      alert: alertType,
      ts: now
    });

  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: GET /api/realtime — ค่าเซนเซอร์ล่าสุด
// ============================================================
app.get('/api/realtime', async (req, res) => {
  try {
    const pid = parseInt(req.query.patient_id) || 1;

    const reading = await db.get(`
      SELECT sr.ts, sr.knee_angle, sr.tilt_angle, sr.tremor_rms, sr.gait_phase
      FROM sensor_readings sr
      INNER JOIN sessions s ON s.session_id = sr.session_id
      WHERE s.patient_id = ?
      ORDER BY sr.ts DESC LIMIT 1
    `, [pid]);

    if (!reading) {
      return res.json({ ok: true, knee_angle: null, ts: null });
    }

    const patientInfo = await db.get(
      'SELECT battery_level, firmware_version FROM patients WHERE patient_id = ?',
      [pid]
    );

    res.json({
      ok: true,
      knee_angle: reading.knee_angle,
      tilt_angle: reading.tilt_angle,
      tremor_rms: reading.tremor_rms,
      gait_phase: reading.gait_phase,
      ts: reading.ts,
      battery_level: patientInfo?.battery_level ?? null,
      firmware_version: patientInfo?.firmware_version ?? null
    });
  } catch (err) {
    console.error('Realtime error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: GET /api/readings — ค่าเซนเซอร์ทั้งหมดของ session ล่าสุด
// ============================================================
app.get('/api/readings', async (req, res) => {
  try {
    const pid = parseInt(req.query.patient_id) || 1;

    const session = await db.get(
      'SELECT session_id FROM sessions WHERE patient_id = ? ORDER BY session_date DESC LIMIT 1',
      [pid]
    );

    if (!session) {
      return res.json({ ok: true, data: [] });
    }

    const readings = await db.all(
      'SELECT ts, knee_angle, tilt_angle, tremor_rms, gait_phase FROM sensor_readings WHERE session_id = ? ORDER BY ts ASC',
      [session.session_id]
    );

    res.json({ ok: true, data: readings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: GET /api/history — ประวัติ session ทั้งหมด
// ============================================================
app.get('/api/history', async (req, res) => {
  try {
    const pid = parseInt(req.query.patient_id) || 1;

    const history = await db.all(
      `SELECT session_date, steps, avg_angle, gait_score, fall_risk, symmetry, alert_count, duration_min, max_angle, min_angle
       FROM sessions WHERE patient_id = ? ORDER BY session_date ASC`,
      [pid]
    );

    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: GET /api/alerts — การแจ้งเตือนล่าสุด
// ============================================================
app.get('/api/alerts', async (req, res) => {
  try {
    const pid = parseInt(req.query.patient_id) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const alerts = await db.all(
      `SELECT alert_time, alert_type, knee_angle, fall_risk, gait_phase, detail
       FROM alerts WHERE patient_id = ? ORDER BY alert_time DESC LIMIT ?`,
      [pid, limit]
    );

    res.json({ ok: true, data: alerts });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: GET /api/patient — ข้อมูลผู้ป่วย
// ============================================================
app.get('/api/patient', async (req, res) => {
  try {
    const pid = parseInt(req.query.patient_id) || 1;

    const patient = await db.get('SELECT * FROM patients WHERE patient_id = ?', [pid]);
    if (!patient) {
      return res.json({ ok: false, error: 'Patient not found' });
    }

    const latest = await db.get(
      'SELECT * FROM sessions WHERE patient_id = ? ORDER BY session_date DESC LIMIT 1',
      [pid]
    );

    const previous = await db.get(
      'SELECT * FROM sessions WHERE patient_id = ? ORDER BY session_date DESC LIMIT 1 OFFSET 1',
      [pid]
    );

    res.json({
      ok: true,
      patient,
      latest_session: latest || null,
      previous_session: previous || null
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: GET /api/stats — สถิติภาพรวม
// ============================================================
app.get('/api/stats', async (req, res) => {
  try {
    const pid = parseInt(req.query.patient_id) || 1;

    const stats = await db.get(`
      SELECT
        COUNT(*) AS total_sessions,
        COALESCE(SUM(steps), 0) AS total_steps,
        ROUND(AVG(avg_angle), 2) AS overall_avg_angle,
        ROUND(AVG(gait_score), 1) AS avg_gait_score,
        ROUND(AVG(fall_risk), 1) AS avg_fall_risk,
        MAX(gait_score) AS best_gait_score,
        MIN(fall_risk) AS best_fall_risk,
        MAX(max_angle) AS best_max_angle,
        MIN(session_date) AS first_session_date,
        MAX(session_date) AS last_session_date,
        ROUND(AVG(symmetry), 1) AS avg_symmetry,
        SUM(duration_min) AS total_duration_min,
        SUM(alert_count) AS total_alerts
      FROM sessions WHERE patient_id = ?
    `, [pid]);

    res.json({ ok: true, data: stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  Fallback: SPA routing
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
