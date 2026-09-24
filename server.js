require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const { initializeDatabase } = require('./src/database');
const { initializeWebPush } = require('./src/utils/notifications');
const { expireOldReservations } = require('./src/utils/expiration');

const authRoutes = require('./src/routes/auth');
const reservasRoutes = require('./src/routes/reservas');
const configRoutes = require('./src/routes/config');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initializeDatabase();

// Initialize Web Push
initializeWebPush();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/admin', authRoutes);
app.use('/api', reservasRoutes);
app.use('/api', configRoutes);

// VAPID public key endpoint (needed by the client for push subscription)
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Cron job: expire pending reservations every minute.
// Solo tiene sentido en un proceso persistente (dev local); en Vercel
// serverless no hay proceso de fondo, así que la expiración se hace
// al vuelo en cada request relevante (ver src/routes/reservas.js).
if (!process.env.VERCEL) {
  cron.schedule('* * * * *', () => {
    expireOldReservations().catch(err => console.error('Error expirando reservas:', err));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);

  if (err.message && err.message.includes('Solo se permiten imágenes')) {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'La imagen es demasiado grande. Máximo 4MB.' });
  }

  res.status(500).json({ error: 'Error interno del servidor' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║         🏐 VoleyReservas v1.0           ║
  ╠══════════════════════════════════════════╣
  ║  Servidor corriendo en puerto ${PORT}        ║
  ║                                          ║
  ║  📱 Clientes:  http://localhost:${PORT}      ║
  ║  🔧 Admin:     http://localhost:${PORT}/admin.html  ║
  ╚══════════════════════════════════════════╝
  `);
});
