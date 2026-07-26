/* ============================================================
   KneeSync AI — Public Dashboard Logic
   Fetches data from API and updates UI and Charts
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Configuration
    const API_URL = '/api'; // Use relative path since it's served from the same Express app
    const PATIENT_ID = 1;
    const POLL_INTERVAL = 5000; // 5 seconds
    
    // UI Elements
    const els = {
      statusBadge: document.getElementById('connectionStatus'),
      statusText: document.getElementById('statusText'),
      lastUpdated: document.getElementById('lastUpdated'),
      
      // Patient Info
      patientAvatar: document.getElementById('patientAvatar'),
      patientName: document.getElementById('patientName'),
      patientDetails: document.getElementById('patientDetails'),
      patientCondition: document.getElementById('patientCondition'),
      deviceId: document.getElementById('deviceId'),
      baselineAngle: document.getElementById('baselineAngle'),
      
      // Stats
      statGait: document.getElementById('statGait'),
      diffGait: document.getElementById('diffGait'),
      statRisk: document.getElementById('statRisk'),
      diffRisk: document.getElementById('diffRisk'),
      statSteps: document.getElementById('statSteps'),
      diffSteps: document.getElementById('diffSteps'),
      statAvgAngle: document.getElementById('statAvgAngle'),
      
      // Live Sensors
      liveAngle: document.getElementById('liveAngle'),
      liveTremor: document.getElementById('liveTremor'),
      gaitPhase: document.getElementById('gaitPhase'),
      
      // Device Info
      batteryFill: document.getElementById('batteryFill'),
      batteryText: document.getElementById('batteryText'),
      firmwareVer: document.getElementById('firmwareVer'),
      lastSync: document.getElementById('lastSync'),
      sessionDur: document.getElementById('sessionDur'),
      
      // Alerts
      alertList: document.getElementById('alertList'),
      alertCount: document.getElementById('alertCount')
    };
  
    // Chart instances
    let rtChart = null;
    let histChart = null;
  
    // Chart Colors
    const colors = {
      blue: '#3b82f6', blueBg: 'rgba(59, 130, 246, 0.1)',
      teal: '#10b981', tealBg: 'rgba(16, 185, 129, 0.1)',
      amber: '#f59e0b', amberBg: 'rgba(245, 158, 11, 0.1)',
      grid: 'rgba(255, 255, 255, 0.05)',
      tick: '#64748b'
    };
  
    const chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // Turn off animation for realtime updates to prevent lag
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11, weight: '600' } } },
        tooltip: { backgroundColor: 'rgba(17, 24, 39, 0.9)', padding: 12, cornerRadius: 8, titleColor: '#fff', bodyColor: '#cbd5e1' }
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.tick, font: { family: 'Inter', size: 10 } } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.tick, font: { family: 'Inter', size: 10 } } }
      }
    };
  
    // Initialize Charts
    function initCharts() {
      // Realtime Chart
      const rtCtx = document.getElementById('realtimeChart').getContext('2d');
      
      const gradientBlue = rtCtx.createLinearGradient(0, 0, 0, 300);
      gradientBlue.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
      gradientBlue.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
  
      rtChart = new Chart(rtCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Knee Angle (°)',
            data: [],
            borderColor: colors.blue,
            backgroundColor: gradientBlue,
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHitRadius: 10
          }]
        },
        options: {
          ...chartDefaults,
          scales: {
            ...chartDefaults.scales,
            y: { ...chartDefaults.scales.y, min: 0, max: 100 }
          }
        }
      });
  
      // History Chart
      const histCtx = document.getElementById('historyChart').getContext('2d');
      histChart = new Chart(histCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Gait Quality',
              data: [],
              borderColor: colors.teal,
              backgroundColor: colors.tealBg,
              borderWidth: 2.5,
              tension: 0.4,
              pointRadius: 3,
              pointBackgroundColor: colors.teal
            },
            {
              label: 'Fall Risk',
              data: [],
              borderColor: colors.amber,
              backgroundColor: colors.amberBg,
              borderWidth: 2.5,
              tension: 0.4,
              pointRadius: 3,
              pointBackgroundColor: colors.amber
            }
          ]
        },
        options: {
          ...chartDefaults,
          animation: true, // History chart can have animation
          scales: {
            ...chartDefaults.scales,
            y: { ...chartDefaults.scales.y, min: 0, max: 100 }
          }
        }
      });
    }
  
    // Update Connection Status
    function updateStatus(isOnline) {
      if (isOnline) {
        els.statusBadge.className = 'status-badge';
        els.statusText.textContent = 'Live Connected';
      } else {
        els.statusBadge.className = 'status-badge offline';
        els.statusText.textContent = 'Device Offline';
      }
      els.lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
    }
  
    // Fetch Patient Info
    async function fetchPatientInfo() {
      try {
        const res = await fetch(`${API_URL}/patient?patient_id=${PATIENT_ID}`);
        const data = await res.json();
        
        if (data.ok && data.patient) {
          const p = data.patient;
          const ls = data.latest_session;
          const ps = data.previous_session;
  
          // Header Info
          els.patientName.textContent = p.full_name;
          els.patientAvatar.textContent = p.full_name.charAt(0);
          els.patientDetails.textContent = `${p.age} Years · ${p.gender}`;
          els.patientCondition.textContent = p.condition_desc || 'No condition specified';
          els.deviceId.textContent = `Device: ${p.device_id || '--'}`;
          els.baselineAngle.textContent = `Baseline: ${p.baseline_angle}°`;
  
          // Session Stats
          if (ls) {
            els.statGait.textContent = ls.gait_score;
            els.statGait.className = `stat-value ${ls.gait_score >= 80 ? 'good' : (ls.gait_score >= 60 ? 'warn' : 'danger')}`;
            
            els.statRisk.textContent = ls.fall_risk;
            els.statRisk.className = `stat-value ${ls.fall_risk <= 40 ? 'good' : (ls.fall_risk <= 60 ? 'warn' : 'danger')}`;
            
            els.statSteps.textContent = ls.steps.toLocaleString();
            els.statAvgAngle.textContent = `${ls.avg_angle}°`;
            els.sessionDur.textContent = `${ls.duration_min} min`;
            
            // Diffs
            if (ps) {
              const gDiff = ls.gait_score - ps.gait_score;
              els.diffGait.textContent = gDiff >= 0 ? `▲ +${gDiff} vs yesterday` : `▼ ${gDiff} vs yesterday`;
              els.diffGait.className = `stat-diff ${gDiff >= 0 ? 'up' : 'down'}`;
  
              const rDiff = ps.fall_risk - ls.fall_risk;
              els.diffRisk.textContent = rDiff >= 0 ? `▼ -${rDiff} vs yesterday` : `▲ +${Math.abs(rDiff)} vs yesterday`;
              els.diffRisk.className = `stat-diff ${rDiff >= 0 ? 'up' : 'down'}`;
  
              const sDiff = ls.steps - ps.steps;
              els.diffSteps.textContent = sDiff >= 0 ? `▲ +${sDiff.toLocaleString()}` : `▼ ${sDiff.toLocaleString()}`;
              els.diffSteps.className = `stat-diff ${sDiff >= 0 ? 'up' : 'down'}`;
            }
          }
        }
      } catch (err) {
        console.error('Error fetching patient info:', err);
      }
    }
  
    // Fetch History Data
    async function fetchHistory() {
      try {
        const res = await fetch(`${API_URL}/history?patient_id=${PATIENT_ID}`);
        const data = await res.json();
        
        if (data.ok && data.data.length > 0) {
          // Take last 7 days for the chart
          const recent = data.data.slice(-7);
          
          histChart.data.labels = recent.map(s => {
            const d = new Date(s.session_date);
            return `${d.getDate()}/${d.getMonth()+1}`;
          });
          
          histChart.data.datasets[0].data = recent.map(s => s.gait_score);
          histChart.data.datasets[1].data = recent.map(s => s.fall_risk);
          histChart.update();
        }
      } catch (err) {
        console.error('Error fetching history:', err);
      }
    }
  
    // Fetch Alerts
    async function fetchAlerts() {
      try {
        const res = await fetch(`${API_URL}/alerts?patient_id=${PATIENT_ID}&limit=10`);
        const data = await res.json();
        
        if (data.ok) {
          els.alertCount.textContent = data.data.length;
          
          if (data.data.length === 0) {
            els.alertList.innerHTML = '<div class="empty-state">No recent alerts</div>';
            return;
          }
          
          els.alertList.innerHTML = data.data.map(a => {
            const tDate = new Date(a.alert_time);
            const timeStr = `${tDate.getDate()}/${tDate.getMonth()+1} ${tDate.getHours().toString().padStart(2,'0')}:${tDate.getMinutes().toString().padStart(2,'0')}`;
            
            return `
              <li class="alert-item">
                <div class="alert-dot ${a.alert_type}"></div>
                <div class="alert-content">
                  <div class="alert-type">${a.alert_type.toUpperCase()} · ${a.knee_angle}°</div>
                  <div class="alert-detail">${a.detail} · Risk: ${a.fall_risk}%<br>${timeStr}</div>
                </div>
              </li>
            `;
          }).join('');
        }
      } catch (err) {
        console.error('Error fetching alerts:', err);
      }
    }
  
    // Poll Realtime Data
    async function pollRealtime() {
      try {
        const res = await fetch(`${API_URL}/realtime?patient_id=${PATIENT_ID}`);
        const data = await res.json();
        
        if (data.ok && data.ts) {
          // Check if data is fresh (within last 60 seconds)
          const dataTime = new Date(data.ts + 'Z'); // Assuming DB is UTC, adjust if needed
          const now = new Date();
          const isFresh = true; // In demo, always treat as fresh for visual purposes. In real app: (now - dataTime) < 60000;
          
          updateStatus(isFresh);
          
          if (data.knee_angle !== null) {
            els.liveAngle.innerHTML = `${data.knee_angle.toFixed(1)}<span class="sensor-unit">°</span>`;
            els.liveTremor.innerHTML = `${data.tremor_rms.toFixed(3)}<span class="sensor-unit"> Hz</span>`;
            
            els.gaitPhase.textContent = data.gait_phase;
            els.gaitPhase.className = `gait-indicator ${data.gait_phase.toLowerCase()}`;
            
            // Battery
            if (data.battery_level !== null) {
              els.batteryFill.style.width = `${data.battery_level}%`;
              els.batteryText.textContent = `${data.battery_level}%`;
              if (data.battery_level < 20) els.batteryFill.className = 'battery-fill low';
              else if (data.battery_level < 50) els.batteryFill.className = 'battery-fill medium';
              else els.batteryFill.className = 'battery-fill';
            }
            
            if (data.firmware_version) {
              els.firmwareVer.textContent = data.firmware_version;
            }
            
            const timeObj = new Date(data.ts);
            els.lastSync.textContent = timeObj.toLocaleTimeString('en-US', {hour12:false});
  
            // Update Realtime Chart
            const label = timeObj.toLocaleTimeString('en-US', {hour12:false});
            rtChart.data.labels.push(label);
            rtChart.data.datasets[0].data.push(data.knee_angle);
            
            // Keep last 30 points
            if (rtChart.data.labels.length > 30) {
              rtChart.data.labels.shift();
              rtChart.data.datasets[0].data.shift();
            }
            rtChart.update('none'); // Update without animation
          }
        } else {
          updateStatus(false);
        }
      } catch (err) {
        console.error('Error polling realtime:', err);
        updateStatus(false);
      }
    }
  
    // Initialization
    initCharts();
    fetchPatientInfo();
    fetchHistory();
    fetchAlerts();
    
    // Start polling
    pollRealtime();
    setInterval(() => {
      pollRealtime();
      // Occasionally refresh other data
      if (Math.random() < 0.2) {
        fetchPatientInfo();
        fetchAlerts();
      }
    }, POLL_INTERVAL);
  });
