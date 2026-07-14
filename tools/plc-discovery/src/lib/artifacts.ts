import * as fs from 'fs';
import * as path from 'path';

export function saveArtifact(dir: string, name: string, data: unknown): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  const json = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, json, 'utf8');
  console.log(`[artefacto] ${name} (${(json.length / 1024).toFixed(1)} KiB) → ${filePath}`);
  return filePath;
}

export function loadArtifact<T>(dir: string, name: string): T {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Falta el artefacto ${name} en ${dir}. Ejecuta primero la etapa que lo genera (ver README).`,
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}
