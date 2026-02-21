const fs = require('fs');

const generateFeatures = (name) => {
  return [
    "Ejecución autónoma y asincrónica",
    "Análisis y procesamiento de datos en tiempo real",
    "Integración segura de API (OAuth/Tokens)",
    "Manejo avanzado de errores y reintentos",
    "Soporte para ejecución paralela de tareas",
    "Compatibilidad multilenguaje y cross-platform",
    "Validación estricta de entrada (Zod Schema)",
    "Registro detallado (Audit Logging)",
    "Seguridad mejorada y aislamiento de contexto",
    "Configuración dinámica y personalizable"
  ];
};

const processFile = (path) => {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/\{ id: "(.*?)", name: "(.*?)", description: "(.*?)", category: "(.*?)"(?:, features: \[.*?\])? \}/g, (match, id, name, description, category) => {
    const features = generateFeatures(name);
    return `{ id: "${id}", name: "${name}", description: "${description}", category: "${category}", features: ${JSON.stringify(features)} }`;
  });
  fs.writeFileSync(path, content);
  console.log(`Updated ${path}`);
};

processFile('client/src/data/bundledSkills.ts');
processFile('server/data/bundledSkills.ts');
