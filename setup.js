/**
 * VoleyReservas - Setup Script
 * Run this once to generate VAPID keys and create the admin account.
 * Usage: node setup.js
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const webpush = require('web-push');

// Load .env if exists, otherwise create from example
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('📄 Archivo .env creado desde .env.example');
  } else {
    console.error('❌ No se encontró .env.example');
    process.exit(1);
  }
}

require('dotenv').config();

const { supabase } = require('./src/database');

async function setup() {
  console.log('\n🏐 VoleyReservas - Configuración Inicial\n');
  console.log('=========================================\n');

  // 1. Generate VAPID keys
  console.log('🔑 Generando claves VAPID para notificaciones push...');
  const vapidKeys = webpush.generateVAPIDKeys();

  // Update .env file with VAPID keys
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/VAPID_PUBLIC_KEY=.*/, `VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  envContent = envContent.replace(/VAPID_PRIVATE_KEY=.*/, `VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);

  // Generate a random JWT secret
  const jwtSecret = require('crypto').randomBytes(32).toString('hex');
  envContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${jwtSecret}`);

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Claves VAPID generadas y guardadas en .env\n');

  // 2. Create admin account
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';

  const { data: existingAdmin, error: fetchError } = await supabase
    .from('voley_admin')
    .select('*')
    .eq('username', adminUser)
    .maybeSingle();

  if (fetchError) throw fetchError;

  if (!existingAdmin) {
    console.log('👤 Creando cuenta de administrador...');
    const passwordHash = await bcrypt.hash(adminPass, 10);
    const { error: insertError } = await supabase
      .from('voley_admin')
      .insert({ username: adminUser, password_hash: passwordHash });
    if (insertError) throw insertError;
    console.log(`✅ Admin creado: usuario="${adminUser}", contraseña="${adminPass}"\n`);
  } else {
    console.log('ℹ️  La cuenta de admin ya existe\n');
  }

  console.log('=========================================');
  console.log('✅ ¡Configuración completada!\n');
  console.log('Para iniciar el servidor ejecuta:');
  console.log('  npm run dev\n');
  console.log(`Panel Admin: http://localhost:${process.env.PORT || 3000}/admin.html`);
  console.log(`  Usuario: ${adminUser}`);
  console.log(`  Contraseña: ${adminPass}\n`);
  console.log('⚠️  Recuerda cambiar la contraseña del admin en .env');
  console.log('   y volver a ejecutar: npm run setup\n');

  process.exit(0);
}

setup().catch(err => {
  console.error('❌ Error en la configuración:', err);
  process.exit(1);
});
