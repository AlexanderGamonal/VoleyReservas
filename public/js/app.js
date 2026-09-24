/**
 * VoleyReservas - Client Application
 * Handles date selection, time slots, booking form, and reservation status
 */

// ==========================================
// State
// ==========================================
const state = {
  selectedDate: null,
  selectedSlots: [],
  paymentMethod: 'yape',
  paymentConfig: {},
  selectedFile: null,
  availability: [],
  currentReservationId: null
};

const API_BASE = '';

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initDatePicker();
  loadPaymentConfig();
  registerServiceWorker();
  initInstallBanner();
});

/**
 * Registra el service worker para que la app sea instalable (PWA) y
 * tenga el shell estático disponible sin conexión. No maneja push aquí:
 * eso solo aplica al panel admin (ver public/js/admin.js).
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.error('Error registrando service worker:', error);
  });
}

// ==========================================
// Install Banner (PWA)
// ==========================================
// Chrome ya no muestra siempre el mini-infobar automático de instalación
// (heurísticas de "engagement" del navegador, versión, o si ya se
// descartó antes) — por eso se ofrece un botón propio: se escucha
// beforeinstallprompt y se guarda el evento para dispararlo al clic.
let deferredInstallPrompt = null;

function initInstallBanner() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isStandalone) return;

  let dismissed = false;
  try { dismissed = localStorage.getItem('voley_install_dismissed') === '1'; } catch (e) { /* ignore */ }
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

function dismissInstallBanner() {
  document.getElementById('installBanner').style.display = 'none';
  try { localStorage.setItem('voley_install_dismissed', '1'); } catch (e) { /* ignore */ }
}

// ==========================================
// Payment Config
// ==========================================
async function loadPaymentConfig() {
  try {
    const response = await fetch(`${API_BASE}/api/config-pago`);
    if (!response.ok) return;
    state.paymentConfig = await response.json();
    renderPaymentInfo();
  } catch (error) {
    console.error('Error cargando datos de pago:', error);
  }
}

function renderPaymentInfo() {
  const container = document.getElementById('paymentInfo');
  if (!container) return;

  const cfg = state.paymentConfig || {};
  let html = '';

  if (state.paymentMethod === 'yape') {
    html = cfg.yape_numero
      ? `<div class="payment-info-row"><span>💜 Yape</span><strong>${escapeHtml(cfg.yape_numero)}</strong></div>${cfg.yape_titular ? `<div class="payment-info-sub">A nombre de ${escapeHtml(cfg.yape_titular)}</div>` : ''}`
      : `<div class="payment-info-empty">El administrador aún no configuró el número de Yape.</div>`;
  } else if (state.paymentMethod === 'plin') {
    html = cfg.plin_numero
      ? `<div class="payment-info-row"><span>💚 Plin</span><strong>${escapeHtml(cfg.plin_numero)}</strong></div>${cfg.plin_titular ? `<div class="payment-info-sub">A nombre de ${escapeHtml(cfg.plin_titular)}</div>` : ''}`
      : `<div class="payment-info-empty">El administrador aún no configuró el número de Plin.</div>`;
  } else if (state.paymentMethod === 'transferencia') {
    if (cfg.banco_numero_cuenta) {
      html = `
        <div class="payment-info-row"><span>🏦 ${escapeHtml(cfg.banco_nombre || 'Banco')}</span><strong>${escapeHtml(cfg.banco_numero_cuenta)}</strong></div>
        ${cfg.banco_cci ? `<div class="payment-info-sub">CCI: ${escapeHtml(cfg.banco_cci)}</div>` : ''}
        ${cfg.banco_titular ? `<div class="payment-info-sub">A nombre de ${escapeHtml(cfg.banco_titular)}</div>` : ''}
      `;
    } else {
      html = `<div class="payment-info-empty">El administrador aún no configuró la cuenta bancaria.</div>`;
    }
  }

  container.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// Date Picker
// ==========================================
function initDatePicker() {
  const container = document.getElementById('datePicker');
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  const today = new Date();
  
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    const dateStr = formatDate(date);
    const isToday = i === 0;
    
    const card = document.createElement('div');
    card.className = `date-card${isToday ? ' today' : ''}${isToday ? ' active' : ''}`;
    card.dataset.date = dateStr;
    card.onclick = () => selectDate(dateStr, card);
    
    card.innerHTML = `
      <span class="day-name">${days[date.getDay()]}</span>
      <span class="day-number">${date.getDate()}</span>
      <span class="month-name">${months[date.getMonth()]}</span>
    `;
    
    container.appendChild(card);
  }

  // Select today by default
  selectDate(formatDate(today));
}

function selectDate(dateStr, card) {
  // Update active state
  document.querySelectorAll('.date-card').forEach(c => c.classList.remove('active'));
  if (card) {
    card.classList.add('active');
  } else {
    document.querySelector(`[data-date="${dateStr}"]`)?.classList.add('active');
  }

  state.selectedDate = dateStr;
  state.selectedSlots = [];
  updateSelectionSummary();
  loadAvailability(dateStr);
}

// ==========================================
// Time Slots
// ==========================================
async function loadAvailability(date) {
  const grid = document.getElementById('timeGrid');
  
  // Show loading
  grid.innerHTML = `
    <div class="loading-slot"></div>
    <div class="loading-slot"></div>
    <div class="loading-slot"></div>
    <div class="loading-slot"></div>
    <div class="loading-slot"></div>
    <div class="loading-slot"></div>
  `;

  try {
    const response = await fetch(`${API_BASE}/api/disponibilidad/${date}`);
    if (!response.ok) throw new Error('Error cargando disponibilidad');
    
    const data = await response.json();
    state.availability = data.disponibilidad;
    renderTimeSlots();
  } catch (error) {
    console.error('Error:', error);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <div class="empty-icon">😕</div>
        <div class="empty-text">Error al cargar horarios. Intenta de nuevo.</div>
      </div>
    `;
  }
}

function renderTimeSlots() {
  const grid = document.getElementById('timeGrid');
  grid.innerHTML = '';

  if (!state.availability || state.availability.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <div class="empty-icon">📅</div>
        <div class="empty-text">No hay horarios disponibles para esta fecha</div>
      </div>
    `;
    return;
  }

  state.availability.forEach(slot => {
    const div = document.createElement('div');
    const isSelected = state.selectedSlots.includes(slot.hora);
    
    let statusClass = '';
    let statusText = '';
    
    switch (slot.estado) {
      case 'disponible':
        statusClass = isSelected ? 'selected' : '';
        statusText = isSelected ? '✓ Seleccionado' : '';
        break;
      case 'ocupado':
        statusClass = 'occupied';
        statusText = 'Ocupado';
        break;
      case 'pendiente':
        statusClass = 'pending';
        statusText = 'Reservando...';
        break;
      case 'pasado':
        statusClass = 'past';
        statusText = 'Pasado';
        break;
    }

    div.className = `time-slot ${slot.tipo} ${statusClass}`;
    div.dataset.hora = slot.hora;
    
    div.innerHTML = `
      <div class="check-icon">✓</div>
      <span class="time-range">${slot.horaStr}</span>
      <span class="time-price">S/ ${slot.precio}</span>
      ${statusText ? `<span class="time-status">${statusText}</span>` : ''}
    `;

    if (slot.estado === 'disponible') {
      div.onclick = () => toggleSlot(slot.hora);
    }

    grid.appendChild(div);
  });
}

function toggleSlot(hora) {
  const index = state.selectedSlots.indexOf(hora);
  
  if (index > -1) {
    state.selectedSlots.splice(index, 1);
  } else {
    state.selectedSlots.push(hora);
  }

  // Sort slots
  state.selectedSlots.sort((a, b) => a - b);

  // Validate consecutive slots
  if (state.selectedSlots.length > 1) {
    if (!areConsecutive(state.selectedSlots)) {
      showToast('Las horas deben ser consecutivas', 'error');
      // Remove the last added slot
      if (index > -1) {
        state.selectedSlots.splice(index, 0, hora);
      } else {
        state.selectedSlots.splice(state.selectedSlots.indexOf(hora), 1);
      }
      return;
    }
  }

  renderTimeSlots();
  updateSelectionSummary();
}

function areConsecutive(slots) {
  if (slots.length <= 1) return true;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] - slots[i - 1] !== 1) return false;
  }
  return true;
}

// ==========================================
// Selection Summary
// ==========================================
function updateSelectionSummary() {
  const summary = document.getElementById('selectionSummary');
  const hoursText = document.getElementById('selectionHours');
  const totalText = document.getElementById('selectionTotal');

  if (state.selectedSlots.length === 0) {
    summary.classList.remove('visible');
    return;
  }

  summary.classList.add('visible');

  const total = calculateTotal();
  const count = state.selectedSlots.length;
  const startHour = Math.min(...state.selectedSlots);
  const endHour = Math.max(...state.selectedSlots) + 1;

  hoursText.textContent = `${count} hora${count > 1 ? 's' : ''} · ${formatHour(startHour)} a ${formatHour(endHour)}`;
  totalText.textContent = total;
}

function calculateTotal() {
  let total = 0;
  for (const hora of state.selectedSlots) {
    const slot = state.availability.find(s => s.hora === hora);
    if (slot) total += slot.precio;
  }
  return total;
}

// ==========================================
// Booking Modal
// ==========================================
function openBookingModal() {
  if (state.selectedSlots.length === 0) return;

  const modal = document.getElementById('bookingModal');
  const summary = document.getElementById('bookingSummary');

  const startHour = Math.min(...state.selectedSlots);
  const endHour = Math.max(...state.selectedSlots) + 1;
  const total = calculateTotal();
  
  // Format date nicely
  const dateObj = new Date(state.selectedDate + 'T12:00:00');
  const dateFormatted = dateObj.toLocaleDateString('es-PE', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });

  // Build price breakdown
  let breakdown = '';
  state.selectedSlots.forEach(hora => {
    const slot = state.availability.find(s => s.hora === hora);
    breakdown += `
      <div class="booking-summary-row">
        <span class="label">${slot.horaStr} - ${slot.horaFinStr}</span>
        <span class="value">S/ ${slot.precio}</span>
      </div>
    `;
  });

  summary.innerHTML = `
    <div class="booking-summary-row">
      <span class="label">📅 Fecha</span>
      <span class="value">${dateFormatted}</span>
    </div>
    <div class="booking-summary-row">
      <span class="label">⏰ Horario</span>
      <span class="value">${formatHour(startHour)} - ${formatHour(endHour)}</span>
    </div>
    ${breakdown}
    <div class="booking-summary-row total">
      <span class="label">💰 Total</span>
      <span class="value">S/ ${total}</span>
    </div>
  `;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// ==========================================
// Payment Method
// ==========================================
function selectPayment(method) {
  state.paymentMethod = method;
  document.querySelectorAll('.payment-method').forEach(el => {
    el.classList.toggle('active', el.dataset.method === method);
  });
  renderPaymentInfo();
}

// ==========================================
// File Upload
// ==========================================
function triggerFileInput(source) {
  const inputId = source === 'camera' ? 'inputFileCamera' : 'inputFileGallery';
  document.getElementById(inputId).click();
}

// Vercel limita el tamaño del body de una función serverless a ~4.5MB;
// una foto de cámara sin comprimir (5-15MB) supera eso y el POST falla
// con un error de red genérico ("Failed to fetch") antes de llegar al
// backend. Por eso comprimimos la imagen en el navegador antes de subirla.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_RAW_BYTES = 30 * 1024 * 1024;

function showUploadState(view) {
  document.getElementById('uploadEmpty').style.display = view === 'empty' ? '' : 'none';
  document.getElementById('uploadProcessing').style.display = view === 'processing' ? '' : 'none';
  document.getElementById('uploadPreviewWrap').style.display = view === 'preview' ? '' : 'none';
  document.getElementById('uploadArea').classList.toggle('has-file', view === 'preview');
}

async function previewFile(event) {
  const file = event.target.files[0];

  if (!file) return;

  if (file.size > MAX_RAW_BYTES) {
    showToast('El archivo es demasiado grande. Máximo 30MB.', 'error');
    event.target.value = '';
    return;
  }

  showUploadState('processing');

  let finalFile = file;
  try {
    finalFile = await compressImage(file);
  } catch (error) {
    console.error('Error comprimiendo imagen:', error);
    finalFile = file;
  }

  if (finalFile.size > MAX_UPLOAD_BYTES) {
    showToast('La foto sigue siendo muy pesada. Prueba con otra o recórtala.', 'error');
    clearFileInputs();
    showUploadState('empty');
    return;
  }

  state.selectedFile = finalFile;

  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('uploadPreviewImg').src = e.target.result;
    showUploadState('preview');
  };
  reader.readAsDataURL(finalFile);
}

/**
 * Reduce dimensiones/peso de una foto usando canvas antes de subirla.
 * Si el navegador no soporta createImageBitmap o falla (p.ej. HEIC en
 * algunos Chrome), se devuelve el archivo original sin tocar.
 */
function compressImage(file, maxDimension = 1280, quality = 0.7) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') {
      resolve(file);
      return;
    }

    createImageBitmap(file)
      .then((bitmap) => {
        const { width, height } = bitmap;

        if (width <= maxDimension && height <= maxDimension && file.size <= MAX_UPLOAD_BYTES) {
          bitmap.close?.();
          resolve(file);
          return;
        }

        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const targetW = Math.round(width * scale);
        const targetH = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close?.();

        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const jpgName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], jpgName, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      })
      .catch(() => resolve(file));
  });
}

function clearFileInputs() {
  document.getElementById('inputFileCamera').value = '';
  document.getElementById('inputFileGallery').value = '';
}

function removeFile(event) {
  event.stopPropagation();
  state.selectedFile = null;
  clearFileInputs();
  document.getElementById('uploadPreviewImg').src = '';
  showUploadState('empty');
}

// ==========================================
// Submit Booking
// ==========================================
async function submitBooking(event) {
  event.preventDefault();

  const name = document.getElementById('inputName').value.trim();
  const phone = document.getElementById('inputPhone').value.trim();
  const submitBtn = document.getElementById('btnSubmit');

  // Validate
  if (!name) return showToast('Ingresa tu nombre', 'error');
  if (!phone || phone.length !== 9) return showToast('Ingresa un teléfono válido de 9 dígitos', 'error');
  if (!state.selectedFile) return showToast('Sube el comprobante de pago', 'error');

  const startHour = Math.min(...state.selectedSlots);
  const endHour = Math.max(...state.selectedSlots) + 1;

  // Build form data
  const formData = new FormData();
  formData.append('fecha', state.selectedDate);
  formData.append('hora_inicio', startHour);
  formData.append('hora_fin', endHour);
  formData.append('nombre_cliente', name);
  formData.append('telefono', phone);
  formData.append('metodo_pago', state.paymentMethod);
  formData.append('comprobante', state.selectedFile);

  // Disable button
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner"></div><span>Enviando...</span>';

  try {
    const data = await postReservaConReintento(formData);

    // Success!
    state.currentReservationId = data.reserva.id;
    closeBookingModal();
    showStatusScreen(data.reserva);
    showToast('¡Reserva enviada! Esperando confirmación...', 'success');

  } catch (error) {
    console.error('Error:', error);
    let message = error.message;
    if (error.name === 'AbortError') {
      message = 'La conexión tardó demasiado. Verifica tu internet e intenta de nuevo.';
    } else if (message === 'Failed to fetch') {
      message = 'No se pudo conectar con el servidor. Verifica tu internet e intenta de nuevo.';
    }
    showToast(message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Enviar Reserva</span><span>✉️</span>';
  }
}

/**
 * Envía la reserva con un reintento automático: en redes móviles es común
 * que la primera request de una conexión falle a nivel de red ("Failed to
 * fetch") sin llegar siquiera al servidor. Un solo reintento silencioso
 * resuelve la mayoría de esos casos sin molestar al usuario.
 */
async function postReservaConReintento(formData, attempt = 1) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${API_BASE}/api/reservas`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Error al crear la reserva');
    }

    return data;
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch';
    if (isNetworkError && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return postReservaConReintento(formData, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==========================================
// Status Screen
// ==========================================
function showStatusScreen(reserva) {
  const bookingView = document.getElementById('bookingView');
  const statusScreen = document.getElementById('statusScreen');
  const selectionSummary = document.getElementById('selectionSummary');

  bookingView.style.display = 'none';
  selectionSummary.classList.remove('visible');
  statusScreen.classList.add('active');

  const dateObj = new Date(reserva.fecha + 'T12:00:00');
  const dateFormatted = dateObj.toLocaleDateString('es-PE', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });

  statusScreen.innerHTML = `
    <div class="status-icon">⏳</div>
    <h2 class="status-title">Reserva Pendiente</h2>
    <p class="status-message">
      Tu reserva ha sido enviada. El administrador verificará tu comprobante de pago y confirmará la reserva.
    </p>
    <div class="countdown" id="countdown">
      <span class="countdown-icon">⏱️</span>
      <span id="countdownText">Esperando confirmación...</span>
    </div>
    <div class="status-details">
      <div class="detail-row">
        <span class="detail-label">ID Reserva</span>
        <span class="detail-value">#${reserva.id}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Fecha</span>
        <span class="detail-value">${dateFormatted}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Horario</span>
        <span class="detail-value">${formatHour(reserva.hora_inicio)} - ${formatHour(reserva.hora_fin)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Monto</span>
        <span class="detail-value" style="color: var(--accent-green)">S/ ${reserva.monto_total}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Estado</span>
        <span class="detail-value" id="statusBadge" style="color: var(--accent-yellow)">🟡 Pendiente</span>
      </div>
    </div>
    <button class="btn-new-reservation" onclick="resetBooking()">
      <span>Nueva Reserva</span>
      <span>🏐</span>
    </button>
  `;

  // Start polling for status
  startStatusPolling(reserva.id);
}

let statusPollInterval = null;

function startStatusPolling(reservaId) {
  if (statusPollInterval) clearInterval(statusPollInterval);

  statusPollInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/reservas/${reservaId}/estado`);
      const data = await response.json();

      const statusBadge = document.getElementById('statusBadge');
      const countdownText = document.getElementById('countdownText');
      const statusIcon = document.querySelector('.status-icon');
      const statusTitle = document.querySelector('.status-title');
      const statusMessage = document.querySelector('.status-message');
      const countdown = document.getElementById('countdown');

      switch (data.estado) {
        case 'confirmada':
          clearInterval(statusPollInterval);
          statusIcon.textContent = '✅';
          statusTitle.textContent = '¡Reserva Confirmada!';
          statusMessage.textContent = 'Tu reserva ha sido confirmada. ¡Te esperamos en la cancha!';
          statusBadge.innerHTML = '🟢 Confirmada';
          statusBadge.style.color = 'var(--accent-green)';
          countdown.style.display = 'none';
          showToast('¡Tu reserva ha sido confirmada! 🎉', 'success');
          break;

        case 'rechazada':
          clearInterval(statusPollInterval);
          statusIcon.textContent = '❌';
          statusTitle.textContent = 'Reserva Rechazada';
          statusMessage.textContent = 'Tu reserva no pudo ser confirmada. Por favor verifica tu comprobante de pago e intenta nuevamente.';
          statusBadge.innerHTML = '🔴 Rechazada';
          statusBadge.style.color = 'var(--accent-red)';
          countdown.style.display = 'none';
          break;

        case 'expirada':
          clearInterval(statusPollInterval);
          statusIcon.textContent = '⏰';
          statusTitle.textContent = 'Reserva Expirada';
          statusMessage.textContent = 'El tiempo de confirmación ha expirado. Por favor intenta nuevamente.';
          statusBadge.innerHTML = '⚫ Expirada';
          statusBadge.style.color = 'var(--text-muted)';
          countdown.style.display = 'none';
          break;

        case 'pendiente':
          if (data.tiempo_restante !== undefined) {
            const minutes = Math.floor(data.tiempo_restante / 60);
            const seconds = data.tiempo_restante % 60;
            countdownText.textContent = `Tiempo restante: ${minutes}:${seconds.toString().padStart(2, '0')}`;
          }
          break;
      }
    } catch (error) {
      console.error('Error polling status:', error);
    }
  }, 3000); // Poll every 3 seconds
}

function resetBooking() {
  if (statusPollInterval) clearInterval(statusPollInterval);

  const bookingView = document.getElementById('bookingView');
  const statusScreen = document.getElementById('statusScreen');

  statusScreen.classList.remove('active');
  bookingView.style.display = '';

  // Reset form
  document.getElementById('bookingForm').reset();
  removeFile(new Event('click'));
  selectPayment('yape');
  
  // Reset state
  state.selectedSlots = [];
  state.currentReservationId = null;
  
  // Reload availability
  if (state.selectedDate) {
    loadAvailability(state.selectedDate);
  }
  updateSelectionSummary();
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
  
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// ==========================================
// Utility Functions
// ==========================================
function formatDate(date) {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function formatHour(hour) {
  if (hour === 0 || hour === 24) return '12:00 am';
  if (hour === 12) return '12:00 pm';
  if (hour < 12) return `${hour}:00 am`;
  return `${hour - 12}:00 pm`;
}
