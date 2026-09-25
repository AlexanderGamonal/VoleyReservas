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
  // Registra el SW sin depender de que las notificaciones estén activadas,
  // para que el panel sea instalable (PWA) desde la primera visita.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Error registrando service worker:', error);
    });
  }

  initInstallBanner();

  if (state.token) {
    verifyToken();
  } else {
    showLoginScreen();
  }
});

// ==========================================
// Install Banner (PWA)
// ==========================================
// El listener se registra ya (aunque el admin aún no haya iniciado
// sesión) porque beforeinstallprompt puede dispararse una sola vez al
// cargar la página; el banner en sí vive dentro de #adminApp y solo se
// ve una vez logueado.
let deferredInstallPrompt = null;

function initInstallBanner() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isStandalone) return;

  let dismissed = false;
  try { dismissed = localStorage.getItem('voley_admin_install_dismissed') === '1'; } catch (e) { /* ignore */ }
  if (dismissed) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  if (isIOS) {
    document.getElementById('installBannerText').innerHTML =
      '📲 Para instalar: toca <strong>Compartir</strong> y luego <strong>"Agregar a pantalla de inicio"</strong>';
    document.getElementById('btnInstallApp').style.display = 'none';
    document.getElementById('installBanner').style.display = '';
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.getElementById('installBanner').style.display = '';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('installBanner').style.display = 'none';
  });
}

async function triggerInstall() {
  document.getElementById('installBanner').style.display = 'none';
  if (!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}

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

  // Load data. switchTab() (en vez de llamar loadReservations() directo)
  // también aplica la visibilidad del filtro de fecha para la pestaña
  // activa por defecto ("pendientes"); sin esto, el filtro quedaba
  // visible al iniciar aunque no aplicara a esa pestaña.
  loadDashboard();
  switchTab(state.currentTab);

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

    const metricMonthly = document.getElementById('metricMonthly');
    if (metricMonthly) {
      metricMonthly.querySelector('.metric-value').textContent = `S/ ${data.mensual.total}`;
      metricMonthly.querySelector('.metric-sub').textContent = `${data.mensual.cantidad} reserva(s) este mes`;
      if (data.mensual_metodos) {
        metricMonthly.querySelector('#metricMonthlyBreakdown').innerHTML = `
          <span>💜 Yape: S/ ${data.mensual_metodos.yape}</span>
          <span>💚 Plin: S/ ${data.mensual_metodos.plin}</span>
          <span>🏦 Bco: S/ ${data.mensual_metodos.transferencia}</span>
        `;
      }
    }

    // Update pending tab count (siempre global, sin filtro de fecha)
    document.getElementById('tabPendingCount').textContent = data.pendientes;

    // Update chart
    renderChart(data.desglose_diario);
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }

  loadTabCounts();
}

/**
 * Los badges de "Confirmadas" y "Rechazadas" se calculan aparte de la lista que se muestra
 * para que siempre reflejen el total real del día filtrado, sin importar qué pestaña esté abierta.
 */
async function loadTabCounts() {
  try {
    const [confRes, rejRes] = await Promise.all([
      fetch(`${API_BASE}/api/admin/reservas/count?estado=confirmada&fecha=${state.filterDate}`, { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch(`${API_BASE}/api/admin/reservas/count?estado=rechazada,expirada,cancelada&fecha=${state.filterDate}`, { headers: { 'Authorization': `Bearer ${state.token}` } })
    ]);
    
    if (confRes.ok) {
      const { count } = await confRes.json();
      document.getElementById('tabConfirmedCount').textContent = count;
    }
    if (rejRes.ok) {
      const { count } = await rejRes.json();
      document.getElementById('tabHistoryCount').textContent = count;
    }
  } catch (error) {
    console.error('Error contando confirmadas/rechazadas:', error);
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

  // Fill in missing days for Monday-Sunday of the current week
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - diffToMonday);

  const chartData = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
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

    const estadoMap = {
      'pendientes': 'pendiente',
      'confirmadas': 'confirmada',
      'historial': 'rechazada,expirada,cancelada'
    };
    if (estadoMap[state.currentTab]) {
      params.set('estado', estadoMap[state.currentTab]);
    }

    // Los pendientes requieren acción inmediata, así que se muestran siempre
    // sin importar la fecha seleccionada; el filtro de fecha solo aplica a
    // confirmadas y rechazadas (ver también dateFilterSection en switchTab).
    if (state.filterDate && state.currentTab !== 'pendientes') {
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
    sortReservations();
    renderReservations();
  } catch (error) {
    console.error('Error loading reservations:', error);
  }
}

/**
 * Orden de llegada, más reciente primero. En la pestaña "Confirmadas" se
 * ordena por el momento en que se confirmó (no por cuándo se creó la
 * reserva), para que la última acción del admin aparezca arriba.
 */
function sortReservations() {
  const field = state.currentTab === 'confirmadas' ? 'confirmed_at' : 'created_at';
  state.reservations.sort((a, b) => new Date(b[field] || b.created_at) - new Date(a[field] || a.created_at));
}

function renderReservations() {
  const list = document.getElementById('reservationsList');
  const reservations = state.reservations;

  if (!reservations || reservations.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">No hay reservas ${state.currentTab} para esta fecha</div>
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
  if (!(await showConfirmDialog('Confirmar reserva', '¿Estás seguro de que deseas confirmar esta reserva?'))) return;

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
  if (!(await showConfirmDialog('Rechazar reserva', '¿Estás seguro de que deseas rechazar esta reserva?'))) return;

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
  if (!(await showConfirmDialog('Cancelar reserva', '¿Cancelar esta reserva confirmada? El horario se liberará.'))) return;

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
  const loading = document.getElementById('receiptLoading');

  // Reset image state properly to avoid premature onerror triggers
  img.onload = null;
  img.onerror = null;
  img.removeAttribute('src');
  img.style.opacity = '0';
  
  loading.innerHTML = '<div class="spinner"></div><span style="margin-top: 10px;">Cargando...</span>';
  loading.style.display = 'flex';
  modal.classList.add('active');

  try {
    const response = await fetch(`${API_BASE}/api/admin/reservas/${id}/comprobante`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!response.ok) throw new Error('Error al cargar comprobante');

    const blob = await response.blob();
    
    img.onload = () => {
      loading.style.display = 'none';
      img.style.opacity = '1';
    };
    
    img.onerror = () => {
      loading.innerHTML = '<span>❌ Error al visualizar la imagen (Formato no soportado)</span>';
      img.style.opacity = '0';
    };
    
    img.src = URL.createObjectURL(blob);
  } catch (error) {
    loading.innerHTML = '<span>❌ No se encontró el comprobante</span>';
    showToast('Error al cargar el comprobante', 'error');
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
  // El filtro de fecha no aplica a "Pendientes" (siempre se muestran todas).
  document.getElementById('dateFilterSection').style.display = (isConfig || tab === 'pendientes') ? 'none' : '';

  if (isConfig) {
    loadConfigPago();
    setTimeout(() => {
      document.getElementById('configPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  } else {
    // Clear list to prevent showing stale items while loading
    document.getElementById('reservationsList').innerHTML = '<div class="empty-state"><div class="empty-text">Cargando...</div></div>';
    loadReservations();
  }
}

/**
 * Al hacer clic en las tarjetas de métricas "Pendientes"/"Reservas hoy",
 * cambia a la pestaña correspondiente y baja la vista hasta la lista.
 */
function goToTab(tab) {
  switchTab(tab);
  document.getElementById('tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    
    document.getElementById('cfgHoraInicio').value = cfg.hora_inicio_atencion ?? 8;
    document.getElementById('cfgHoraFin').value = cfg.hora_fin_atencion ?? 23;
    document.getElementById('cfgDiasMax').value = cfg.dias_max_reserva ?? 14;
    document.getElementById('cfgPrecioDia').value = cfg.precio_dia ?? 50;
    document.getElementById('cfgPrecioNoche').value = cfg.precio_noche ?? 60;
    document.getElementById('cfgHoraNoche').value = cfg.hora_inicio_noche ?? 18;
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
    banco_titular: document.getElementById('cfgBancoTitular').value.trim(),
    
    hora_inicio_atencion: parseInt(document.getElementById('cfgHoraInicio').value) || 8,
    hora_fin_atencion: parseInt(document.getElementById('cfgHoraFin').value) || 23,
    dias_max_reserva: parseInt(document.getElementById('cfgDiasMax').value) || 14,
    precio_dia: parseFloat(document.getElementById('cfgPrecioDia').value) || 50,
    precio_noche: parseFloat(document.getElementById('cfgPrecioNoche').value) || 60,
    hora_inicio_noche: parseInt(document.getElementById('cfgHoraNoche').value) || 18
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

    showToast('✅ Configuración guardada', 'success');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Configuración';
  }
}

function onDateFilterChange() {
  state.filterDate = document.getElementById('dateFilter').value;
  loadReservations();
  loadTabCounts();
}

function filterToday() {
  state.filterDate = new Date().toLocaleDateString('en-CA');
  document.getElementById('dateFilter').value = state.filterDate;
  loadReservations();
  loadTabCounts();
}

// ==========================================
// Ingresos por período personalizado
// ==========================================
function consultarMes() {
  const value = document.getElementById('rangoMes').value; // YYYY-MM
  if (!value) return;

  const [y, m] = value.split('-');
  const desde = `${y}-${m}-01`;
  const ultimoDia = new Date(Number(y), Number(m), 0).getDate();
  const hasta = `${y}-${m}-${String(ultimoDia).padStart(2, '0')}`;

  document.getElementById('rangoDesde').value = desde;
  document.getElementById('rangoHasta').value = hasta;

  fetchIngresosRango(desde, hasta);
}

function consultarRango() {
  const desde = document.getElementById('rangoDesde').value;
  const hasta = document.getElementById('rangoHasta').value;

  if (!desde || !hasta) return showToast('Selecciona un rango de fechas', 'error');
  if (desde > hasta) return showToast('La fecha "desde" no puede ser posterior a "hasta"', 'error');

  document.getElementById('rangoMes').value = '';
  fetchIngresosRango(desde, hasta);
}

async function fetchIngresosRango(desde, hasta) {
  const resultEl = document.getElementById('rangoResult');
  resultEl.innerHTML = '<div class="empty-text">Consultando...</div>';

  try {
    const response = await fetch(`${API_BASE}/api/admin/ingresos/rango?desde=${desde}&hasta=${hasta}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Error consultando el período');

    resultEl.innerHTML = `
      <div class="rango-summary">
        <div class="rango-total">S/ ${data.total}</div>
        <div class="rango-sub">${data.cantidad} reserva(s) confirmada(s) · ${formatDateRange(data.desde)} - ${formatDateRange(data.hasta)}</div>
      </div>
    `;
  } catch (error) {
    resultEl.innerHTML = `<div class="empty-text">${escapeHtml(error.message)}</div>`;
  }
}

function formatDateRange(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
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
// Consultas Personalizadas
// ==========================================
window.exportarExcel = function() {
  const desde = document.getElementById('rangoDesde').value;
  const hasta = document.getElementById('rangoHasta').value;
  if (!desde || !hasta) {
    showToast('Selecciona un rango de fechas para exportar', 'error');
    return;
  }
  window.open(`${API_BASE}/api/admin/reservas/exportar?desde=${desde}&hasta=${hasta}&token=${state.token}`, '_blank');
};

window.consultarMes = function() {
  const mesInput = document.getElementById('rangoMes').value;
  if (!mesInput) return;
  const [y, m] = mesInput.split('-');
  const date = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  document.getElementById('rangoDesde').value = `${y}-${m}-01`;
  document.getElementById('rangoHasta').value = `${y}-${m}-${String(lastDay.getDate()).padStart(2, '0')}`;
  window.consultarRango();
};

window.consultarRango = async function() {
  const desde = document.getElementById('rangoDesde').value;
  const hasta = document.getElementById('rangoHasta').value;
  const resultDiv = document.getElementById('rangoResult');
  
  if (!desde || !hasta) {
    resultDiv.innerHTML = '<p class="text-danger">Por favor selecciona un rango de fechas</p>';
    return;
  }
  
  if (desde > hasta) {
    resultDiv.innerHTML = '<p class="text-danger">La fecha "desde" no puede ser mayor que "hasta"</p>';
    return;
  }
  
  resultDiv.innerHTML = '<div class="spinner"></div> Buscando...';
  
  try {
    const response = await fetch(`${API_BASE}/api/admin/ingresos/rango?desde=${desde}&hasta=${hasta}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    if (!response.ok) throw new Error('Error en la consulta');
    const data = await response.json();
    
    let metodosHtml = '';
    if (data.metodos) {
      metodosHtml = `
        <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:0.9rem; border-top:1px solid var(--border-glass); padding-top:10px;">
          <span>💜 Yape: S/ ${data.metodos.yape}</span>
          <span>💚 Plin: S/ ${data.metodos.plin}</span>
          <span>🏦 Banco: S/ ${data.metodos.transferencia}</span>
        </div>
      `;
    }
    
    resultDiv.innerHTML = `
      <div style="background:var(--card-bg); padding:var(--space-md); border-radius:var(--radius-md); border:1px solid var(--border-glass);">
        <h4 style="margin:0 0 10px 0; color:var(--text-secondary);">Resultados del ${desde} al ${hasta}</h4>
        <div style="font-size:1.5rem; font-weight:bold; color:var(--accent-green);">S/ ${data.total}</div>
        <div style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:10px;">${data.cantidad} reserva(s) confirmada(s)</div>
        ${metodosHtml}
      </div>
    `;
  } catch (error) {
    resultDiv.innerHTML = '<p class="text-danger">Error al obtener los datos</p>';
  }
};

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

// ==========================================
// Settings Dropdown
// ==========================================
function toggleSettings(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('settingsMenu');
  if (menu) menu.classList.toggle('active');
}

document.addEventListener('click', (event) => {
  const menu = document.getElementById('settingsMenu');
  const btn = document.getElementById('btnSettings');
  if (menu && menu.classList.contains('active') && !menu.contains(event.target) && event.target !== btn) {
    menu.classList.remove('active');
  }
});

// ==========================================
// Custom Confirm Dialog
// ==========================================
function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    // Add red theme for reject/cancel
    const btnYes = document.getElementById('btnConfirmYes');
    if (title.toLowerCase().includes('rechazar') || title.toLowerCase().includes('cancelar')) {
      btnYes.style.background = 'var(--accent-red)';
    } else {
      btnYes.style.background = 'var(--accent-blue)';
    }

    modal.classList.add('active');

    const handleYes = () => {
      cleanup();
      resolve(true);
    };
    
    const handleNo = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      document.getElementById('btnConfirmYes').removeEventListener('click', handleYes);
      document.getElementById('btnConfirmNo').removeEventListener('click', handleNo);
      modal.classList.remove('active');
    };

    document.getElementById('btnConfirmYes').addEventListener('click', handleYes);
    document.getElementById('btnConfirmNo').addEventListener('click', handleNo);
  });
}

// ==========================================
// Rango Section Collapse
// ==========================================
function toggleRangoCollapse() {
  const content = document.getElementById('rangoContent');
  const icon = document.getElementById('rangoIcon');
  if (content.style.display === 'none') {
    content.style.display = 'block';
    icon.style.transform = 'rotate(180deg)';
  } else {
    content.style.display = 'none';
    icon.style.transform = 'rotate(0deg)';
  }
}
