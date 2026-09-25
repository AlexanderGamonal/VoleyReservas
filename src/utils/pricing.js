const { supabase } = require('../database');

/**
 * Obtiene la configuración desde la base de datos
 */
async function getConfig() {
  const { data, error } = await supabase
    .from('voley_config')
    .select('hora_inicio_atencion, hora_fin_atencion, dias_max_reserva, precio_dia, precio_noche, hora_inicio_noche')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    return {
      horaApertura: 8,
      horaCierre: 23,
      diasMax: 14,
      precioDia: 50,
      precioNoche: 60,
      horaCambio: 18
    };
  }

  return {
    horaApertura: data.hora_inicio_atencion ?? 8,
    horaCierre: data.hora_fin_atencion ?? 23,
    diasMax: data.dias_max_reserva ?? 14,
    precioDia: data.precio_dia ?? 50,
    precioNoche: data.precio_noche ?? 60,
    horaCambio: data.hora_inicio_noche ?? 18
  };
}

/**
 * Calcula el precio de una hora específica
 */
function precioHora(hora, config) {
  return hora >= config.horaCambio ? config.precioNoche : config.precioDia;
}

/**
 * Calcula el precio total de un bloque de horas
 */
function calcularPrecioTotal(horaInicio, horaFin, config) {
  let total = 0;
  for (let h = horaInicio; h < horaFin; h++) {
    total += precioHora(h, config);
  }
  return total;
}

/**
 * Obtiene el desglose de precios por hora
 */
function desglosePrecios(horaInicio, horaFin, config) {
  const desglose = [];
  for (let h = horaInicio; h < horaFin; h++) {
    desglose.push({ hora: h, precio: precioHora(h, config) });
  }
  return desglose;
}

/**
 * Retorna la información de precios para el frontend
 */
async function getInfoPrecios() {
  return await getConfig();
}

module.exports = {
  getConfig,
  precioHora,
  calcularPrecioTotal,
  desglosePrecios,
  getInfoPrecios
};
