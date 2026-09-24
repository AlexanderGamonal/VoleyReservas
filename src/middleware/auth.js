const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'voleyreservas_default_secret';

/**
 * Middleware to verify JWT token for admin routes
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * Generate a JWT token for an admin user
 * @param {object} admin - Admin user object
 * @returns {string} JWT token
 */
function generateToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authenticateToken, generateToken };
