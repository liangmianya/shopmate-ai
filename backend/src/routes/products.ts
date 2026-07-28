import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/database.js';

const router = Router();
const now = () => new Date().toISOString();

const productItemSchema = z.object({
  name: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  price: z.number().nonnegative().default(0),
  stock: z.number().int().nonnegative().default(0),
  features: z.string().min(1),
  sizeGuide: z.string().default(''),
  targetUsers: z.string().default(''),
  scene: z.string().default(''),
  purchaseUrl: z.string().default('')
});

const createProductsSchema = z.object({
  items: z.array(productItemSchema).min(1)
});

function mapProductRow(row: {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  features: string;
  size_guide: string;
  target_users: string;
  scene: string;
  purchase_url: string;
}) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    price: row.price,
    stock: row.stock,
    features: row.features,
    sizeGuide: row.size_guide,
    targetUsers: row.target_users,
    scene: row.scene,
    purchaseUrl: row.purchase_url
  };
}

router.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products ORDER BY name')
    .all() as Array<{
      id: string;
      name: string;
      brand: string;
      category: string;
      price: number;
      stock: number;
      features: string;
      size_guide: string;
      target_users: string;
      scene: string;
      purchase_url: string;
    }>;

  const products = rows.map(mapProductRow);

  res.json({ products });
});

router.post('/', (req, res) => {
  const parsed = createProductsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const timestamp = now();
  const insert = db.prepare(`
    INSERT INTO products (id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const productKey = (item: { name: string; brand: string; category: string }) =>
    [item.name, item.brand, item.category].map((part) => part.trim().toLowerCase()).join('|');

  const existingRows = db
    .prepare('SELECT name, brand, category FROM products')
    .all() as Array<{ name: string; brand: string; category: string }>;
  const seen = new Set(existingRows.map(productKey));
  let skippedCount = 0;

  const created = parsed.data.items.map((item) => ({
    id: nanoid(),
    name: item.name.trim(),
    brand: item.brand.trim(),
    category: item.category.trim(),
    price: item.price,
    stock: item.stock,
    features: item.features.trim(),
    size_guide: item.sizeGuide.trim(),
    target_users: item.targetUsers.trim(),
    scene: item.scene.trim(),
    purchase_url: item.purchaseUrl.trim()
  })).filter((item) => {
    const key = productKey(item);
    if (seen.has(key)) {
      skippedCount += 1;
      return false;
    }
    seen.add(key);
    return true;
  });

  db.transaction(() => {
    for (const item of created) {
      insert.run(
        item.id,
        item.name,
        item.brand,
        item.category,
        item.price,
        item.stock,
        item.features,
        item.size_guide,
        item.target_users,
        item.scene,
        item.purchase_url,
        timestamp,
        timestamp
      );
    }
  })();

  res.status(201).json({ products: created.map(mapProductRow), skippedCount });
});

router.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products WHERE id = ?')
    .get(req.params.id) as
    | {
        id: string;
        name: string;
        brand: string;
        category: string;
        price: number;
        stock: number;
        features: string;
        size_guide: string;
        target_users: string;
        scene: string;
        purchase_url: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);

  res.json({ deleted: mapProductRow(row) });
});

export default router;
