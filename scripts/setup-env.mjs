import { access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

try {
  await access(envPath);
  console.log('.env existe déjà : aucune valeur n’a été modifiée.');
} catch {
  await copyFile(path.join(root, '.env.example'), envPath);
  const secret = randomBytes(32).toString('base64url');
  const { readFile, writeFile } = await import('node:fs/promises');
  const content = await readFile(envPath, 'utf8');
  await writeFile(envPath, content.replace('changez-cette-valeur-par-un-secret-long-et-prive', secret), 'utf8');
  console.log('.env créé. Ajoutez seulement DATABASE_URL puis enregistrez le fichier.');
}
