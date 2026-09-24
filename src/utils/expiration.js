const { supabase } = require('../database');

const EXPIRATION_MINUTES = 10;

/**
 * Check for expired pending reservations and mark them as expired.
 * This frees up the time slots for other customers.
 */
async function expireOldReservations() {
  const cutoff = new Date(Date.now() - EXPIRATION_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('voley_reservas')
    .update({ estado: 'expirada' })
    .eq('estado', 'pendiente')
    .lte('created_at', cutoff)
    .select('id');

  if (error) {
    console.error('Error expirando reservas:', error);
    return 0;
  }

  if (data.length > 0) {
    console.log(`⏱️  ${data.length} reserva(s) expirada(s) automáticamente`);
  }

  return data.length;
}

/**
 * Get the remaining time in seconds for a pending reservation
 * @param {string} createdAt - Reservation created_at timestamp
 * @returns {number} Seconds remaining, or 0 if expired
 */
function getTimeRemaining(createdAt) {
  const created = new Date(createdAt);
  const expiresAt = new Date(created.getTime() + EXPIRATION_MINUTES * 60 * 1000);
  const now = new Date();
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  return remaining;
}

module.exports = {
  EXPIRATION_MINUTES,
  expireOldReservations,
  getTimeRemaining
};
