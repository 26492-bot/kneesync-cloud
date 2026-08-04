// ============================================================
//  KneeSync AI — Cloud API Server
//  Express.js + SQLite (async/await) — Production Ready
//  Deploy to Railway / Render / VPS
//
//  ALGORITHM: Personalized Adaptive Algorithm
//  - Per-patient baseline calibration (10-step Mean − 1.5SD)
//  - Adaptive weighted scoring based on patient history
//  - NOT a trained ML/DL model — rule-based with personalization
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
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

const authGuard = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden: Admin only' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
};

// ============================================================
//  LINE Messaging API — Fall Alert Notification
// ============================================================
async function sendLineFallAlert(patientName, kneeAngle, fallRisk, alertTime) {
  const lineToken = process.env.LINE_TOKEN;
  const lineUserId = process.env.LINE_USER_ID;

  if (!lineToken || !lineUserId) {
    console.log('⚠️  LINE credentials not configured — skipping fall alert notification');
    return false;
  }

  const message = `🚨 แจ้งเตือนความเสี่ยงหกล้ม\n`
    + `━━━━━━━━━━━━━━━━\n`
    + `👤 ชื่อผู้ป่วย: ${patientName}\n`
    + `📐 มุมข้อเข่า: ${kneeAngle}°\n`
    + `⚠️ ระดับความเสี่ยง: ${fallRisk}%\n`
    + `🕐 วันเวลา: ${alertTime}\n`
    + `━━━━━━━━━━━━━━━━\n`
    + `กรุณาตรวจสอบผู้ป่วยโดยด่วน`;

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineToken}`
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: message }]
      })
    });

    if (response.ok) {
      console.log(`📱 LINE alert sent for patient: ${patientName} (Fall Risk: ${fallRisk}%)`);
      return true;
    } else {
      const errBody = await response.text();
      console.error(`❌ LINE API error (${response.status}):`, errBody);
      return false;
    }
  } catch (err) {
    console.error('❌ LINE notification failed:', err.message);
    return false;
  }
}

// ============================================================
//  Gemini AI — Clinical Insight Generator
// ============================================================
async function generateAIInsight(db, sessionId, patientName, sessionData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null; // Silently skip if no API key
  }

  try {
    const prompt = `คุณเป็นนักกายภาพบำบัดผู้เชี่ยวชาญ วิเคราะห์ข้อมูลการฟื้นฟูข้อเข่าของผู้ป่วย "${patientName}" แล้วให้คำแนะนำสั้น ๆ (2-3 ประโยค):
- Gait Score: ${sessionData.gait_score}/100
- Fall Risk: ${sessionData.fall_risk}%
- ก้าวเดิน: ${sessionData.steps} ก้าว
- มุมเฉลี่ย: ${sessionData.avg_angle}°
- Symmetry: ${sessionData.symmetry}%
- จำนวน Alert: ${sessionData.alert_count}
ให้คำแนะนำเป็นภาษาไทยสั้นกระชับ เน้นสิ่งที่ควรระวังและสิ่งที่ดีขึ้น`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 256, temperature: 0.7 }
        })
      }
    );

    if (!response.ok) {
      console.error(`❌ Gemini API error (${response.status})`);
      return null;
    }

    const result = await response.json();
    const insight = result.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (insight) {
      await db.run('UPDATE sessions SET ai_insight = ? WHERE session_id = ?', [insight, sessionId]);
      console.log(`🤖 AI Insight generated for session ${sessionId}`);
    }

    return insight;
  } catch (err) {
    console.error('❌ Gemini AI insight failed:', err.message);
    return null;
  }
}

// ============================================================
//  Baseline Calibration — 10-Step Mean − 1.5SD
// ============================================================
async function calibrateBaseline(db, patientId, kneeAngle) {
  const patient = await db.get(
    'SELECT baseline_status, baseline_samples FROM patients WHERE patient_id = ?',
    [patientId]
  );

  if (!patient || patient.baseline_status === 'calibrated') {
    return; // Already calibrated or patient not found
  }

  // Record this step for calibration
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await db.run(
    'INSERT INTO baseline_steps (patient_id, knee_angle, recorded_at) VALUES (?, ?, ?)',
    [patientId, kneeAngle, now]
  );

  const newCount = (patient.baseline_samples || 0) + 1;

  // Update status to calibrating
  if (patient.baseline_status === 'pending') {
    await db.run(
      "UPDATE patients SET baseline_status = 'calibrating', baseline_samples = ? WHERE patient_id = ?",
      [newCount, patientId]
    );
  } else {
    await db.run(
      'UPDATE patients SET baseline_samples = ? WHERE patient_id = ?',
      [newCount, patientId]
    );
  }

  // Check if we have enough samples (10 steps)
  if (newCount >= 10) {
    const steps = await db.all(
      'SELECT knee_angle FROM baseline_steps WHERE patient_id = ? ORDER BY step_id ASC LIMIT 10',
      [patientId]
    );

    if (steps.length >= 10) {
      const angles = steps.map(s => s.knee_angle);

      // Calculate Mean
      const mean = angles.reduce((sum, a) => sum + a, 0) / angles.length;

      // Calculate Standard Deviation
      const squaredDiffs = angles.map(a => Math.pow(a - mean, 2));
      const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / angles.length;
      const sd = Math.sqrt(variance);

      // Baseline = Mean − 1.5 × SD (lower bound threshold)
      const baselineAngle = Math.round((mean - 1.5 * sd) * 100) / 100;

      await db.run(
        `UPDATE patients SET
          baseline_angle = ?,
          baseline_mean = ?,
          baseline_sd = ?,
          baseline_status = 'calibrated',
          baseline_samples = 10
        WHERE patient_id = ?`,
        [baselineAngle, Math.round(mean * 100) / 100, Math.round(sd * 100) / 100, patientId]
      );

      console.log(`✅ Baseline calibrated for patient ${patientId}: Mean=${mean.toFixed(2)}°, SD=${sd.toFixed(2)}°, Baseline=${baselineAngle}°`);
    }
  }
}

// ============================================================
//  Adaptive Weighted Scoring
//  ALGORITHM: Personalized Adaptive Algorithm
//  Weights adjust based on patient's historical patterns
//  NOT a trained ML model — rule-based with personalization
// ============================================================
function computeAdaptiveScores(avgAngle, tiltAngle, tremorRms, baselineAngle, patient) {
  const bl = Math.max(baselineAngle || 58.30, 1);

  // Retrieve running averages for adaptive weighting
  const readingCount = patient.reading_count || 0;
  const runAvgTilt = patient.running_avg_tilt || 0;
  const runAvgTremor = patient.running_avg_tremor || 0;

  // --- Adaptive Weight Calculation ---
  // If patient historically has high tremor, reduce tremor weight (it's their norm)
  // If patient historically has low tilt, increase tilt sensitivity
  let wAngle = 50, wTilt = 25, wTremor = 25;

  if (readingCount > 20) {
    // Adapt weights based on patient variance
    // High historical tremor → reduce tremor weight, increase angle weight
    if (runAvgTremor > 0.08) {
      wTremor = 15;
      wAngle = 55;
      wTilt = 30;
    }
    // Low historical tilt → patient is stable, increase tilt sensitivity
    if (runAvgTilt < 3) {
      wTilt = 30;
      wAngle = 50;
      wTremor = 20;
    }
  }

  // --- Gait Score (0-100): higher = better ---
  const gaitScore = Math.min(100, Math.max(0, Math.round(
    (avgAngle / bl) * wAngle
    + (1 - Math.min(Math.abs(tiltAngle) / 15, 1)) * wTilt
    + (1 - Math.min(tremorRms / 0.2, 1)) * wTremor
  )));

  // --- Fall Risk (0-100): higher = more dangerous ---
  const fallRisk = Math.min(100, Math.max(0, Math.round(
    Math.min(Math.abs(tiltAngle) / 12, 1) * (100 - wAngle)
    + (1 - avgAngle / bl) * (wAngle * 0.6)
    + Math.min(tremorRms / 0.15, 1) * (wTremor + 5)
  )));

  // --- Symmetry (0-100) ---
  const symmetry = Math.min(100, Math.max(0, Math.round(100 - Math.abs(tiltAngle) * 3)));

  return { gaitScore, fallRisk, symmetry };
}

// Update running averages for a patient (exponential moving average)
async function updateRunningAverages(db, patientId, tiltAngle, tremorRms, kneeAngle) {
  const patient = await db.get(
    'SELECT running_avg_tilt, running_avg_tremor, running_avg_angle, reading_count FROM patients WHERE patient_id = ?',
    [patientId]
  );

  if (!patient) return;

  const count = (patient.reading_count || 0) + 1;
  const alpha = Math.min(0.1, 1 / count); // Smoothing factor

  const newAvgTilt = patient.running_avg_tilt * (1 - alpha) + Math.abs(tiltAngle) * alpha;
  const newAvgTremor = patient.running_avg_tremor * (1 - alpha) + tremorRms * alpha;
  const newAvgAngle = patient.running_avg_angle * (1 - alpha) + kneeAngle * alpha;

  await db.run(
    `UPDATE patients SET
      running_avg_tilt = ?,
      running_avg_tremor = ?,
      running_avg_angle = ?,
      reading_count = ?
    WHERE patient_id = ?`,
    [
      Math.round(newAvgTilt * 10000) / 10000,
      Math.round(newAvgTremor * 10000) / 10000,
      Math.round(newAvgAngle * 100) / 100,
      count,
      patientId
    ]
  );
}

// ============================================================
//  API: Auth Routes
// ============================================================

// Register — ONLY patient role allowed (doctors must be promoted by admin)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name, device_id } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const existing = await db.get('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'Email already exists' });
    }
    
    // SECURITY: Always assign 'patient' role on self-registration
    // Doctors/Admins must be promoted by an existing admin
    const userRole = 'patient';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.run(
      'INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)',
      [email, hashedPassword, full_name, userRole]
    );
    
    const userId = result.lastID;
    
    await db.run(
      'INSERT INTO patients (user_id, email, password, full_name, device_id) VALUES (?, ?, ?, ?, ?)',
      [userId, email, hashedPassword, full_name, device_id || null]
    );
    
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
    
    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, patient_id: patientId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ ok: true, user: { user_id: user.user_id, email: user.email, full_name: user.full_name, role: user.role, patient_id: patientId }, token });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get all patients (For Doctor Dashboard)
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await db.all(`
      SELECT p.patient_id, p.full_name, p.age, p.gender, p.condition_desc, p.device_id,
             p.baseline_status, p.baseline_samples,
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

// Get all users (now includes patient device_id if they are a patient)
app.get('/api/admin/users', authGuard, async (req, res) => {
  try {
    const users = await db.all(`
      SELECT u.user_id, u.full_name, u.email, u.role, u.created_at, p.device_id
      FROM users u
      LEFT JOIN patients p ON u.user_id = p.user_id
      ORDER BY u.created_at DESC
    `);
    res.json({ ok: true, data: users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Add new user (Admin only)
app.post('/api/admin/users', authGuard, async (req, res) => {
  try {
    const { email, password, full_name, role, device_id } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const existing = await db.get('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'Email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)',
      [email, hashedPassword, full_name, role]
    );
    const userId = result.lastID;
    if (role === 'patient') {
      await db.run(
        'INSERT INTO patients (user_id, email, password, full_name, device_id) VALUES (?, ?, ?, ?, ?)',
        [userId, email, hashedPassword, full_name, device_id || null]
      );
    }
    res.json({ ok: true, user_id: userId, role });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Edit user (Admin only)
app.put('/api/admin/users/:id', authGuard, async (req, res) => {
  try {
    const userId = req.params.id;
    const { email, full_name, role, device_id } = req.body;
    if (!email || !full_name || !role) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const existing = await db.get('SELECT user_id FROM users WHERE email = ? AND user_id != ?', [email, userId]);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'Email already in use by another user' });
    }
    const current = await db.get('SELECT role FROM users WHERE user_id = ?', [userId]);
    if (!current) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    
    // Update users table
    await db.run('UPDATE users SET full_name = ?, email = ?, role = ? WHERE user_id = ?', [full_name, email, role, userId]);
    
    // Handle role changes related to patients table
    if (role === 'patient' && current.role !== 'patient') {
      // Was not patient, now is patient
      const user = await db.get('SELECT password FROM users WHERE user_id = ?', [userId]);
      await db.run(
        'INSERT INTO patients (user_id, email, password, full_name, device_id) VALUES (?, ?, ?, ?, ?)',
        [userId, email, user.password, full_name, device_id || null]
      );
    } else if (role !== 'patient' && current.role === 'patient') {
      // Was patient, now is not patient
      await db.run('DELETE FROM patients WHERE user_id = ?', [userId]);
    } else if (role === 'patient' && current.role === 'patient') {
      // Update existing patient data
      await db.run('UPDATE patients SET full_name = ?, email = ?, device_id = ? WHERE user_id = ?', [full_name, email, device_id || null, userId]);
    }
    
    res.json({ ok: true, message: 'User updated' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Check all registered devices (Admin only)
app.get('/api/admin/devices', authGuard, async (req, res) => {
  try {
    const devices = await db.all(`
      SELECT patient_id, full_name, device_id, baseline_status, battery_level, firmware_version 
      FROM patients 
      WHERE device_id IS NOT NULL 
      ORDER BY patient_id DESC
    `);
    res.json({ ok: true, data: devices });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Promote user role (Admin only)
app.post('/api/admin/promote', authGuard, async (req, res) => {
  try {
    const { user_id, new_role, admin_email, admin_password } = req.body;
    
    if (!user_id || !new_role || !admin_email || !admin_password) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    
    // Verify admin credentials
    const admin = await db.get('SELECT * FROM users WHERE email = ? AND role = ?', [admin_email, 'admin']);
    if (!admin) {
      return res.status(403).json({ ok: false, error: 'Admin not found' });
    }
    const isValidAdmin = await bcrypt.compare(admin_password, admin.password);
    if (!isValidAdmin) {
      return res.status(403).json({ ok: false, error: 'Invalid admin credentials' });
    }
    
    // Only allow valid roles
    const validRoles = ['patient', 'doctor', 'admin'];
    if (!validRoles.includes(new_role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role' });
    }
    
    await db.run('UPDATE users SET role = ? WHERE user_id = ?', [new_role, user_id]);
    
    res.json({ ok: true, message: `User ${user_id} promoted to ${new_role}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete user by ID
app.delete('/api/admin/users/:id', authGuard, async (req, res) => {
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

// Force recalibration for a patient (Admin only)
app.post('/api/patient/:id/recalibrate', authGuard, async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: 'Invalid patient ID' });
    }
    
    // Clear baseline data
    await db.run(
      `UPDATE patients SET 
        baseline_status = 'pending',
        baseline_samples = 0,
        baseline_mean = NULL,
        baseline_sd = NULL,
        baseline_angle = NULL
      WHERE patient_id = ?`,
      [patientId]
    );
    
    // Delete existing baseline steps
    await db.run('DELETE FROM baseline_steps WHERE patient_id = ?', [patientId]);
    
    res.json({ ok: true, message: 'Patient reset to pending calibration' });
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
    if (!process.env.LINE_TOKEN) {
      console.log('  ⚠️  LINE_TOKEN not set — LINE fall alerts disabled');
    }
    if (!process.env.GEMINI_API_KEY) {
      console.log('  ⚠️  GEMINI_API_KEY not set — AI Clinical Insight disabled');
    }
    console.log('');
  });
}).catch(err => {
  console.error("Failed to initialize database", err);
  process.exit(1);
});

// ============================================================
//  API: POST /api/ingest — ESP32 ส่งข้อมูลเข้ามา
//  ALGORITHM: Personalized Adaptive Algorithm
//  - Auto-calibrates baseline from first 10 steps per patient
//  - Adaptive scoring weights based on patient history
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
      `SELECT patient_id, full_name, baseline_angle, baseline_status,
              running_avg_tilt, running_avg_tremor, running_avg_angle, reading_count
       FROM patients WHERE device_id = ?`,
      [deviceId]
    );

    if (!patient) {
      return res.json({ ok: false, error: 'Device not registered' });
    }

    const patientId = patient.patient_id;
    const patientName = patient.full_name;
    
    // Use calibrated baseline or fallback to 58.30 during calibration
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

    // Step counting: Swing → Stance transition = 1 step
    let isNewStep = false;
    if (gaitPhase === 'Stance') {
      const prev = await db.get(
        'SELECT gait_phase FROM sensor_readings WHERE session_id = ? AND reading_id < ? ORDER BY reading_id DESC LIMIT 1',
        [sessionId, readingResult.lastID]
      );
      if (prev && prev.gait_phase === 'Swing') {
        stepCount++;
        isNewStep = true;
      }
    }

    // Baseline calibration: collect data from first 10 steps
    if (patient.baseline_status !== 'calibrated' && isNewStep) {
      await calibrateBaseline(db, patientId, kneeAngle);
    }

    // Update running averages for adaptive scoring
    await updateRunningAverages(db, patientId, tiltAngle, tremorRms, kneeAngle);

    // Re-fetch patient for updated running averages
    const updatedPatient = await db.get(
      'SELECT running_avg_tilt, running_avg_tremor, running_avg_angle, reading_count FROM patients WHERE patient_id = ?',
      [patientId]
    );

    const stats = await db.get(
      'SELECT AVG(knee_angle) as avg_a, MAX(knee_angle) as max_a, MIN(knee_angle) as min_a, COUNT(*) as cnt FROM sensor_readings WHERE session_id = ?',
      [sessionId]
    );

    const avgAngle = Math.round(stats.avg_a * 100) / 100;
    const maxAngle = Math.round(stats.max_a * 100) / 100;
    const minAngle = Math.round(stats.min_a * 100) / 100;
    const readingCount = stats.cnt;

    // Adaptive scoring using patient-specific weights
    const { gaitScore, fallRisk, symmetry } = computeAdaptiveScores(
      avgAngle, tiltAngle, tremorRms, baselineAngle, updatedPatient || patient
    );

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

      // Send LINE alert when Fall Risk > 70%
      if (fallRisk > 70) {
        sendLineFallAlert(
          patientName,
          kneeAngle,
          fallRisk,
          new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
        );
      }
    }

    await db.run(
      `UPDATE sessions SET
        steps = ?, avg_angle = ?, max_angle = ?, min_angle = ?,
        gait_score = ?, fall_risk = ?, symmetry = ?,
        duration_min = ?, alert_count = ?
      WHERE session_id = ?`,
      [stepCount, avgAngle, maxAngle, minAngle, gaitScore, fallRisk, symmetry, durationMin, alertCount, sessionId]
    );

    // Generate AI insight periodically (every 50 readings)
    if (readingCount % 50 === 0 && readingCount > 0) {
      generateAIInsight(db, sessionId, patientName, {
        gait_score: gaitScore, fall_risk: fallRisk, steps: stepCount,
        avg_angle: avgAngle, symmetry, alert_count: alertCount
      });
    }

    res.json({
      ok: true,
      session_id: sessionId,
      knee_angle: kneeAngle,
      gait_score: gaitScore,
      fall_risk: fallRisk,
      steps: stepCount,
      alert: alertType,
      baseline_status: patient.baseline_status,
      ts: now
    });

  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  API: POST /api/patient/:id/recalibrate — Reset Baseline
// ============================================================
app.post('/api/patient/:id/recalibrate', async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: 'Invalid patient ID' });
    }

    // Reset baseline data
    await db.run(
      `UPDATE patients SET
        baseline_angle = NULL,
        baseline_status = 'pending',
        baseline_samples = 0,
        baseline_mean = NULL,
        baseline_sd = NULL
      WHERE patient_id = ?`,
      [patientId]
    );

    // Clear old calibration steps
    await db.run('DELETE FROM baseline_steps WHERE patient_id = ?', [patientId]);

    res.json({ ok: true, message: 'Baseline reset — will recalibrate from next 10 steps' });
  } catch (err) {
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
      `SELECT session_date, steps, avg_angle, gait_score, fall_risk, symmetry, alert_count, duration_min, max_angle, min_angle, ai_insight
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
//  API: GET /api/session/:id/insight — AI Clinical Insight
// ============================================================
app.get('/api/session/:id/insight', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Invalid session ID' });
    }

    const session = await db.get(
      'SELECT ai_insight, gait_score, fall_risk, steps, avg_angle, symmetry, alert_count FROM sessions WHERE session_id = ?',
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    // If no insight yet, try generating one
    if (!session.ai_insight && process.env.GEMINI_API_KEY) {
      const patient = await db.get(
        'SELECT p.full_name FROM patients p INNER JOIN sessions s ON s.patient_id = p.patient_id WHERE s.session_id = ?',
        [sessionId]
      );
      if (patient) {
        const insight = await generateAIInsight(db, sessionId, patient.full_name, session);
        session.ai_insight = insight;
      }
    }

    res.json({ ok: true, insight: session.ai_insight || null });
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
