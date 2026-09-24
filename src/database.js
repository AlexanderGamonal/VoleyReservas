const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridos');
}

// Cliente con service role: corre solo en el backend y salta RLS,
// que se mantiene habilitado en las tablas como defensa en profundidad.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const COMPROBANTES_BUCKET = 'voley-comprobantes';

function initializeDatabase() {
  // Las tablas y el bucket se gestionan vía migraciones de Supabase,
  // no en tiempo de ejecución (el filesystem de Vercel es de solo lectura).
}

module.exports = { supabase, COMPROBANTES_BUCKET, initializeDatabase };
