import { randomUUID } from 'node:crypto';

export class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function normalizeCart(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new OrderError('Le panier doit contenir entre 1 et 100 lignes.');
  }
  const quantities = new Map();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0) {
      throw new OrderError('Article invalide dans le panier.');
    }
    const qty = item.qty ?? 1;
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 100) {
      throw new OrderError('La quantité doit être un entier entre 1 et 100.');
    }
    const combined = (quantities.get(item.id) || 0) + qty;
    if (combined > 100) throw new OrderError('Quantité maximale dépassée pour un article.');
    quantities.set(item.id, combined);
  }
  return [...quantities].sort(([a], [b]) => a - b).map(([id, qty]) => ({ id, qty }));
}

// All database operations use the same transaction and lock products in ID order.
export async function createOrder({ userId, items, payment }, transaction) {
  const cart = normalizeCart(items);
  if (!['Mobile Money', 'À la livraison'].includes(payment)) {
    throw new OrderError('Mode de paiement invalide.');
  }
  return transaction(async client => {
    const { rows } = await client.query(
      'SELECT id, name, price_cdf, stock, vehicle FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
      [cart.map(item => item.id)]
    );
    const products = new Map(rows.map(row => [Number(row.id), row]));
    let total = 10000;
    const orderItems = cart.map(item => {
      const product = products.get(item.id);
      if (!product) throw new OrderError('Un article du panier n’est plus disponible.', 409);
      if (product.vehicle) throw new OrderError('Les véhicules nécessitent un rendez-vous et ne peuvent pas être commandés ici.');
      if (Number(product.stock) < item.qty) throw new OrderError(`Stock insuffisant : ${product.name}.`, 409);
      const price = Number(product.price_cdf);
      if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(total + price * item.qty)) {
        throw new OrderError('Montant non pris en charge.');
      }
      total += price * item.qty;
      return { id: item.id, name: product.name, price, qty: item.qty };
    });
    for (const item of cart) {
      await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.qty, item.id]);
    }
    const result = await client.query(
      `INSERT INTO orders (order_number, user_id, items, total_cdf, payment, status)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
      [`TK-${randomUUID().replaceAll('-', '').slice(0, 24)}`, userId, JSON.stringify(orderItems), total, payment, 'Confirmée']
    );
    return result.rows[0];
  });
}
