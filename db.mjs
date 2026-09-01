import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL est absent. Copiez .env.example vers .env et renseignez la connexion PostgreSQL.');
}

const useSsl = process.env.DATABASE_SSL === 'true';
const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
const connection = new URL(databaseUrl);
if (process.env.DATABASE_PORT) connection.port = process.env.DATABASE_PORT;

export const pool = new Pool({
  connectionString: connection.toString(),
  ssl: useSsl ? { rejectUnauthorized } : false,
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000
});

pool.on('error', error => console.error('Erreur PostgreSQL inattendue :', error.message));

export function query(text, parameters = []) {
  return pool.query(text, parameters);
}

export function closeDatabase() {
  return pool.end();
}
