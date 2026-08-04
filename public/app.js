/* ============================================================
   KneeSync AI — Public Dashboard Logic (Role-Based Auth)
   - Baseline calibration status display
   - Admin role promotion
   - Patient-only registration
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
        currentUser.token = data.token;
        localStorage.setItem('kneesync_user', JSON.stringify(currentUser));
        routeUser();
      } else {
        showError(data.error || 'Login failed');
      }
    } catch (err) {
      showError('Server connection error');
    }
  });
  
  // Register — always as patient (no role selector)
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.style.display = 'none';
    const full_name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const device_id = document.getElementById('regDeviceId').value;
    
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name, device_id })
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
          currentUser.token = loginData.token;
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
      const res = await fetch(`${API_URL}/admin/users`, {
        headers: { 'Authorization': 'Bearer ' + currentUser.token }
      });
      const data = await res.json();
      if (data.ok) {
        if (data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users found.</td></tr>';
          return;
        }
        tbody.innerHTML = data.data.map((u, index) => {
          const isMe = u.user_id === currentUser.user_id;
          const roleLabel = u.role.toUpperCase();
          const canPromote = !isMe && u.role === 'patient';
          const safeData = encodeURIComponent(JSON.stringify(u));
          return `
            <tr>
              <td>${index + 1}</td>
              <td style="font-weight:600;">${u.full_name}</td>
              <td>${u.email}</td>
              <td><span style="background:var(--bg-glass); padding:4px 8px; border-radius:4px; font-size:12px; font-weight:700;">${roleLabel}</span></td>
              <td><span style="color:var(--text-muted); font-family:monospace;">${u.device_id || '-'}</span></td>
              <td>
                <button class="btn-edit" onclick="openEditUserModal('${safeData}')">Edit</button>
                ${canPromote ? `<button class="btn-promote" onclick="promoteUser(${u.user_id}, '${u.full_name}')">Promote</button>` : ''}
                ${!isMe ? `<button class="btn-delete" onclick="deleteUser(${u.user_id})">Delete</button>` : '<span style="color:var(--text-muted); font-size:12px;">(You)</span>'}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch(err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="color:var(--accent-rose);">Error loading users.</td></tr>';
    }
  }

  window.promoteUser = async function(userId, userName) {
    const adminPassword = prompt(`To promote "${userName}" to Doctor, enter your Admin password:`);
    if (!adminPassword) return;
    
    try {
      const res = await fetch(`${API_URL}/admin/promote`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentUser.token 
        },
        body: JSON.stringify({
          user_id: userId,
          new_role: 'doctor',
          admin_email: currentUser.email,
          admin_password: adminPassword
        })
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ ${userName} has been promoted to Doctor!`);
        loadAdminUsers();
      } else {
        alert('❌ Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Connection error while promoting.');
    }
  };

  window.deleteUser = async function(userId) {
    if (confirm('Are you sure you want to delete this user? ALL their associated data (patients, sessions, readings) will be permanently lost!')) {
      try {
        const res = await fetch(`${API_URL}/admin/users/${userId}`, { 
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + currentUser.token }
        });
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

  // --- Modal Logic ---
  const addModal = document.getElementById('addUserModal');
  const editModal = document.getElementById('editUserModal');
  
  document.getElementById('btnOpenAddUser')?.addEventListener('click', () => {
    document.getElementById('addUserForm').reset();
    addModal.style.display = 'flex';
  });
  document.getElementById('btnCloseAddUser')?.addEventListener('click', () => addModal.style.display = 'none');
  document.getElementById('btnCancelAddUser')?.addEventListener('click', () => addModal.style.display = 'none');

  document.getElementById('btnCloseEditUser')?.addEventListener('click', () => editModal.style.display = 'none');
  document.getElementById('btnCancelEditUser')?.addEventListener('click', () => editModal.style.display = 'none');

  document.getElementById('addRole')?.addEventListener('change', (e) => {
    document.getElementById('addGroupDevice').style.display = e.target.value === 'patient' ? 'block' : 'none';
  });
  document.getElementById('editRole')?.addEventListener('change', (e) => {
    document.getElementById('editGroupDevice').style.display = e.target.value === 'patient' ? 'block' : 'none';
  });

  window.openEditUserModal = function(encodedData) {
    const u = JSON.parse(decodeURIComponent(encodedData));
    document.getElementById('editUserId').value = u.user_id;
    document.getElementById('editName').value = u.full_name;
    document.getElementById('editEmail').value = u.email;
    document.getElementById('editRole').value = u.role;
    document.getElementById('editDeviceId').value = u.device_id || '';
    document.getElementById('editGroupDevice').style.display = u.role === 'patient' ? 'block' : 'none';
    editModal.style.display = 'flex';
  };

  document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      full_name: document.getElementById('addName').value,
      email: document.getElementById('addEmail').value,
      password: document.getElementById('addPassword').value,
      role: document.getElementById('addRole').value,
      device_id: document.getElementById('addDeviceId').value
    };
    try {
      const res = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentUser.token },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.ok) {
        addModal.style.display = 'none';
        loadAdminUsers();
      } else {
        alert('Failed to add user: ' + data.error);
      }
    } catch (err) { alert('Connection error'); }
  });

  document.getElementById('editUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('editUserId').value;
    const payload = {
      full_name: document.getElementById('editName').value,
      email: document.getElementById('editEmail').value,
      role: document.getElementById('editRole').value,
      device_id: document.getElementById('editDeviceId').value
    };
    try {
      const res = await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentUser.token },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.ok) {
        editModal.style.display = 'none';
        loadAdminUsers();
      } else {
        alert('Failed to update user: ' + data.error);
      }
    } catch (err) { alert('Connection error'); }
  });
  
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
          const bStatus = p.baseline_status || 'pending';
          const bSamples = p.baseline_samples || 0;
          let badgeHTML = '';
          if (bStatus === 'calibrated') {
            badgeHTML = '<span class="baseline-badge calibrated">✅ Calibrated</span>';
          } else if (bStatus === 'calibrating') {
            badgeHTML = `<span class="baseline-badge calibrating">📊 Calibrating (${bSamples}/10)</span>`;
          } else {
            badgeHTML = '<span class="baseline-badge pending">⏳ Awaiting Data</span>';
          }

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
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                ${badgeHTML}
              </div>
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
    baselineBadge: document.getElementById('baselineBadge'),
    baselineBadgeIcon: document.getElementById('baselineBadgeIcon'),
    baselineBadgeText: document.getElementById('baselineBadgeText'),
    btnRecalibrate: document.getElementById('btnRecalibrate'),
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

  // Recalibrate button handler
  els.btnRecalibrate.addEventListener('click', async () => {
    if (!activePatientId) return;
    if (!confirm('Reset baseline? The system will recalibrate from the next 10 steps.')) return;
    
    try {
      const res = await fetch(`${API_URL}/patient/${activePatientId}/recalibrate`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        alert('✅ Baseline reset! Will recalibrate from next 10 steps.');
        fetchPatientData(); // Refresh
      } else {
        alert('❌ Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Connection error.');
    }
  });

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
    updateBaselineBadge('pending', 0);
  }

  function updateBaselineBadge(status, samples, mean, sd, angle) {
    const badge = els.baselineBadge;
    const icon = els.baselineBadgeIcon;
    const text = els.baselineBadgeText;
    const recalBtn = els.btnRecalibrate;

    badge.className = 'baseline-badge ' + (status || 'pending');

    if (status === 'calibrated') {
      icon.textContent = '✅';
      text.textContent = `Calibrated (${angle || '--'}°)`;
      // Show recalibrate for doctors only
      recalBtn.style.display = (currentUser && currentUser.role === 'doctor') ? 'inline-block' : 'none';
    } else if (status === 'calibrating') {
      icon.textContent = '📊';
      text.textContent = `Calibrating (${samples || 0}/10 steps)`;
      recalBtn.style.display = 'none';
    } else {
      icon.textContent = '⏳';
      text.textContent = 'Awaiting First Steps';
      recalBtn.style.display = 'none';
    }
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

        // Update baseline calibration status badge
        updateBaselineBadge(
          p.baseline_status,
          p.baseline_samples,
          p.baseline_mean,
          p.baseline_sd,
          p.baseline_angle
        );

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
