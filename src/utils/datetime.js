/**
 * Fecha/hora del negocio en zona horaria de Lima (America/Lima, UTC-5, sin DST).
 *
 * Vercel ejecuta las funciones serverless en UTC, así que usar Date/local
 * del servidor para decidir "hoy" o "la hora actual" desincroniza al
 * cliente (que usa la hora real del dispositivo en Perú) del backend,
 * sobre todo entre las 7pm y medianoche hora Perú (00:00-05:00 UTC).
 */

const TIMEZONE = 'America/Lima';

/**
 * Fecha de "hoy" en Lima, formato YYYY-MM-DD
 */
function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

/**
 * Hora actual (0-23) en Lima
 */
function currentHour() {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(new Date())
  );
}

/**
 * Fecha máxima permitida para reservar (YYYY-MM-DD), N días después de hoy en Lima
 */
function maxDateStr(daysAhead) {
  const [y, m, d] = todayStr().split('-').map(Number);
  const max = new Date(Date.UTC(y, m - 1, d));
  max.setUTCDate(max.getUTCDate() + daysAhead);
  return max.toISOString().slice(0, 10);
}

module.exports = { TIMEZONE, todayStr, currentHour, maxDateStr };
