import fs from 'fs/promises';
import path from 'path';

interface SkillMeta {
  name: string;
  description: string;
  location: string;
}

/**
 * Escanea el directorio de habilidades buscando subdirectorios con SKILL.md.
 * Extrae <name> y <description> de cada SKILL.md.
 */
export async function getAvailableSkillsXml(skillsDir: string = path.join(process.cwd(), 'skills')): Promise<string> {
  const skills: SkillMeta[] = [];
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDirPath = path.join(skillsDir, entry.name);
        const skillFilePath = path.join(skillDirPath, 'SKILL.md');
        
        try {
          const content = await fs.readFile(skillFilePath, 'utf-8');
          
          // Extraer usando Regex simple
          const nameMatch = content.match(/<name>(.*?)<\/name>/is) || content.match(/# (.*?)\n/);
          const descMatch = content.match(/<description>(.*?)<\/description>/is) || content.match(/description:\s*(.*?)\n/i);
          
          const name = nameMatch ? nameMatch[1].trim() : entry.name;
          const description = descMatch ? descMatch[1].trim() : 'Sin descripción.';
          
          skills.push({ name, description, location: skillFilePath });
        } catch (err) {
          // El directorio no tiene SKILL.md o no se puede leer, ignorar
        }
      }
    }
  } catch (err) {
    console.warn(`[OpenClaw:Skills] Error leyendo directorio de habilidades (${skillsDir}):`, err);
    return '';
  }

  if (skills.length === 0) return '';

  // Construir el bloque XML
  let xml = `<available_skills>\n`;
  for (const skill of skills) {
    xml += `  <skill>\n`;
    xml += `    <name>${skill.name}</name>\n`;
    xml += `    <description>${skill.description}</description>\n`;
    xml += `    <location>${skill.location}</location>\n`;
    xml += `  </skill>\n`;
  }
  xml += `</available_skills>\n`;
  
  return xml;
}
