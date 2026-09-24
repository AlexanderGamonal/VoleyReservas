const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { db } = require('../database');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { saveSubscription } = require('../utils/notifications');

/**
 * POST /api/admin/login
 * Admin login - returns JWT token
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);

    if (!admin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = generateToken(admin);

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * POST /api/admin/push/subscribe
 * Save push notification subscription for admin
 */
router.post('/push/subscribe', authenticateToken, (req, res) => {
  try {
    const subscription = req.body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Suscripción inválida' });
    }

    saveSubscription(subscription);

    res.json({ message: 'Suscripción guardada exitosamente' });
  } catch (error) {
    console.error('Error guardando suscripción:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/admin/verify
 * Verify if the current token is valid
 */
router.get('/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, admin: req.admin });
});

module.exports = router;
