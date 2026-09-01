import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

function encodeDatabasePassword(password) {
  return encodeURIComponent(password).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Lancez cette commande directement dans PowerShell.'));
      return;
    }
    let value = '';
    const finish = error => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(new Error('Opération annulée.'));
        if (character === '\b' || character === '\u007f') value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

const content = await readFile(envPath, 'utf8');
const databaseLine = content.split(/\r?\n/).find(line => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('La ligne DATABASE_URL est introuvable dans .env.');

const connectionUrl = databaseLine.slice('DATABASE_URL='.length);
const credentialsStart = connectionUrl.indexOf('://') + 3;
const passwordStart = connectionUrl.indexOf(':', credentialsStart);
const hostStart = connectionUrl.lastIndexOf('@');
if (credentialsStart < 3 || passwordStart < credentialsStart || hostStart < passwordStart) {
  throw new Error('La chaîne PostgreSQL est invalide. Recollez l’URI Session pooler fournie par Supabase.');
}

const password = await readHidden('Tapez le mot de passe de la base Supabase puis appuyez sur Entrée (il ne sera pas affiché) : ');
if (password.length < 8) throw new Error('Mot de passe trop court ou vide. Rien n’a été modifié.');

const updatedUrl = `${connectionUrl.slice(0, passwordStart + 1)}${encodeDatabasePassword(password)}${connectionUrl.slice(hostStart)}`;
await writeFile(envPath, content.replace(databaseLine, `DATABASE_URL=${updatedUrl}`), 'utf8');
console.log('Mot de passe inséré et encodé dans .env.');
