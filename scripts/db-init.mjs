import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, query } from '../db.mjs';
import { seedProducts } from '../seed-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = await readFile(path.join(root, 'migrations', '001_initial.sql'), 'utf8');

try {
  await query(schema);
  const existing = await query('SELECT COUNT(*)::int AS count FROM products');
  if (existing.rows[0].count === 0) {
    for (const product of seedProducts) {
      await query(
        `INSERT INTO products (name, price_cdf, price_usd, area, delivery, seller, rating, sales, emoji, tone, tag, category, stock, vehicle, year, km, fuel, gearbox, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [product.name, product.price, product.usd, product.area, product.delivery, product.seller, product.rating, product.sales, product.emoji, product.tone, product.tag, product.category, product.stock, Boolean(product.vehicle), product.year || null, product.km || null, product.fuel || null, product.gearbox || null, product.description || '']
      );
    }
    console.log(`${seedProducts.length} annonces de démonstration ajoutées.`);
  } else {
    console.log('Schéma vérifié. Les annonces existantes ont été conservées.');
  }
  console.log('PostgreSQL est prêt pour TekaSafe.');
} finally {
  await closeDatabase();
}
