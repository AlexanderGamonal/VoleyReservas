/**
 * VoleyReservas - Setup Script
 * Run this once to initialize the database and generate VAPID keys
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

const { db, initializeDatabase } = require('./src/database');

async function setup() {
  console.log('\n🏐 VoleyReservas - Configuración Inicial\n');
  console.log('=========================================\n');

  // 1. Initialize database
  console.log('📦 Inicializando base de datos...');
  initializeDatabase();
  console.log('✅ Base de datos creada\n');

  // 2. Generate VAPID keys
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

  // 3. Create admin account
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';

  const existingAdmin = db.prepare('SELECT * FROM admin WHERE username = ?').get(adminUser);

  if (!existingAdmin) {
    console.log('👤 Creando cuenta de administrador...');
    const passwordHash = await bcrypt.hash(adminPass, 10);
    db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run(adminUser, passwordHash);
    console.log(`✅ Admin creado: usuario="${adminUser}", contraseña="${adminPass}"\n`);
  } else {
    console.log('ℹ️  La cuenta de admin ya existe\n');
  }

  // 4. Create uploads directory
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('📁 Carpeta de uploads creada\n');
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
