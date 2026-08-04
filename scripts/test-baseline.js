// Use built-in fetch in Node 18+
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../kneesync.db');
const API_URL = 'http://localhost:3000/api/ingest';

async function runTest() {
  console.log('🧪 Starting Baseline Calibration Test...');

  const db = new sqlite3.Database(DB_PATH);

  // 1. Create a dummy patient
  const deviceId = 'TEST_DEVICE_001';
  
  await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO patients (full_name, device_id, baseline_status, baseline_samples)
      VALUES ('Test Patient', ?, 'pending', 0)
    `, [deviceId], function(err) {
      if (err) {
        // If device already registered, just reset it
        db.run(`
          UPDATE patients SET baseline_status = 'pending', baseline_samples = 0, baseline_mean = NULL, baseline_sd = NULL, baseline_angle = NULL
          WHERE device_id = ?
        `, [deviceId], resolve);
      } else {
        resolve();
      }
    });
  });

  console.log(`✅ Test Patient ready with device_id: ${deviceId}`);

  // 2. Simulate 12 steps (angles around 55-60)
  const angles = [58.2, 59.1, 57.5, 60.0, 58.8, 59.5, 57.8, 58.0, 59.2, 58.5, 60.1, 59.9];

  for (let i = 0; i < angles.length; i++) {
    // Send Swing first to trigger transition
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        knee_angle: angles[i] - 5,
        tilt_angle: 2.1,
        tremor_rms: 0.05,
        gait_phase: 'Swing'
      })
    });
    
    const payload = {
      device_id: deviceId,
      knee_angle: angles[i],
      tilt_angle: 2.1,
      tremor_rms: 0.05,
      gait_phase: 'Stance'
    };

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      console.log(`Step ${i + 1}: Sent angle ${angles[i]}° => API Response: ${JSON.stringify(data)}`);
    } catch (e) {
      console.error(`Failed to send step ${i + 1}:`, e.message);
    }
    
    // Check DB status
    await new Promise(resolve => {
      db.get('SELECT baseline_status, baseline_samples, baseline_mean, baseline_sd, baseline_angle FROM patients WHERE device_id = ?', [deviceId], (err, row) => {
        if (row) {
          console.log(`   DB State -> Status: ${row.baseline_status}, Samples: ${row.baseline_samples}`);
          if (row.baseline_status === 'calibrated') {
            console.log(`   🎉 CALIBRATED! Mean: ${row.baseline_mean}, SD: ${row.baseline_sd}, Baseline Angle: ${row.baseline_angle}`);
          }
        }
        resolve();
      });
    });
    
    // Wait a bit between steps
    await new Promise(r => setTimeout(r, 200));
  }
  
  db.close();
  console.log('🏁 Test completed.');
}

runTest();
