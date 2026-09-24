const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { db } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { calcularPrecioTotal, getInfoPrecios, precioHora } = require('../utils/pricing');
const { notifyNewReservation } = require('../utils/notifications');
const { getTimeRemaining, EXPIRATION_MINUTES } = require('../utils/expiration');

// Configure multer for file uploads
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `comprobante-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
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
router.get('/disponibilidad/:fecha', (req, res) => {
  try {
    const { fecha } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }

    // Check date is within allowed range (today to +14 days)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(fecha + 'T00:00:00');
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 14);

    if (requestedDate < today) {
      return res.status(400).json({ error: 'No se pueden ver fechas pasadas' });
    }
    if (requestedDate > maxDate) {
      return res.status(400).json({ error: 'Solo se pueden ver hasta 14 días en adelante' });
    }

    // Get occupied hours (confirmed + pending reservations)
    const reservas = db.prepare(`
      SELECT hora_inicio, hora_fin, estado
      FROM reservas 
      WHERE fecha = ? AND estado IN ('confirmada', 'pendiente')
    `).all(fecha);

    // Build availability grid
    const info = getInfoPrecios();
    const disponibilidad = [];
    const now = new Date();
    const isToday = fecha === now.toLocaleDateString('en-CA'); // YYYY-MM-DD format

    for (let h = info.horaApertura; h < info.horaCierre; h++) {
      let estado = 'disponible';

      // If today, mark past hours as unavailable
      if (isToday && h <= now.getHours()) {
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

    // Check date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(fecha + 'T00:00:00');
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 14);

    if (requestedDate < today || requestedDate > maxDate) {
      return res.status(400).json({ error: 'Fecha fuera del rango permitido' });
    }

    // Check availability (no confirmed or pending reservations in the requested time)
    const conflicts = db.prepare(`
      SELECT id FROM reservas 
      WHERE fecha = ? 
      AND estado IN ('confirmada', 'pendiente')
      AND hora_inicio < ? 
      AND hora_fin > ?
    `).all(fecha, horaFin, horaInicio);

    if (conflicts.length > 0) {
      // Clean up uploaded file
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: 'El horario seleccionado ya no está disponible' });
    }

    // Calculate total price
    const montoTotal = calcularPrecioTotal(horaInicio, horaFin);

    // Create reservation
    const stmt = db.prepare(`
      INSERT INTO reservas (fecha, hora_inicio, hora_fin, nombre_cliente, telefono, metodo_pago, comprobante_path, monto_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(fecha, horaInicio, horaFin, nombre_cliente, telefono, metodo_pago, req.file.filename, montoTotal);

    const reserva = {
      id: result.lastInsertRowid,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      nombre_cliente,
      telefono,
      metodo_pago,
      monto_total: montoTotal,
      estado: 'pendiente',
      expiration_minutes: EXPIRATION_MINUTES
    };

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
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/reservas/:id/estado
 * Check reservation status
 */
router.get('/reservas/:id/estado', (req, res) => {
  try {
    const { id } = req.params;
    const reserva = db.prepare(`
      SELECT id, fecha, hora_inicio, hora_fin, nombre_cliente, monto_total, estado, created_at, confirmed_at
      FROM reservas WHERE id = ?
    `).get(id);

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
router.get('/admin/reservas', authenticateToken, (req, res) => {
  try {
    const { fecha, estado, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM reservas WHERE 1=1';
    const params = [];

    if (fecha) {
      query += ' AND fecha = ?';
      params.push(fecha);
    }

    if (estado) {
      query += ' AND estado = ?';
      params.push(estado);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const reservas = db.prepare(query).all(...params);

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
 * PUT /api/admin/reservas/:id/confirmar
 * Confirm a pending reservation
 */
router.put('/admin/reservas/:id/confirmar', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({ error: `No se puede confirmar una reserva con estado "${reserva.estado}"` });
    }

    db.prepare(`
      UPDATE reservas SET estado = 'confirmada', confirmed_at = datetime('now', 'localtime') WHERE id = ?
    `).run(id);

    const updated = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

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
router.put('/admin/reservas/:id/rechazar', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({ error: `No se puede rechazar una reserva con estado "${reserva.estado}"` });
    }

    db.prepare("UPDATE reservas SET estado = 'rechazada' WHERE id = ?").run(id);

    const updated = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

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
router.put('/admin/reservas/:id/cancelar', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.estado !== 'confirmada') {
      return res.status(400).json({ error: `Solo se pueden cancelar reservas confirmadas` });
    }

    db.prepare("UPDATE reservas SET estado = 'cancelada' WHERE id = ?").run(id);

    const updated = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

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
router.get('/admin/reservas/:id/comprobante', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const reserva = db.prepare('SELECT comprobante_path FROM reservas WHERE id = ?').get(id);

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const filePath = path.join(UPLOADS_DIR, reserva.comprobante_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error('Error obteniendo comprobante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/admin/ingresos
 * Get income summary
 */
router.get('/admin/ingresos', authenticateToken, (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA');

    // Daily income
    const ingresoDiario = db.prepare(`
      SELECT COALESCE(SUM(monto_total), 0) as total, COUNT(*) as cantidad
      FROM reservas WHERE fecha = ? AND estado = 'confirmada'
    `).get(today);

    // Weekly income (last 7 days)
    const ingresoSemanal = db.prepare(`
      SELECT COALESCE(SUM(monto_total), 0) as total, COUNT(*) as cantidad
      FROM reservas 
      WHERE fecha >= date('now', 'localtime', '-7 days') 
      AND estado = 'confirmada'
    `).get();

    // Monthly income (current month)
    const ingresoMensual = db.prepare(`
      SELECT COALESCE(SUM(monto_total), 0) as total, COUNT(*) as cantidad
      FROM reservas 
      WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now', 'localtime')
      AND estado = 'confirmada'
    `).get();

    // Daily breakdown for the last 7 days
    const desgloseDiario = db.prepare(`
      SELECT fecha, COALESCE(SUM(monto_total), 0) as total, COUNT(*) as cantidad
      FROM reservas 
      WHERE fecha >= date('now', 'localtime', '-7 days')
      AND estado = 'confirmada'
      GROUP BY fecha
      ORDER BY fecha ASC
    `).all();

    // Pending reservations count
    const pendientes = db.prepare(`
      SELECT COUNT(*) as cantidad FROM reservas WHERE estado = 'pendiente'
    `).get();

    // Today's confirmed reservations
    const reservasHoy = db.prepare(`
      SELECT COUNT(*) as cantidad FROM reservas WHERE fecha = ? AND estado = 'confirmada'
    `).get(today);

    res.json({
      diario: ingresoDiario,
      semanal: ingresoSemanal,
      mensual: ingresoMensual,
      desglose_diario: desgloseDiario,
      pendientes: pendientes.cantidad,
      reservas_hoy: reservasHoy.cantidad
    });
  } catch (error) {
    console.error('Error obteniendo ingresos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
