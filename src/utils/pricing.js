/**
 * Pricing utility for VoleyReservas
 * 
 * Tarifa Día (8am - 5pm): S/ 50 por hora
 * Tarifa Noche (6pm - 11pm): S/ 60 por hora
 */

const TARIFA_DIA = 50;   // S/ 50 por hora (8:00 - 17:00)
const TARIFA_NOCHE = 60;  // S/ 60 por hora (18:00 - 23:00)
const HORA_CAMBIO = 18;   // A partir de las 18:00 cambia la tarifa

/**
 * Calcula el precio de una hora específica
 * @param {number} hora - Hora (8-22, representa el inicio del bloque)
 * @returns {number} Precio de esa hora
 */
function precioHora(hora) {
  return hora >= HORA_CAMBIO ? TARIFA_NOCHE : TARIFA_DIA;
}

/**
 * Calcula el precio total de un bloque de horas
 * @param {number} horaInicio - Hora de inicio (8-22)
 * @param {number} horaFin - Hora de fin (9-23)
 * @returns {number} Precio total
 */
function calcularPrecioTotal(horaInicio, horaFin) {
  let total = 0;
  for (let h = horaInicio; h < horaFin; h++) {
    total += precioHora(h);
  }
  return total;
}

/**
 * Obtiene el desglose de precios por hora
 * @param {number} horaInicio 
 * @param {number} horaFin 
 * @returns {Array<{hora: number, precio: number}>}
 */
function desglosePrecios(horaInicio, horaFin) {
  const desglose = [];
  for (let h = horaInicio; h < horaFin; h++) {
    desglose.push({ hora: h, precio: precioHora(h) });
  }
  return desglose;
}

/**
 * Retorna la información de precios para el frontend
 */
function getInfoPrecios() {
  return {
    tarifaDia: TARIFA_DIA,
    tarifaNoche: TARIFA_NOCHE,
    horaCambio: HORA_CAMBIO,
    horaApertura: 8,
    horaCierre: 23
  };
}

module.exports = {
  TARIFA_DIA,
  TARIFA_NOCHE,
  HORA_CAMBIO,
  precioHora,
  calcularPrecioTotal,
  desglosePrecios,
  getInfoPrecios
};
