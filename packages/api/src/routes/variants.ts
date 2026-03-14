import { Hono } from "hono";
import { db, receiptVariants, receiptVariantItems } from "@receipt-optimizer/database";
import { eq } from "drizzle-orm";

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
    with: { items: { with: { product: { with: { category: true } } } } },
    orderBy: (v, { desc }) => [desc(v.createdAt)],
  });
  return c.json(rows);
});

// DELETE /api/variants/:id
variantsRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(receiptVariantItems).where(eq(receiptVariantItems.variantId, id));
  await db.delete(receiptVariants).where(eq(receiptVariants.id, id));
  return c.body(null, 204);
});
