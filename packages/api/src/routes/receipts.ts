import { Hono } from "hono";
import { db, receipts, receiptItems, receiptVariants, receiptVariantItems } from "@receipt-optimizer/database";
import { eq, inArray } from "drizzle-orm";

export const receiptsRouter = new Hono();

// GET /api/receipts
receiptsRouter.get("/", async (c) => {
  const rows = await db.query.receipts.findMany();
  return c.json(rows);
});

// POST /api/receipts  { title: string }
receiptsRouter.post("/", async (c) => {
  const { title } = await c.req.json<{ title: string }>();
  const [receipt] = await db.insert(receipts).values({ title }).returning();
  return c.json(receipt, 201);
});

// GET /api/receipts/:id
receiptsRouter.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const receipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, id),
    with: { items: true },
  });
  if (!receipt) return c.json({ error: "Not found" }, 404);
  return c.json(receipt);
});

// PUT /api/receipts/:id  { title: string }
receiptsRouter.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { title } = await c.req.json<{ title: string }>();
  const [receipt] = await db.update(receipts).set({ title }).where(eq(receipts.id, id)).returning();
  if (!receipt) return c.json({ error: "Not found" }, 404);
  return c.json(receipt);
});

// DELETE /api/receipts/:id
receiptsRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const variants = await db.query.receiptVariants.findMany({ where: eq(receiptVariants.receiptId, id) });
  if (variants.length > 0) {
    const variantIds = variants.map((v) => v.id);
    await db.delete(receiptVariantItems).where(inArray(receiptVariantItems.variantId, variantIds));
    await db.delete(receiptVariants).where(inArray(receiptVariants.id, variantIds));
  }
  await db.delete(receiptItems).where(eq(receiptItems.receiptId, id));
  await db.delete(receipts).where(eq(receipts.id, id));
  return c.body(null, 204);
});

// POST /api/receipts/:id/items  { title: string, value: string, note?: string }
receiptsRouter.post("/:id/items", async (c) => {
  const receiptId = Number(c.req.param("id"));
  const { title, value, note } = await c.req.json<{ title: string; value: string; note?: string }>();
  const [item] = await db.insert(receiptItems).values({ receiptId, title, value, note }).returning();
  return c.json(item, 201);
});

// PUT /api/receipts/:id/items/:itemId  { title: string, value: string, note?: string }
receiptsRouter.put("/:id/items/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const { title, value, note } = await c.req.json<{ title: string; value: string; note?: string }>();
  const [item] = await db.update(receiptItems).set({ title, value, note }).where(eq(receiptItems.id, itemId)).returning();
  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(item);
});

// DELETE /api/receipts/:id/items/:itemId
receiptsRouter.delete("/:id/items/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  await db.delete(receiptVariantItems).where(eq(receiptVariantItems.receiptItemId, itemId));
  await db.delete(receiptItems).where(eq(receiptItems.id, itemId));
  return c.body(null, 204);
});
