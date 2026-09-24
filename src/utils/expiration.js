const { db } = require('../database');

const EXPIRATION_MINUTES = 10;

/**
 * Check for expired pending reservations and mark them as expired.
 * This frees up the time slots for other customers.
 */
function expireOldReservations() {
  const stmt = db.prepare(`
    UPDATE reservas 
    SET estado = 'expirada' 
    WHERE estado = 'pendiente' 
    AND datetime(created_at, '+${EXPIRATION_MINUTES} minutes') <= datetime('now', 'localtime')
  `);

  const result = stmt.run();

  if (result.changes > 0) {
    console.log(`⏱️  ${result.changes} reserva(s) expirada(s) automáticamente`);
  }

  return result.changes;
}

/**
 * Get the remaining time in seconds for a pending reservation
 * @param {object} reserva - Reservation object with created_at
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
