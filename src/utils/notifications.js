const webpush = require('web-push');
const { supabase } = require('../database');

/**
 * Initialize VAPID keys for Web Push notifications
 */
function initializeWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'admin@voleyreservas.com';

  if (publicKey && privateKey) {
    webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey);
    return true;
  }
  console.warn('⚠️  VAPID keys not configured. Push notifications disabled.');
  return false;
}

/**
 * Save a push subscription for the admin
 * @param {object} subscription - Push subscription object from the browser
 */
async function saveSubscription(subscription) {
  const { error } = await supabase
    .from('voley_push_subscriptions')
    .insert({ subscription });

  if (error) throw error;
}

/**
 * Send push notification to all admin subscriptions
 * @param {string} title - Notification title
 * @param {object} data - Notification data
 */
async function sendPushNotification(title, data) {
  const { data: subscriptions, error } = await supabase
    .from('voley_push_subscriptions')
    .select('*');

  if (error) {
    console.error('Error obteniendo suscripciones:', error);
    return [];
  }

  const payload = JSON.stringify({
    title,
    body: data.body,
    icon: data.icon || '/img/icon-192.png',
    badge: data.badge || '/img/badge-72.png',
    data: data.url ? { url: data.url } : {},
    tag: data.tag || 'nueva-reserva',
    requireInteraction: true
  });

  const results = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub.subscription, payload);
      results.push({ id: sub.id, success: true });
    } catch (error) {
      // If subscription is expired or invalid, remove it
      if (error.statusCode === 410 || error.statusCode === 404) {
        await supabase.from('voley_push_subscriptions').delete().eq('id', sub.id);
      }
      results.push({ id: sub.id, success: false, error: error.message });
    }
  }
  return results;
}

/**
 * Format and send a new reservation notification
 * @param {object} reserva - Reservation data
 */
async function notifyNewReservation(reserva) {
  const horaInicioStr = `${reserva.hora_inicio}:00`;
  const horaFinStr = `${reserva.hora_fin}:00`;

  return sendPushNotification('🏐 Nueva Reserva', {
    body: `${reserva.nombre_cliente} - ${reserva.fecha} de ${horaInicioStr} a ${horaFinStr} - S/ ${reserva.monto_total}`,
    url: '/admin.html#pendientes',
    tag: `reserva-${reserva.id}`
  });
}

module.exports = {
  initializeWebPush,
  saveSubscription,
  sendPushNotification,
  notifyNewReservation
};
