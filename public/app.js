/* ============================================================
   KneeSync AI — Public Dashboard Logic (Auth & Live Data)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Configuration
    const API_URL = '/api'; 
    let PATIENT_ID = 1; // Defaulting to 1 for demo purposes, but data is dynamic.
    const POLL_INTERVAL = 5000; // 5 seconds
    let pollingTimer = null;
    
    // Auth State
    let currentUser = JSON.parse(localStorage.getItem('kneesync_user') || 'null');
    
    // UI Elements - Login
    const loginView = document.getElementById('loginView');
    const dashboardView = document.getElementById('dashboardView');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');
    const btnLogout = document.getElementById('btnLogout');
    
    // UI Elements - Dashboard
    const els = {
      statusBadge: document.getElementById('connectionStatus'),
      statusText: document.getElementById('statusText'),
      lastUpdated: document.getElementById('lastUpdated'),
      chartLiveBadge: document.getElementById('chartLiveBadge'),
      
      patientAvatar: document.getElementById('patientAvatar'),
      patientName: document.getElementById('patientName'),
      patientDetails: document.getElementById('patientDetails'),
      patientCondition: document.getElementById('patientCondition'),
      deviceId: document.getElementById('deviceId'),
      baselineAngle: document.getElementById('baselineAngle'),
      
      statGait: document.getElementById('statGait'),
      diffGait: document.getElementById('diffGait'),
      statRisk: document.getElementById('statRisk'),
      diffRisk: document.getElementById('diffRisk'),
      statSteps: document.getElementById('statSteps'),
      diffSteps: document.getElementById('diffSteps'),
      statAvgAngle: document.getElementById('statAvgAngle'),
      
      liveAngle: document.getElementById('liveAngle'),
      liveTremor: document.getElementById('liveTremor'),
      gaitPhase: document.getElementById('gaitPhase'),
      
      batteryFill: document.getElementById('batteryFill'),
      batteryText: document.getElementById('batteryText'),
      firmwareVer: document.getElementById('firmwareVer'),
      lastSync: document.getElementById('lastSync'),
      sessionDur: document.getElementById('sessionDur'),
      
      alertList: document.getElementById('alertList'),
      alertCount: document.getElementById('alertCount')
    };
  
    // Chart instances
    let rtChart = null;
    let histChart = null;
  
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
      animation: false, 
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11, weight: '600' } } },
        tooltip: { backgroundColor: 'rgba(17, 24, 39, 0.9)', padding: 12, cornerRadius: 8, titleColor: '#fff', bodyColor: '#cbd5e1' }
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.tick, font: { family: 'Inter', size: 10 } } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.tick, font: { family: 'Inter', size: 10 } } }
      }
    };
  
    // ==========================================
    // Authentication Logic
    // ==========================================
    
    function checkAuth() {
      if (currentUser) {
        showDashboard();
      } else {
        showLogin();
      }
    }
    
    function showLogin() {
      loginView.style.display = 'flex';
      dashboardView.style.display = 'none';
      stopPolling();
    }
    
    function showDashboard() {
      loginView.style.display = 'none';
      dashboardView.style.display = 'block';
      initCharts();
      startDashboard();
    }
    
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.style.display = 'none';
      loginBtn.textContent = 'Authenticating...';
      loginBtn.disabled = true;
      
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      
      try {
        const res = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        if (data.ok) {
          currentUser = data.user;
          localStorage.setItem('kneesync_user', JSON.stringify(currentUser));
          showDashboard();
        } else {
          loginError.textContent = data.error || 'Login failed';
          loginError.style.display = 'block';
        }
      } catch (err) {
        loginError.textContent = 'Server connection error';
        loginError.style.display = 'block';
      } finally {
        loginBtn.textContent = 'Secure Login';
        loginBtn.disabled = false;
      }
    });
    
    btnLogout.addEventListener('click', () => {
      currentUser = null;
      localStorage.removeItem('kneesync_user');
      showLogin();
    });
  
    // ==========================================
    // Dashboard Logic
    // ==========================================
  
    function initCharts() {
      if (rtChart) rtChart.destroy();
      if (histChart) histChart.destroy();
      
      const rtCtx = document.getElementById('realtimeChart').getContext('2d');
      const gradientBlue = rtCtx.createLinearGradient(0, 0, 0, 300);
      gradientBlue.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
      gradientBlue.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
  
      rtChart = new Chart(rtCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Knee Angle (°)', data: [], borderColor: colors.blue, backgroundColor: gradientBlue, borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0, pointHitRadius: 10 }] },
        options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 0, max: 100 } } }
      });
  
      const histCtx = document.getElementById('historyChart').getContext('2d');
      histChart = new Chart(histCtx, {
        type: 'line',
        data: { labels: [], datasets: [
          { label: 'Gait Quality', data: [], borderColor: colors.teal, backgroundColor: colors.tealBg, borderWidth: 2.5, tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.teal },
          { label: 'Fall Risk', data: [], borderColor: colors.amber, backgroundColor: colors.amberBg, borderWidth: 2.5, tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.amber }
        ]},
        options: { ...chartDefaults, animation: true, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 0, max: 100 } } }
      });
    }
  
    function updateStatus(isOnline) {
      if (isOnline) {
        els.statusBadge.className = 'status-badge';
        els.statusText.textContent = 'Live Connected';
        els.chartLiveBadge.style.display = 'inline-flex';
      } else {
        els.statusBadge.className = 'status-badge offline';
        els.statusText.textContent = 'Device Offline';
        els.chartLiveBadge.style.display = 'none';
      }
      els.lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
    }
  
    async function fetchPatientInfo() {
      try {
        const res = await fetch(`${API_URL}/patient?patient_id=${PATIENT_ID}`);
        const data = await res.json();
        
        if (data.ok && data.patient) {
          const p = data.patient;
          const ls = data.latest_session;
          const ps = data.previous_session;
  
          els.patientName.textContent = p.full_name;
          els.patientAvatar.textContent = p.full_name.charAt(0);
          els.patientDetails.textContent = `${p.age || '--'} Years · ${p.gender || '--'}`;
          els.patientCondition.textContent = p.condition_desc || 'No condition specified';
          els.deviceId.textContent = `Device: ${p.device_id || '--'}`;
          els.baselineAngle.textContent = `Baseline: ${p.baseline_angle || '--'}°`;
  
          if (ls) {
            els.statGait.textContent = ls.gait_score;
            els.statGait.className = `stat-value ${ls.gait_score >= 80 ? 'good' : (ls.gait_score >= 60 ? 'warn' : 'danger')}`;
            els.statRisk.textContent = ls.fall_risk;
            els.statRisk.className = `stat-value ${ls.fall_risk <= 40 ? 'good' : (ls.fall_risk <= 60 ? 'warn' : 'danger')}`;
            els.statSteps.textContent = (ls.steps || 0).toLocaleString();
            els.statSteps.className = 'stat-value blue';
            els.statAvgAngle.textContent = `${ls.avg_angle || 0}°`;
            els.statAvgAngle.className = 'stat-value purple';
            els.sessionDur.textContent = `${ls.duration_min || 0} min`;
            
            if (ps) {
              const gDiff = ls.gait_score - ps.gait_score;
              els.diffGait.textContent = gDiff >= 0 ? `▲ +${gDiff} vs yesterday` : `▼ ${gDiff} vs yesterday`;
              els.diffGait.className = `stat-diff ${gDiff >= 0 ? 'up' : 'down'}`;
              
              const rDiff = ps.fall_risk - ls.fall_risk;
              els.diffRisk.textContent = rDiff >= 0 ? `▼ -${rDiff} vs yesterday` : `▲ +${Math.abs(rDiff)} vs yesterday`;
              els.diffRisk.className = `stat-diff ${rDiff >= 0 ? 'up' : 'down'}`;
            }
          }
        }
      } catch (err) {
        console.error('API Error:', err);
      }
    }
  
    async function fetchHistory() {
      try {
        const res = await fetch(`${API_URL}/history?patient_id=${PATIENT_ID}`);
        const data = await res.json();
        if (data.ok && data.data.length > 0) {
          const recent = data.data.slice(-7);
          histChart.data.labels = recent.map(s => { const d = new Date(s.session_date); return `${d.getDate()}/${d.getMonth()+1}`; });
          histChart.data.datasets[0].data = recent.map(s => s.gait_score);
          histChart.data.datasets[1].data = recent.map(s => s.fall_risk);
          histChart.update();
        }
      } catch (err) {}
    }
  
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
                  <div class="alert-detail">${a.detail || ''} · Risk: ${a.fall_risk}%<br>${timeStr}</div>
                </div>
              </li>
            `;
          }).join('');
        }
      } catch (err) {}
    }
  
    async function pollRealtime() {
      try {
        const res = await fetch(`${API_URL}/realtime?patient_id=${PATIENT_ID}`);
        const data = await res.json();
        
        if (data.ok && data.ts) {
          updateStatus(true);
          
          if (data.knee_angle !== null) {
            els.liveAngle.innerHTML = `${data.knee_angle.toFixed(1)}<span class="sensor-unit">°</span>`;
            els.liveAngle.className = 'sensor-value text-primary';
            els.liveTremor.innerHTML = `${data.tremor_rms.toFixed(3)}<span class="sensor-unit"> Hz</span>`;
            els.liveTremor.className = 'sensor-value text-secondary';
            
            els.gaitPhase.textContent = data.gait_phase;
            els.gaitPhase.className = `gait-indicator ${data.gait_phase.toLowerCase()}`;
            els.gaitPhase.style.background = '';
            els.gaitPhase.style.borderColor = '';
            els.gaitPhase.style.color = '';
            
            if (data.battery_level !== null) {
              els.batteryFill.style.width = `${data.battery_level}%`;
              els.batteryText.textContent = `${data.battery_level}%`;
              if (data.battery_level < 20) els.batteryFill.className = 'battery-fill low';
              else if (data.battery_level < 50) els.batteryFill.className = 'battery-fill medium';
              else els.batteryFill.className = 'battery-fill';
            }
            
            if (data.firmware_version) els.firmwareVer.textContent = data.firmware_version;
            const timeObj = new Date(data.ts);
            els.lastSync.textContent = timeObj.toLocaleTimeString('en-US', {hour12:false});
  
            const label = timeObj.toLocaleTimeString('en-US', {hour12:false});
            rtChart.data.labels.push(label);
            rtChart.data.datasets[0].data.push(data.knee_angle);
            if (rtChart.data.labels.length > 30) {
              rtChart.data.labels.shift();
              rtChart.data.datasets[0].data.shift();
            }
            rtChart.update('none'); 
          }
        } else {
          updateStatus(false);
        }
      } catch (err) {
        updateStatus(false);
      }
    }
  
    function startDashboard() {
      fetchPatientInfo();
      fetchHistory();
      fetchAlerts();
      
      pollRealtime();
      pollingTimer = setInterval(() => {
        pollRealtime();
        if (Math.random() < 0.2) {
          fetchPatientInfo();
          fetchAlerts();
        }
      }, POLL_INTERVAL);
    }
    
    function stopPolling() {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    }
    
    // Kickoff
    checkAuth();
  });
