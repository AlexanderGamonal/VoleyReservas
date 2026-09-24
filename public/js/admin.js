/**
 * VoleyReservas - Admin Panel Application
 * Handles login, dashboard, reservation management, and push notifications
 */

// ==========================================
// State
// ==========================================
const state = {
  token: localStorage.getItem('voley_admin_token'),
  currentTab: 'pendientes',
  filterDate: new Date().toLocaleDateString('en-CA'),
  reservations: [],
  refreshInterval: null,
  // Enlaces de WhatsApp de reservas recién confirmadas/rechazadas. Se guardan
  // en el estado (no solo en el DOM) porque el auto-refresh cada 15s vuelve
  // a renderizar la lista completa y borraría el botón antes de que el
  // admin alcance a hacer clic.
  whatsappLinks: {}
};

const API_BASE = '';

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    verifyToken();
  } else {
    showLoginScreen();
  }
});

// ==========================================
// Authentication
// ==========================================
async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const loginBtn = document.getElementById('btnLogin');
  const loginError = document.getElementById('loginError');

  loginBtn.textContent = 'Ingresando...';
  loginBtn.disabled = true;
  loginError.classList.remove('visible');

  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Error de autenticación');
    }

    state.token = data.token;
    localStorage.setItem('voley_admin_token', data.token);
    showAdminApp();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.add('visible');
  } finally {
    loginBtn.textContent = 'Iniciar Sesión';
    loginBtn.disabled = false;
  }
}

async function verifyToken() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/verify`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (response.ok) {
      showAdminApp();
    } else {
      handleLogout();
    }
  } catch {
    handleLogout();
  }
}

function handleLogout() {
  state.token = null;
  localStorage.removeItem('voley_admin_token');
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  showLoginScreen();
}

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('adminApp').classList.remove('active');
}

function showAdminApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminApp').classList.add('active');

  // Set date filter to today
  document.getElementById('dateFilter').value = state.filterDate;

  // Check notification permission
  checkNotificationPermission();

  // Load data
  loadDashboard();
  loadReservations();

  // Auto-refresh every 15 seconds
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(() => {
    loadDashboard();
    loadReservations();
  }, 15000);
}

// ==========================================
// Push Notifications
// ==========================================
function checkNotificationPermission() {
  const banner = document.getElementById('notificationBanner');

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    banner.style.display = 'none';
    return;
  }

  if (Notification.permission === 'granted') {
    banner.style.display = 'none';
    registerServiceWorker();
  } else if (Notification.permission === 'denied') {
    banner.style.display = 'none';
  } else {
    banner.style.display = '';
  }
}

async function enableNotifications() {
  try {
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      document.getElementById('notificationBanner').style.display = 'none';
      await registerServiceWorker();
      showToast('¡Notificaciones activadas! 🔔', 'success');
    } else {
      showToast('Notificaciones bloqueadas. Actívalas desde la configuración del navegador.', 'error');
    }
  } catch (error) {
    console.error('Error enabling notifications:', error);
    showToast('Error al activar notificaciones', 'error');
  }
}

async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');

    // Get VAPID public key
    const response = await fetch(`${API_BASE}/api/vapid-public-key`);
    const { publicKey } = await response.json();

    if (!publicKey) return;

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // Send subscription to server
    await fetch(`${API_BASE}/api/admin/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(subscription)
    });

    console.log('Push subscription registered');
  } catch (error) {
    console.error('Error registering service worker:', error);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ==========================================
// Dashboard
// ==========================================
async function loadDashboard() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/ingresos`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) return handleLogout();
      return;
    }

    const data = await response.json();

    // Update metrics
    const pendingCard = document.getElementById('metricPending');
    pendingCard.querySelector('.metric-value').textContent = data.pendientes;
    pendingCard.classList.toggle('has-pending', data.pendientes > 0);

    document.getElementById('metricIncome').querySelector('.metric-value').textContent = `S/ ${data.diario.total}`;
    document.getElementById('metricIncome').querySelector('.metric-sub').textContent = `${data.diario.cantidad} reserva(s)`;

    document.getElementById('metricBookings').querySelector('.metric-value').textContent = data.reservas_hoy;

    document.getElementById('metricWeekly').querySelector('.metric-value').textContent = `S/ ${data.semanal.total}`;
    document.getElementById('metricWeekly').querySelector('.metric-sub').textContent = `${data.semanal.cantidad} reserva(s)`;

    // Update pending tab count
    document.getElementById('tabPendingCount').textContent = data.pendientes;

    // Update chart
    renderChart(data.desglose_diario);
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

function renderChart(data) {
  const container = document.getElementById('chartContainer');
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state" style="width:100%"><div class="empty-text">Sin datos esta semana</div></div>';
    return;
  }

  const maxValue = Math.max(...data.map(d => d.total), 1);

  // Fill in missing days for the last 7 days
  const today = new Date();
  const chartData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA');
    const existing = data.find(x => x.fecha === dateStr);
    chartData.push({
      fecha: dateStr,
      total: existing ? existing.total : 0,
      cantidad: existing ? existing.cantidad : 0,
      dayName: days[d.getDay()],
      dayNum: d.getDate()
    });
  }

  container.innerHTML = chartData.map(d => {
    const heightPercent = Math.max((d.total / maxValue) * 100, 5);
    return `
      <div class="chart-bar-wrapper">
        <div class="chart-bar" style="height: ${heightPercent}%">
          <span class="bar-value">S/ ${d.total}</span>
        </div>
        <span class="chart-label">${d.dayName}<br>${d.dayNum}</span>
      </div>
    `;
  }).join('');
}

// ==========================================
// Reservations
// ==========================================
async function loadReservations() {
  try {
    const params = new URLSearchParams();
    
    if (state.currentTab !== 'todas') {
      const estadoMap = {
        'pendientes': 'pendiente',
        'confirmadas': 'confirmada'
      };
      if (estadoMap[state.currentTab]) {
        params.set('estado', estadoMap[state.currentTab]);
      }
    }

    if (state.filterDate) {
      params.set('fecha', state.filterDate);
    }

    const response = await fetch(`${API_BASE}/api/admin/reservas?${params}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) return handleLogout();
      return;
    }

    state.reservations = await response.json();
    renderReservations();

    // Update confirmed count
    const confirmed = state.reservations.filter(r => r.estado === 'confirmada').length;
    document.getElementById('tabConfirmedCount').textContent = confirmed;
  } catch (error) {
    console.error('Error loading reservations:', error);
  }
}

function renderReservations() {
  const list = document.getElementById('reservationsList');
  const reservations = state.reservations;

  if (!reservations || reservations.length === 0) {
    const tabName = state.currentTab === 'todas' ? '' : state.currentTab;
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">No hay reservas ${tabName} para esta fecha</div>
      </div>
    `;
    return;
  }

  list.innerHTML = reservations.map(r => renderReservationCard(r)).join('');
}

function renderReservationCard(r) {
  const dateObj = new Date(r.fecha + 'T12:00:00');
  const dateFormatted = dateObj.toLocaleDateString('es-PE', { 
    weekday: 'short', 
    day: 'numeric', 
    month: 'short' 
  });

  const horaInicio = formatHour(r.hora_inicio);
  const horaFin = formatHour(r.hora_fin);
  const duracion = r.hora_fin - r.hora_inicio;

  let countdownHtml = '';
  if (r.estado === 'pendiente' && r.tiempo_restante !== null) {
    const minutes = Math.floor(r.tiempo_restante / 60);
    const seconds = r.tiempo_restante % 60;
    countdownHtml = `
      <div class="card-countdown">
        <span>⏱️</span>
        <span>Tiempo restante: </span>
        <span class="countdown-timer" data-reserva-id="${r.id}">${minutes}:${seconds.toString().padStart(2, '0')}</span>
      </div>
    `;
  }

  const metodoPagoLabel = {
    'yape': '💜 Yape',
    'plin': '💚 Plin',
    'transferencia': '🏦 Transferencia'
  };

  let actionsHtml = '';
  if (r.estado === 'pendiente') {
    actionsHtml = `
      <button class="btn-view-receipt" onclick="viewReceipt(${r.id})">
        🖼️ Ver Comprobante
      </button>
      <div class="card-actions">
        <button class="btn-confirm" onclick="confirmReservation(${r.id})">
          ✅ Confirmar
        </button>
        <button class="btn-reject" onclick="rejectReservation(${r.id})">
          ❌
        </button>
      </div>
    `;
  } else if (r.estado === 'confirmada') {
    actionsHtml = `
      <button class="btn-view-receipt" onclick="viewReceipt(${r.id})">
        🖼️ Ver Comprobante
      </button>
      <button class="btn-cancel-reservation" onclick="cancelReservation(${r.id})">
        Cancelar reserva
      </button>
    `;
  }

  // Enlace de WhatsApp de una reserva recién confirmada/rechazada (ver state.whatsappLinks)
  let whatsappHtml = '';
  const waUrl = state.whatsappLinks[r.id];
  if (waUrl) {
    whatsappHtml = `
      <a href="${waUrl}" target="_blank" rel="noopener" class="btn-whatsapp" onclick="dismissWhatsapp(${r.id})">
        💬 Enviar mensaje por WhatsApp
      </a>
    `;
  }

  return `
    <div class="reservation-card ${r.estado}" id="card-${r.id}">
      <div class="card-header">
        <div class="card-client">
          <div class="client-name">${escapeHtml(r.nombre_cliente)}</div>
          <div class="client-phone">📱 ${r.telefono}</div>
        </div>
        <span class="card-status ${r.estado}">${getStatusLabel(r.estado)}</span>
      </div>
      ${countdownHtml}
      <div class="card-details">
        <div class="card-detail">
          <span class="detail-label">Fecha</span>
          <span class="detail-value">${dateFormatted}</span>
        </div>
        <div class="card-detail">
          <span class="detail-label">Horario</span>
          <span class="detail-value">${horaInicio} - ${horaFin}</span>
        </div>
        <div class="card-detail">
          <span class="detail-label">Duración</span>
          <span class="detail-value">${duracion} hora${duracion > 1 ? 's' : ''}</span>
        </div>
        <div class="card-detail">
          <span class="detail-label">Monto</span>
          <span class="detail-value amount">S/ ${r.monto_total}</span>
        </div>
        <div class="card-detail">
          <span class="detail-label">Método</span>
          <span class="detail-value">${metodoPagoLabel[r.metodo_pago] || r.metodo_pago}</span>
        </div>
        <div class="card-detail">
          <span class="detail-label">Creada</span>
          <span class="detail-value">${formatTime(r.created_at)}</span>
        </div>
      </div>
      ${actionsHtml}
      ${whatsappHtml}
    </div>
  `;
}

function getStatusLabel(estado) {
  const labels = {
    'pendiente': '🟡 Pendiente',
    'confirmada': '🟢 Confirmada',
    'rechazada': '🔴 Rechazada',
    'expirada': '⚫ Expirada',
    'cancelada': '❌ Cancelada'
  };
  return labels[estado] || estado;
}

// ==========================================
// Reservation Actions
// ==========================================
async function confirmReservation(id) {
  if (!confirm('¿Confirmar esta reserva?')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/reservas/${id}/confirmar`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showToast('✅ Reserva confirmada', 'success');

    // Al confirmar, la reserva deja de aparecer en la pestaña "Pendientes"
    // en el siguiente refresco, así que un botón dentro de la tarjeta
    // desaparecería antes de que el admin llegue a hacer clic. Se redirige
    // el propio tab a wa.me: a diferencia de window.open(), una navegación
    // nunca la bloquea el navegador como popup.
    if (data.whatsapp_url) {
      state.whatsappLinks[id] = data.whatsapp_url;
      redirectToWhatsapp(data.whatsapp_url);
      return;
    }

    // Reload data
    loadDashboard();
    loadReservations();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function redirectToWhatsapp(url) {
  window.location.href = url;
}

async function rejectReservation(id) {
  if (!confirm('¿Rechazar esta reserva?')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/reservas/${id}/rechazar`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showToast('Reserva rechazada', 'success');

    if (data.whatsapp_url) {
      state.whatsappLinks[id] = data.whatsapp_url;
      redirectToWhatsapp(data.whatsapp_url);
      return;
    }

    loadDashboard();
    loadReservations();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function dismissWhatsapp(id) {
  delete state.whatsappLinks[id];
}

async function cancelReservation(id) {
  if (!confirm('¿Cancelar esta reserva confirmada? El horario se liberará.')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/reservas/${id}/cancelar`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showToast('Reserva cancelada', 'success');
    loadDashboard();
    loadReservations();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==========================================
// Receipt Viewer
// ==========================================
async function viewReceipt(id) {
  const modal = document.getElementById('receiptModal');
  const img = document.getElementById('receiptImage');

  img.src = '';
  modal.classList.add('active');

  try {
    const response = await fetch(`${API_BASE}/api/admin/reservas/${id}/comprobante`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!response.ok) throw new Error('Error al cargar comprobante');

    const blob = await response.blob();
    img.src = URL.createObjectURL(blob);
  } catch (error) {
    showToast('Error al cargar el comprobante', 'error');
    modal.classList.remove('active');
  }
}

function closeReceiptModal() {
  const modal = document.getElementById('receiptModal');
  modal.classList.remove('active');
}

// ==========================================
// Tabs & Filters
// ==========================================
function switchTab(tab) {
  state.currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const isConfig = tab === 'config';
  document.getElementById('configPanel').style.display = isConfig ? '' : 'none';
  document.getElementById('reservationsList').style.display = isConfig ? 'none' : '';
  document.getElementById('dateFilterSection').style.display = isConfig ? 'none' : '';

  if (isConfig) {
    loadConfigPago();
  } else {
    loadReservations();
  }
}

// ==========================================
// Payment Config
// ==========================================
async function loadConfigPago() {
  try {
    const response = await fetch(`${API_BASE}/api/config-pago`);
    if (!response.ok) return;

    const cfg = await response.json();
    document.getElementById('cfgYapeNumero').value = cfg.yape_numero || '';
    document.getElementById('cfgYapeTitular').value = cfg.yape_titular || '';
    document.getElementById('cfgPlinNumero').value = cfg.plin_numero || '';
    document.getElementById('cfgPlinTitular').value = cfg.plin_titular || '';
    document.getElementById('cfgBancoNombre').value = cfg.banco_nombre || '';
    document.getElementById('cfgBancoNumeroCuenta').value = cfg.banco_numero_cuenta || '';
    document.getElementById('cfgBancoCci').value = cfg.banco_cci || '';
    document.getElementById('cfgBancoTitular').value = cfg.banco_titular || '';
  } catch (error) {
    console.error('Error cargando datos de pago:', error);
    showToast('Error al cargar los datos de pago', 'error');
  }
}

async function saveConfigPago(event) {
  event.preventDefault();

  const btn = document.getElementById('btnSaveConfig');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const payload = {
    yape_numero: document.getElementById('cfgYapeNumero').value.trim(),
    yape_titular: document.getElementById('cfgYapeTitular').value.trim(),
    plin_numero: document.getElementById('cfgPlinNumero').value.trim(),
    plin_titular: document.getElementById('cfgPlinTitular').value.trim(),
    banco_nombre: document.getElementById('cfgBancoNombre').value.trim(),
    banco_numero_cuenta: document.getElementById('cfgBancoNumeroCuenta').value.trim(),
    banco_cci: document.getElementById('cfgBancoCci').value.trim(),
    banco_titular: document.getElementById('cfgBancoTitular').value.trim()
  };

  try {
    const response = await fetch(`${API_BASE}/api/admin/config-pago`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Error al guardar');

    showToast('✅ Datos de pago guardados', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar datos de pago';
  }
}

function onDateFilterChange() {
  state.filterDate = document.getElementById('dateFilter').value;
  loadReservations();
}

function filterToday() {
  state.filterDate = new Date().toLocaleDateString('en-CA');
  document.getElementById('dateFilter').value = state.filterDate;
  loadReservations();
}

// ==========================================
// Toast Notifications
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ==========================================
// Countdown Timer (client-side)
// ==========================================
setInterval(() => {
  document.querySelectorAll('.countdown-timer').forEach(el => {
    const text = el.textContent;
    const parts = text.split(':');
    let minutes = parseInt(parts[0]);
    let seconds = parseInt(parts[1]);

    if (minutes === 0 && seconds === 0) {
      // Expired - reload
      loadDashboard();
      loadReservations();
      return;
    }

    seconds--;
    if (seconds < 0) {
      seconds = 59;
      minutes--;
    }

    el.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    if (minutes === 0 && seconds <= 30) {
      el.style.color = 'var(--accent-red)';
    }
  });
}, 1000);

// ==========================================
// Utility Functions
// ==========================================
function formatHour(hour) {
  if (hour === 0 || hour === 24) return '12:00 am';
  if (hour === 12) return '12:00 pm';
  if (hour < 12) return `${hour}:00 am`;
  return `${hour - 12}:00 pm`;
}

function formatTime(datetimeStr) {
  if (!datetimeStr) return '-';
  const date = new Date(datetimeStr);
  return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
