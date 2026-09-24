const express = require('express');
const router = express.Router();
const { supabase } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const CAMPOS_CONFIG = [
  'yape_numero', 'yape_titular',
  'plin_numero', 'plin_titular',
  'banco_nombre', 'banco_numero_cuenta', 'banco_cci', 'banco_titular'
];

/**
 * GET /api/config-pago
 * Public: payment details shown to clients when booking (Yape/Plin/cuenta bancaria)
 */
router.get('/config-pago', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('voley_config')
      .select(CAMPOS_CONFIG.join(', '))
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;

    res.json(data || {});
  } catch (error) {
    console.error('Error obteniendo config de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PUT /api/admin/config-pago
 * Protected: update the payment details from the admin panel
 */
router.put('/admin/config-pago', authenticateToken, async (req, res) => {
  try {
    const updates = {};
    for (const campo of CAMPOS_CONFIG) {
      if (req.body[campo] !== undefined) {
        updates[campo] = String(req.body[campo]).trim() || null;
      }
    }

    const { data, error } = await supabase
      .from('voley_config')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select(CAMPOS_CONFIG.join(', '))
      .single();

    if (error) throw error;

    res.json({ message: 'Configuración de pago actualizada', config: data });
  } catch (error) {
    console.error('Error actualizando config de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
