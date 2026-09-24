const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { supabase, COMPROBANTES_BUCKET } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { calcularPrecioTotal, getInfoPrecios, precioHora } = require('../utils/pricing');
const { notifyNewReservation } = require('../utils/notifications');
const { getTimeRemaining, expireOldReservations, EXPIRATION_MINUTES } = require('../utils/expiration');
const { todayStr, currentHour, maxDateStr } = require('../utils/datetime');

// Multer guarda en memoria: el filesystem de Vercel es de solo lectura,
// así que el archivo se sube directo a Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  // Vercel limita el body de una función serverless a ~4.5MB; el cliente
  // ya comprime la imagen antes de subirla, esto es solo defensa en
  // profundidad por si alguien llama al endpoint directamente.
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|heic/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'image/heic';
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (JPG, PNG, GIF, WebP, HEIC)'));
  }
});

// ==========================================
// PUBLIC ENDPOINTS (Clients)
// ==========================================

/**
 * GET /api/precios
 * Get pricing information
 */
router.get('/precios', (req, res) => {
  const info = getInfoPrecios();
  const horas = [];
  for (let h = info.horaApertura; h < info.horaCierre; h++) {
    horas.push({
      hora: h,
      horaStr: `${h.toString().padStart(2, '0')}:00`,
      horaFinStr: `${(h + 1).toString().padStart(2, '0')}:00`,
      precio: precioHora(h),
      tipo: h >= info.horaCambio ? 'noche' : 'dia'
    });
  }
  res.json({ ...info, horas });
});

/**
 * GET /api/disponibilidad/:fecha
 * Get available hours for a specific date
 */
router.get('/disponibilidad/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }

    // Check date is within allowed range (today to +14 days), en hora de Lima
    const today = todayStr();
    const maxDate = maxDateStr(14);

    if (fecha < today) {
      return res.status(400).json({ error: 'No se pueden ver fechas pasadas' });
    }
    if (fecha > maxDate) {
      return res.status(400).json({ error: 'Solo se pueden ver hasta 14 días en adelante' });
    }

    // No hay proceso cron persistente en serverless: expiramos al vuelo.
    await expireOldReservations();

    // Get occupied hours (confirmed + pending reservations)
    const { data: reservas, error } = await supabase
      .from('voley_reservas')
      .select('hora_inicio, hora_fin, estado')
      .eq('fecha', fecha)
      .in('estado', ['confirmada', 'pendiente']);

    if (error) throw error;

    // Build availability grid
    const info = getInfoPrecios();
    const disponibilidad = [];
    const isToday = fecha === today;
    const nowHour = currentHour();

    for (let h = info.horaApertura; h < info.horaCierre; h++) {
      let estado = 'disponible';

      // If today, mark past hours as unavailable
      if (isToday && h <= nowHour) {
        estado = 'pasado';
      } else {
        // Check if this hour is occupied
        for (const r of reservas) {
          if (h >= r.hora_inicio && h < r.hora_fin) {
            estado = r.estado === 'confirmada' ? 'ocupado' : 'pendiente';
            break;
          }
        }
      }

      disponibilidad.push({
        hora: h,
        horaStr: `${h.toString().padStart(2, '0')}:00`,
        horaFinStr: `${(h + 1).toString().padStart(2, '0')}:00`,
        precio: precioHora(h),
        estado,
        tipo: h >= info.horaCambio ? 'noche' : 'dia'
      });
    }

    res.json({ fecha, disponibilidad });
  } catch (error) {
    console.error('Error en disponibilidad:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * POST /api/reservas
 * Create a new reservation
 */
router.post('/reservas', upload.single('comprobante'), async (req, res) => {
  try {
    const { fecha, hora_inicio, hora_fin, nombre_cliente, telefono, metodo_pago } = req.body;

    // Validate required fields
    if (!fecha || !hora_inicio || !hora_fin || !nombre_cliente || !telefono || !metodo_pago) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'El comprobante de pago es requerido' });
    }

    const horaInicio = parseInt(hora_inicio);
    const horaFin = parseInt(hora_fin);

    // Validate hours
    if (horaInicio < 8 || horaFin > 23 || horaInicio >= horaFin) {
      return res.status(400).json({ error: 'Horario inválido' });
    }

    // Validate payment method
    if (!['yape', 'plin', 'transferencia'].includes(metodo_pago)) {
      return res.status(400).json({ error: 'Método de pago inválido' });
    }

    // Check date range, en hora de Lima
    const today = todayStr();
    const maxDate = maxDateStr(14);

    if (fecha < today || fecha > maxDate) {
      return res.status(400).json({ error: 'Fecha fuera del rango permitido' });
    }

    await expireOldReservations();

    // Check availability (no confirmed or pending reservations in the requested time)
    const { data: conflicts, error: conflictError } = await supabase
      .from('voley_reservas')
      .select('id')
      .eq('fecha', fecha)
      .in('estado', ['confirmada', 'pendiente'])
      .lt('hora_inicio', horaFin)
      .gt('hora_fin', horaInicio);

    if (conflictError) throw conflictError;

    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'El horario seleccionado ya no está disponible' });
    }

    // Calculate total price
    const montoTotal = calcularPrecioTotal(horaInicio, horaFin);

    // Upload receipt image to Supabase Storage
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname);
    const objectPath = `comprobante-${uniqueSuffix}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(COMPROBANTES_BUCKET)
      .upload(objectPath, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) throw uploadError;

    // Create reservation
    const { data: inserted, error: insertError } = await supabase
      .from('voley_reservas')
      .insert({
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        nombre_cliente,
        telefono,
        metodo_pago,
        comprobante_path: objectPath,
        monto_total: montoTotal,
        estado: 'pendiente'
      })
      .select()
      .single();

    if (insertError) {
      await supabase.storage.from(COMPROBANTES_BUCKET).remove([objectPath]);
      throw insertError;
    }

    const reserva = { ...inserted, expiration_minutes: EXPIRATION_MINUTES };

    // Send push notification to admin (non-blocking)
    notifyNewReservation(reserva).catch(err => {
      console.error('Error enviando notificación push:', err);
    });

    res.status(201).json({
      message: 'Reserva creada exitosamente. Pendiente de confirmación.',
      reserva
    });
  } catch (error) {
    console.error('Error creando reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/reservas/:id/estado
 * Check reservation status
 */
router.get('/reservas/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;

    await expireOldReservations();

    const { data: reserva, error } = await supabase
      .from('voley_reservas')
      .select('id, fecha, hora_inicio, hora_fin, nombre_cliente, monto_total, estado, created_at, confirmed_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const response = { ...reserva };
    if (reserva.estado === 'pendiente') {
      response.tiempo_restante = getTimeRemaining(reserva.created_at);
    }

    res.json(response);
  } catch (error) {
    console.error('Error consultando estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==========================================
// ADMIN ENDPOINTS (Protected)
// ==========================================

/**
 * GET /api/admin/reservas
 * List reservations with filters
 */
router.get('/admin/reservas', authenticateToken, async (req, res) => {
  try {
    const { fecha, estado, limit = 50, offset = 0 } = req.query;

    await expireOldReservations();

    let query = supabase.from('voley_reservas').select('*');

    if (fecha) query = query.eq('fecha', fecha);
    if (estado) query = query.eq('estado', estado);

    const from = parseInt(offset);
    const to = from + parseInt(limit) - 1;

    const { data: reservas, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    // Add time remaining for pending reservations
    const enriched = reservas.map(r => ({
      ...r,
      tiempo_restante: r.estado === 'pendiente' ? getTimeRemaining(r.created_at) : null
    }));

    res.json(enriched);
  } catch (error) {
    console.error('Error listando reservas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/admin/reservas/count
 * Lightweight count for tab badges, independent of the reservation list
 * currently being displayed/filtered in the UI.
 */
router.get('/admin/reservas/count', authenticateToken, async (req, res) => {
  try {
    const { fecha, estado } = req.query;

    let query = supabase.from('voley_reservas').select('id', { count: 'exact', head: true });
    if (fecha) query = query.eq('fecha', fecha);
    if (estado) query = query.eq('estado', estado);

    const { count, error } = await query;
    if (error) throw error;

    res.json({ count: count || 0 });
  } catch (error) {
    console.error('Error contando reservas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PUT /api/admin/reservas/:id/confirmar
 * Confirm a pending reservation
 */
router.put('/admin/reservas/:id/confirmar', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: reserva, error: fetchError } = await supabase
      .from('voley_reservas').select('*').eq('id', id).maybeSingle();

    if (fetchError) throw fetchError;

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({ error: `No se puede confirmar una reserva con estado "${reserva.estado}"` });
    }

    const { data: updated, error: updateError } = await supabase
      .from('voley_reservas')
      .update({ estado: 'confirmada', confirmed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Generate WhatsApp message
    const horaInicioStr = `${updated.hora_inicio}:00`;
    const horaFinStr = `${updated.hora_fin}:00`;
    const whatsappMsg = encodeURIComponent(
      `Hola ${updated.nombre_cliente} 👋\n\nTu reserva en VoleyReservas para el ${updated.fecha} de ${horaInicioStr} a ${horaFinStr} ha sido CONFIRMADA ✅\n\nMonto: S/ ${updated.monto_total}\n\n¡Te esperamos! 🏐`
    );
    const whatsappUrl = `https://wa.me/51${updated.telefono.replace(/\D/g, '')}?text=${whatsappMsg}`;

    res.json({
      message: 'Reserva confirmada exitosamente',
      reserva: updated,
      whatsapp_url: whatsappUrl
    });
  } catch (error) {
    console.error('Error confirmando reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PUT /api/admin/reservas/:id/rechazar
 * Reject a pending reservation
 */
router.put('/admin/reservas/:id/rechazar', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: reserva, error: fetchError } = await supabase
      .from('voley_reservas').select('*').eq('id', id).maybeSingle();

    if (fetchError) throw fetchError;

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({ error: `No se puede rechazar una reserva con estado "${reserva.estado}"` });
    }

    const { data: updated, error: updateError } = await supabase
      .from('voley_reservas')
      .update({ estado: 'rechazada' })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Generate WhatsApp message
    const horaInicioStr = `${updated.hora_inicio}:00`;
    const horaFinStr = `${updated.hora_fin}:00`;
    const whatsappMsg = encodeURIComponent(
      `Hola ${updated.nombre_cliente} 👋\n\nLamentablemente no pudimos confirmar tu reserva para el ${updated.fecha} de ${horaInicioStr} a ${horaFinStr}.\n\nPor favor verifica tu comprobante de pago e intenta nuevamente.\n\nVoleyReservas 🏐`
    );
    const whatsappUrl = `https://wa.me/51${updated.telefono.replace(/\D/g, '')}?text=${whatsappMsg}`;

    res.json({
      message: 'Reserva rechazada',
      reserva: updated,
      whatsapp_url: whatsappUrl
    });
  } catch (error) {
    console.error('Error rechazando reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PUT /api/admin/reservas/:id/cancelar
 * Cancel a confirmed reservation
 */
router.put('/admin/reservas/:id/cancelar', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: reserva, error: fetchError } = await supabase
      .from('voley_reservas').select('*').eq('id', id).maybeSingle();

    if (fetchError) throw fetchError;

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.estado !== 'confirmada') {
      return res.status(400).json({ error: `Solo se pueden cancelar reservas confirmadas` });
    }

    const { data: updated, error: updateError } = await supabase
      .from('voley_reservas')
      .update({ estado: 'cancelada' })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      message: 'Reserva cancelada',
      reserva: updated
    });
  } catch (error) {
    console.error('Error cancelando reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/admin/reservas/:id/comprobante
 * Get receipt image for a reservation
 */
router.get('/admin/reservas/:id/comprobante', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: reserva, error } = await supabase
      .from('voley_reservas').select('comprobante_path').eq('id', id).maybeSingle();

    if (error) throw error;

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(COMPROBANTES_BUCKET)
      .download(reserva.comprobante_path);

    if (downloadError || !file) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    res.setHeader('Content-Type', file.type || 'application/octet-stream');
    res.send(buffer);
  } catch (error) {
    console.error('Error obteniendo comprobante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/admin/ingresos
 * Get income summary
 */
router.get('/admin/ingresos', authenticateToken, async (req, res) => {
  try {
    const today = todayStr();

    const [y, m] = today.split('-');
    const monthStart = `${y}-${m}-01`;

    const [sy, sm, sd] = today.split('-').map(Number);
    const sevenDaysAgoDate = new Date(Date.UTC(sy, sm - 1, sd));
    sevenDaysAgoDate.setUTCDate(sevenDaysAgoDate.getUTCDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgoDate.toISOString().slice(0, 10);

    const [
      { data: diarioRows, error: e1 },
      { data: semanalRows, error: e2 },
      { data: mensualRows, error: e3 },
      { count: pendientes, error: e4 },
      { count: reservasHoy, error: e5 },
      { data: desgloseRaw, error: e6 }
    ] = await Promise.all([
      supabase.from('voley_reservas').select('monto_total').eq('fecha', today).eq('estado', 'confirmada'),
      supabase.from('voley_reservas').select('monto_total').gte('fecha', sevenDaysAgoStr).eq('estado', 'confirmada'),
      supabase.from('voley_reservas').select('monto_total').gte('fecha', monthStart).eq('estado', 'confirmada'),
      supabase.from('voley_reservas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
      supabase.from('voley_reservas').select('id', { count: 'exact', head: true }).eq('fecha', today).eq('estado', 'confirmada'),
      supabase.from('voley_reservas').select('fecha, monto_total').gte('fecha', sevenDaysAgoStr).eq('estado', 'confirmada').order('fecha', { ascending: true })
    ]);

    const firstError = e1 || e2 || e3 || e4 || e5 || e6;
    if (firstError) throw firstError;

    const sum = rows => rows.reduce((acc, r) => acc + Number(r.monto_total), 0);

    const desgloseMap = {};
    for (const r of desgloseRaw) {
      if (!desgloseMap[r.fecha]) desgloseMap[r.fecha] = { fecha: r.fecha, total: 0, cantidad: 0 };
      desgloseMap[r.fecha].total += Number(r.monto_total);
      desgloseMap[r.fecha].cantidad += 1;
    }

    res.json({
      diario: { total: sum(diarioRows), cantidad: diarioRows.length },
      semanal: { total: sum(semanalRows), cantidad: semanalRows.length },
      mensual: { total: sum(mensualRows), cantidad: mensualRows.length },
      desglose_diario: Object.values(desgloseMap),
      pendientes: pendientes || 0,
      reservas_hoy: reservasHoy || 0
    });
  } catch (error) {
    console.error('Error obteniendo ingresos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/admin/ingresos/rango
 * Income summary for an arbitrary custom date range (e.g. a past month
 * or a specific week), for consolidated reports beyond the fixed
 * día/semana/mes windows of /api/admin/ingresos.
 */
router.get('/admin/ingresos/rango', authenticateToken, async (req, res) => {
  try {
    const { desde, hasta } = req.query;

    if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return res.status(400).json({ error: 'Parámetros "desde" y "hasta" inválidos (formato YYYY-MM-DD)' });
    }

    if (desde > hasta) {
      return res.status(400).json({ error: 'La fecha "desde" no puede ser posterior a "hasta"' });
    }

    const { data: rows, error } = await supabase
      .from('voley_reservas')
      .select('fecha, monto_total')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .eq('estado', 'confirmada')
      .order('fecha', { ascending: true });

    if (error) throw error;

    const desgloseMap = {};
    for (const r of rows) {
      if (!desgloseMap[r.fecha]) desgloseMap[r.fecha] = { fecha: r.fecha, total: 0, cantidad: 0 };
      desgloseMap[r.fecha].total += Number(r.monto_total);
      desgloseMap[r.fecha].cantidad += 1;
    }

    res.json({
      desde,
      hasta,
      total: rows.reduce((acc, r) => acc + Number(r.monto_total), 0),
      cantidad: rows.length,
      desglose: Object.values(desgloseMap)
    });
  } catch (error) {
    console.error('Error obteniendo ingresos por rango:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
