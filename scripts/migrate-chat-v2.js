#!/usr/bin/env node

/**
 * Script de migración para Chat Interface v2
 * 
 * Uso: node scripts/migrate-chat-v2.js
 * 
 * Este script:
 * 1. Encuentra todos los archivos que importan chat-interface legacy
 * 2. Genera un reporte de migración
 * 3. Opcionalmente, actualiza importaciones automáticamente
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLIENT_SRC = path.join(__dirname, '..', 'client', 'src');
const LEGACY_IMPORT = /from\s+['"]@\/components\/chat-interface['"]/g;
const LEGACY_IMPORT_ALT = /from\s+['"]\.\.\/chat-interface['"]/g;

// Colores para output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function findFilesWithLegacyImport(dir, files = []) {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !item.includes('node_modules') && !item.includes('__tests__')) {
      findFilesWithLegacyImport(fullPath, files);
    } else if (stat.isFile() && (item.endsWith('.tsx') || item.endsWith('.ts'))) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (LEGACY_IMPORT.test(content) || LEGACY_IMPORT_ALT.test(content)) {
        files.push(fullPath);
      }
    }
  }
  
  return files;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const usages = [];
  
  lines.forEach((line, index) => {
    if (line.includes('ChatInterface') && !line.includes('ChatInterfaceV2')) {
      usages.push({ line: index + 1, code: line.trim() });
    }
  });
  
  return usages;
}

function generateReport(files) {
  log('\n📊 REPORTE DE MIGRACIÓN', 'cyan');
  log('='.repeat(60), 'cyan');
  
  if (files.length === 0) {
    log('\n✅ No se encontraron archivos con importaciones legacy.', 'green');
    log('La migración está completa.', 'green');
    return;
  }
  
  log(`\n📁 Total de archivos a migrar: ${files.length}`, 'yellow');
  log('\nArchivos encontrados:\n', 'blue');
  
  files.forEach((file, index) => {
    const relativePath = path.relative(process.cwd(), file);
    const usages = analyzeFile(file);
    
    log(`${index + 1}. ${relativePath}`, 'magenta');
    log(`   Usos de ChatInterface: ${usages.length}`, 'yellow');
    
    usages.forEach(usage => {
      log(`   Línea ${usage.line}: ${usage.code.substring(0, 60)}...`, 'reset');
    });
    
    console.log('');
  });
}

function migrateFile(filePath, dryRun = true) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;
  
  // Reemplazar importaciones
  if (LEGACY_IMPORT.test(content)) {
    if (!dryRun) {
      content = content.replace(
        /from\s+['"]@\/components\/chat-interface['"]/g,
        'from "@/components/chat-interface-v2"'
      );
      
      // Reemplazar nombre del componente
      content = content.replace(/ChatInterface\b(?!V2)/g, 'ChatInterfaceV2');
      
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    modified = true;
  }
  
  return modified;
}

function runTests() {
  log('\n🧪 Ejecutando tests...', 'blue');
  
  try {
    execSync('npm run test:client -- --run', { stdio: 'inherit' });
    log('\n✅ Tests pasaron correctamente', 'green');
    return true;
  } catch (error) {
    log('\n❌ Algunos tests fallaron', 'red');
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const runTest = args.includes('--test');
  
  log('\n🚀 Script de Migración Chat Interface v2', 'cyan');
  log('='.repeat(60), 'cyan');
  
  if (dryRun) {
    log('\n📋 Modo simulación (dry-run)', 'yellow');
    log('Usa --apply para aplicar cambios', 'yellow');
  } else {
    log('\n⚠️  Modo aplicación de cambios', 'red');
  }
  
  // Buscar archivos
  log('\n🔍 Buscando archivos con importaciones legacy...', 'blue');
  const files = findFilesWithLegacyImport(CLIENT_SRC);
  
  // Generar reporte
  generateReport(files);
  
  // Migrar si se solicita
  if (!dryRun && files.length > 0) {
    log('\n📝 Aplicando migración...', 'blue');
    
    let migrated = 0;
    files.forEach(file => {
      if (migrateFile(file, false)) {
        migrated++;
        log(`✅ Migrado: ${path.relative(process.cwd(), file)}`, 'green');
      }
    });
    
    log(`\n📊 Total de archivos migrados: ${migrated}`, 'cyan');
    
    // Ejecutar tests si se solicita
    if (runTest) {
      runTests();
    }
  }
  
  // Sugerencias
  log('\n💡 Siguientes pasos:', 'cyan');
  log('1. Revisar los archivos listados arriba', 'reset');
  log('2. Ejecutar: node scripts/migrate-chat-v2.js --apply', 'reset');
  log('3. Verificar que la aplicación funciona correctamente', 'reset');
  log('4. Ejecutar tests: npm run test:client', 'reset');
  log('5. Hacer commit de los cambios', 'reset');
  
  log('\n📚 Documentación: MIGRATION.md', 'blue');
  log('\n');
}

// Verificar que estamos en el directorio correcto
if (!fs.existsSync(CLIENT_SRC)) {
  log('❌ Error: No se encontró el directorio client/src', 'red');
  log('Asegúrate de ejecutar este script desde la raíz del proyecto', 'red');
  process.exit(1);
}

main();
