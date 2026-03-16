import { Hono } from "hono";
import { db, receiptVariants, receiptVariantItems, receiptItems, products } from "@receipt-optimizer/database";
import { eq, and } from "drizzle-orm";
import { callLLM, parseJsonArray } from "../llm.js";

export const variantsRouter = new Hono();

interface SuggestionInput {
  receiptItemId: number;
  productId: number;
  price: string;
  reason: string;
}

// POST /api/variants  { receiptId, suggestions: SuggestionInput[] }
variantsRouter.post("/", async (c) => {
  const { receiptId, suggestions } = await c.req.json<{ receiptId: number; suggestions: SuggestionInput[] }>();

  const totalPrice = suggestions
    .reduce((sum, s) => sum + parseFloat(s.price || "0"), 0)
    .toFixed(2);

  const [variant] = await db
    .insert(receiptVariants)
    .values({ receiptId, totalPrice })
    .returning();

  await db.insert(receiptVariantItems).values(
    suggestions.map((s) => ({
      variantId: variant.id,
      receiptItemId: s.receiptItemId,
      productId: s.productId,
      price: s.price,
      reason: s.reason,
    }))
  );

  return c.json(variant, 201);
});

// GET /api/variants?receiptId=1
variantsRouter.get("/", async (c) => {
  const receiptId = Number(c.req.query("receiptId"));
  const rows = await db.query.receiptVariants.findMany({
    where: eq(receiptVariants.receiptId, receiptId),
    with: { items: { with: { product: { with: { category: { with: { shop: true } } } } } } },
    orderBy: (v, { desc }) => [desc(v.createdAt)],
  });
  return c.json(rows);
});

// POST /api/variants/:variantId/items/:itemId/refresh
variantsRouter.post("/:variantId/items/:itemId/refresh", async (c) => {
  const variantId = Number(c.req.param("variantId"));
  const itemId = Number(c.req.param("itemId"));

  // 1. Fetch the variant item with its product and category
  const variantItem = await db.query.receiptVariantItems.findFirst({
    where: and(eq(receiptVariantItems.id, itemId), eq(receiptVariantItems.variantId, variantId)),
    with: { product: { with: { category: { with: { shop: true } } } } },
  });
  if (!variantItem) return c.json({ error: "Variant item not found" }, 404);

  // 2. Fetch the original receipt item
  const receiptItem = await db.query.receiptItems.findFirst({
    where: eq(receiptItems.id, variantItem.receiptItemId),
  });
  if (!receiptItem) return c.json({ error: "Receipt item not found" }, 404);

  // 3. Get all active products in the same category
  const categoryId = variantItem.product.categoryId;
  const categoryProducts = await db
    .select({ productId: products.id, productTitle: products.title, volume: products.volume, price: products.price })
    .from(products)
    .where(and(eq(products.categoryId, categoryId), eq(products.status, "active")));
  if (!categoryProducts.length) return c.json({ error: "No active products in category" }, 400);

  // 4. Ask LLM to pick the best product for this single item
  const lines = categoryProducts
    .map((p) => `  [id:${p.productId}] ${p.productTitle}${p.volume ? ` | ${p.volume}` : ""} | ${p.price} BYN`)
    .join("\n");

  const prompt = `You are a shopping assistant. For the receipt item below, pick the single best matching product from the candidate list, optimizing for price/value ratio.

Receipt item:
[id:${receiptItem.id}] ${receiptItem.title}: ${receiptItem.value}${receiptItem.note ? ` (note: ${receiptItem.note})` : ""}

Candidate products:
${lines}

Return ONLY a JSON array with exactly one element having:
- "receiptItemId": ${receiptItem.id}
- "productId": number
- "reason": string (brief explanation, max 20 words)`;

  let matches: { receiptItemId: number; productId: number; reason: string }[];
  try {
    const text = await callLLM(prompt);
    matches = parseJsonArray(text);
  } catch (e) {
    return c.json({ error: `LLM failed: ${(e as Error).message}` }, 502);
  }

  const match = matches[0];
  if (!match) return c.json({ error: "LLM returned no match" }, 502);

  const newProduct = categoryProducts.find((p) => p.productId === match.productId);
  if (!newProduct) return c.json({ error: "LLM returned unknown product id" }, 502);

  // 5. Update the variant item
  await db
    .update(receiptVariantItems)
    .set({ productId: match.productId, price: newProduct.price, reason: match.reason })
    .where(eq(receiptVariantItems.id, itemId));

  // 6. Recalculate and update variant total
  const allItems = await db.query.receiptVariantItems.findMany({
    where: eq(receiptVariantItems.variantId, variantId),
  });
  const newTotal = allItems
    .reduce((sum, i) => sum + parseFloat(i.price || "0"), 0)
    .toFixed(2);
  await db.update(receiptVariants).set({ totalPrice: newTotal }).where(eq(receiptVariants.id, variantId));

  // 7. Return updated item with full product details + new total
  const updated = await db.query.receiptVariantItems.findFirst({
    where: eq(receiptVariantItems.id, itemId),
    with: { product: { with: { category: { with: { shop: true } } } } },
  });
  return c.json({ item: updated, newTotal });
});

// DELETE /api/variants/:id
variantsRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(receiptVariantItems).where(eq(receiptVariantItems.variantId, id));
  await db.delete(receiptVariants).where(eq(receiptVariants.id, id));
  return c.body(null, 204);
});
