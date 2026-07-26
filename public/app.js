/* ============================================================
   KneeSync AI — Public Dashboard Logic (Role-Based Auth)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = '/api'; 
  const POLL_INTERVAL = 5000;
  
  let currentUser = JSON.parse(localStorage.getItem('kneesync_user') || 'null');
  let activePatientId = null;
  let pollingTimer = null;
  
  // Views
  const vAuth = document.getElementById('authView');
  const vDoc = document.getElementById('doctorDashboardView');
  const vPat = document.getElementById('patientDashboardView');
  const vAdmin = document.getElementById('adminDashboardView');
  
  // Auth Elements
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authError = document.getElementById('authError');
  const btnDocLogout = document.getElementById('btnDocLogout');
  const btnPatSelfLogout = document.getElementById('btnPatSelfLogout');
  const btnPatLogout = document.getElementById('btnPatLogout'); // For doc to return to list
  const btnAdminLogout = document.getElementById('btnAdminLogout');
  const docWelcome = document.getElementById('docWelcome');
  
  // Tab Switching
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    authError.style.display = 'none';
  });
  
  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.style.display = 'block';
    loginForm.style.display = 'none';
    authError.style.display = 'none';
  });
  
  // Authentication Actions
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.style.display = 'none';
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
        routeUser();
      } else {
        showError(data.error || 'Login failed');
      }
    } catch (err) {
      showError('Server connection error');
    }
  });
  
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.style.display = 'none';
    const role = document.querySelector('input[name="role"]:checked').value;
    const full_name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name, role })
      });
      const data = await res.json();
      if (data.ok) {
        // Auto-login after register
        const resLogin = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const loginData = await resLogin.json();
        if (loginData.ok) {
          currentUser = loginData.user;
          localStorage.setItem('kneesync_user', JSON.stringify(currentUser));
          routeUser();
        }
      } else {
        showError(data.error || 'Registration failed');
      }
    } catch (err) {
      showError('Server connection error');
    }
  });
  
  function showError(msg) {
    authError.textContent = msg;
    authError.style.display = 'block';
  }
  
  function logout() {
    currentUser = null;
    activePatientId = null;
    localStorage.removeItem('kneesync_user');
    stopPolling();
    vDoc.style.display = 'none';
    vPat.style.display = 'none';
    vAdmin.style.display = 'none';
    vAuth.style.display = 'flex';
  }
  
  btnDocLogout.addEventListener('click', logout);
  btnPatSelfLogout.addEventListener('click', logout);
  btnAdminLogout.addEventListener('click', logout);
  
  btnPatLogout.addEventListener('click', () => {
    // Doctor returns to patient list
    stopPolling();
    vPat.style.display = 'none';
    vDoc.style.display = 'block';
  });
  
  // Routing Logic
  function routeUser() {
    if (!currentUser) {
      vAuth.style.display = 'flex';
      vDoc.style.display = 'none';
      vPat.style.display = 'none';
      vAdmin.style.display = 'none';
      return;
    }
    
    vAuth.style.display = 'none';
    vDoc.style.display = 'none';
    vPat.style.display = 'none';
    vAdmin.style.display = 'none';
    
    if (currentUser.role === 'admin') {
      vAdmin.style.display = 'block';
      loadAdminUsers();
    } else if (currentUser.role === 'doctor') {
      vDoc.style.display = 'block';
      docWelcome.textContent = `Welcome, Dr. ${currentUser.full_name}`;
      loadPatientsList();
    } else if (currentUser.role === 'patient') {
      vPat.style.display = 'block';
      // Hide back button for patients, show logout
      btnPatLogout.style.display = 'none';
      btnPatSelfLogout.style.display = 'block';
      
      activePatientId = currentUser.patient_id;
      startPatientDashboard();
    }
  }

  // ==========================================
  // Admin Dashboard Logic
  // ==========================================
  async function loadAdminUsers() {
    const tbody = document.getElementById('adminUserList');
    try {
      const res = await fetch(`${API_URL}/admin/users`);
      const data = await res.json();
      if (data.ok) {
        if (data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found.</td></tr>';
          return;
        }
        tbody.innerHTML = data.data.map(u => {
          const isMe = u.user_id === currentUser.user_id;
          return `
            <tr>
              <td>#${u.user_id}</td>
              <td style="font-weight:600;">${u.full_name}</td>
              <td>${u.email}</td>
              <td><span style="background:var(--bg-glass); padding:4px 8px; border-radius:4px; font-size:12px; font-weight:700;">${u.role.toUpperCase()}</span></td>
              <td>
                ${!isMe ? `<button class="btn-delete" onclick="deleteUser(${u.user_id})">Delete</button>` : '<span style="color:var(--text-muted); font-size:12px;">(You)</span>'}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch(err) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="color:var(--accent-rose);">Error loading users.</td></tr>';
    }
  }

  window.deleteUser = async function(userId) {
    if (confirm('Are you sure you want to delete this user? ALL their associated data (patients, sessions, readings) will be permanently lost!')) {
      try {
        const res = await fetch(`${API_URL}/admin/users/${userId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          loadAdminUsers(); // Refresh table
        } else {
          alert('Failed to delete user: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Connection error while deleting.');
      }
    }
  };
  
  // ==========================================
  // Doctor Dashboard Logic
  // ==========================================
  async function loadPatientsList() {
    const container = document.getElementById('patientListContainer');
    try {
      const res = await fetch(`${API_URL}/patients`);
      const data = await res.json();
      if (data.ok) {
        if (data.data.length === 0) {
          container.innerHTML = '<div class="empty-state">No patients registered yet.</div>';
          return;
        }
        container.innerHTML = data.data.map(p => {
          return `
            <div class="patient-list-card" data-pid="${p.patient_id}">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                <div style="width:40px; height:40px; border-radius:50%; background:var(--grad-blue); color:white; display:grid; place-items:center; font-weight:800; font-size:18px;">
                  ${p.full_name.charAt(0)}
                </div>
                <div>
                  <div style="font-weight:800; font-size:16px;">${p.full_name}</div>
                  <div style="font-size:12px; color:var(--text-muted);">${p.age || '--'} Yrs · ${p.gender || '--'}</div>
                </div>
              </div>
              <div style="font-size:13px; color:var(--text-secondary); margin-bottom:4px;">Device: ${p.device_id || 'Not assigned'}</div>
              <div style="font-size:12px; color:var(--text-muted);">Last Sync: ${p.last_session || 'No data'}</div>
            </div>
          `;
        }).join('');
        
        // Add click events
        document.querySelectorAll('.patient-list-card').forEach(card => {
          card.addEventListener('click', () => {
            activePatientId = card.getAttribute('data-pid');
            vDoc.style.display = 'none';
            vPat.style.display = 'block';
            
            // Show back button for doctors, hide patient's own logout
            btnPatLogout.style.display = 'block';
            btnPatSelfLogout.style.display = 'none';
            
            startPatientDashboard();
          });
        });
      }
    } catch (err) {
      container.innerHTML = '<div class="empty-state">Error loading patients.</div>';
    }
  }
  
  // ==========================================
  // Patient Dashboard Logic (Shared for Doc & Pat)
  // ==========================================
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

  let rtChart = null;
  let histChart = null;

  function initCharts() {
    if (rtChart) rtChart.destroy();
    if (histChart) histChart.destroy();
    
    const rtCtx = document.getElementById('realtimeChart').getContext('2d');
    rtChart = new Chart(rtCtx, {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Knee Angle (°)', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins:{legend:{labels:{color:'#94a3b8'}}}, scales: { y: { min: 0, max: 100 } } }
    });

    const histCtx = document.getElementById('historyChart').getContext('2d');
    histChart = new Chart(histCtx, {
      type: 'line',
      data: { labels: [], datasets: [
        { label: 'Gait Quality', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2.5, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#10b981' },
        { label: 'Fall Risk', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 2.5, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#f59e0b' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } }
    });
  }

  // Define clear functions so switching patients wipes old data
  function clearDashboard() {
    els.patientName.textContent = 'Loading...';
    els.statGait.textContent = '--';
    els.statRisk.textContent = '--';
    els.statSteps.textContent = '--';
    els.statAvgAngle.textContent = '--°';
    els.liveAngle.textContent = '--°';
    els.liveTremor.textContent = '-- Hz';
    els.gaitPhase.textContent = '--';
    els.alertList.innerHTML = '';
  }

  async function fetchPatientData() {
    if(!activePatientId) return;
    try {
      const res = await fetch(`${API_URL}/patient?patient_id=${activePatientId}`);
      const data = await res.json();
      if (data.ok && data.patient) {
        const p = data.patient;
        const ls = data.latest_session;
        els.patientName.textContent = p.full_name;
        els.patientAvatar.textContent = p.full_name.charAt(0);
        els.patientDetails.textContent = `${p.age || '--'} Years · ${p.gender || '--'}`;
        els.patientCondition.textContent = p.condition_desc || 'No condition specified';
        els.deviceId.textContent = `Device: ${p.device_id || '--'}`;
        els.baselineAngle.textContent = `Baseline: ${p.baseline_angle || '--'}°`;

        if (ls) {
          els.statGait.textContent = ls.gait_score;
          els.statRisk.textContent = ls.fall_risk;
          els.statSteps.textContent = (ls.steps || 0).toLocaleString();
          els.statAvgAngle.textContent = `${ls.avg_angle || 0}°`;
          els.sessionDur.textContent = `${ls.duration_min || 0} min`;
        }
      }
    } catch(e) {}
  }
  
  async function pollRealtime() {
    if(!activePatientId) return;
    try {
      const res = await fetch(`${API_URL}/realtime?patient_id=${activePatientId}`);
      const data = await res.json();
      if (data.ok && data.ts && data.knee_angle !== null) {
        els.liveAngle.innerHTML = `${data.knee_angle.toFixed(1)}<span class="sensor-unit">°</span>`;
        els.liveTremor.innerHTML = `${data.tremor_rms.toFixed(3)}<span class="sensor-unit"> Hz</span>`;
        els.gaitPhase.textContent = data.gait_phase;
        
        if (data.battery_level !== null) els.batteryFill.style.width = `${data.battery_level}%`;
        
        const timeObj = new Date(data.ts);
        const label = timeObj.toLocaleTimeString('en-US', {hour12:false});
        rtChart.data.labels.push(label);
        rtChart.data.datasets[0].data.push(data.knee_angle);
        if (rtChart.data.labels.length > 30) {
          rtChart.data.labels.shift();
          rtChart.data.datasets[0].data.shift();
        }
        rtChart.update('none'); 
      }
    } catch (err) {}
  }

  function startPatientDashboard() {
    clearDashboard();
    initCharts();
    fetchPatientData();
    pollRealtime();
    pollingTimer = setInterval(pollRealtime, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  // Init
  routeUser();
});
