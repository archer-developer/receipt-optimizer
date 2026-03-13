import { Hono } from "hono";
import { db, receipts, products, categories } from "@receipt-optimizer/database";
import { eq, inArray } from "drizzle-orm";

export const optimizeRouter = new Hono();

interface Suggestion {
  receiptItemId: number;
  receiptItemTitle: string;
  productId: number;
  productTitle: string;
  categoryTitle: string;
  price: string;
  reason: string;
}

async function callLLM(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM request failed: ${err}`);
  }

  const data = await response.json() as { content: { type: string; text: string }[] };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

function parseJsonArray<T>(text: string): T[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in LLM response");
  return JSON.parse(match[0]);
}

// POST /api/optimize/:receiptId
optimizeRouter.post("/:receiptId", async (c) => {
  // @ts-ignore
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY is not configured" }, 503);

  const receiptId = Number(c.req.param("receiptId"));

  const receipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, receiptId),
    with: { items: true },
  });
  if (!receipt) return c.json({ error: "Receipt not found" }, 404);
  if (!receipt.items.length) return c.json({ error: "Receipt has no items" }, 400);

  const allCategories = await db.query.categories.findMany();
  if (!allCategories.length) return c.json({ error: "No categories in catalog" }, 400);

  const itemsList = receipt.items
    .map((it) => `- [id:${it.id}] ${it.title}: ${it.value}`)
    .join("\n");

  // ── Step 1: pick relevant categories ────────────────────────────────────────

  const categoryList = allCategories
    .map((cat) => `[id:${cat.id}] ${cat.title}`)
    .join("\n");

  const step1Prompt = `You are a shopping assistant. For each receipt item, select up to 3 most relevant product categories from the list below.

Receipt items:
${itemsList}

Categories:
${categoryList}

Return ONLY a JSON array. Each element must have:
- "receiptItemId": number
- "categoryIds": number[] (up to 3 most relevant category ids)`;

  let categoryMatches: { receiptItemId: number; categoryIds: number[] }[];
  try {
    const text = await callLLM(apiKey, step1Prompt);
    categoryMatches = parseJsonArray(text);
  } catch (e) {
    return c.json({ error: `Step 1 failed: ${(e as Error).message}` }, 502);
  }

  // Collect unique category IDs across all receipt items
  const selectedCategoryIds = [...new Set(categoryMatches.flatMap((m) => m.categoryIds))];

  // ── Step 2: pick best product per item from filtered catalog ─────────────────

  const filteredProducts = await db
    .select({
      productId: products.id,
      productTitle: products.title,
      volume: products.volume,
      price: products.price,
      categoryId: products.categoryId,
      categoryTitle: categories.title,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(inArray(products.categoryId, selectedCategoryIds));

  if (!filteredProducts.length) return c.json({ error: "No products found in selected categories" }, 400);

  // Build a per-item catalog scoped to that item's selected categories
  const categoryIdsByItem = new Map(categoryMatches.map((m) => [m.receiptItemId, new Set(m.categoryIds)]));

  const itemCatalogs = receipt.items.map((it) => {
    const allowed = categoryIdsByItem.get(it.id) ?? new Set();
    const itemProducts = filteredProducts.filter((p) => allowed.has(p.categoryId));
    const lines = itemProducts
      .map((p) => `  [id:${p.productId}] ${p.productTitle}${p.volume ? ` | ${p.volume}` : ""} | ${p.price} BYN`)
      .join("\n");
    return `[id:${it.id}] ${it.title}: ${it.value}\n${lines}`;
  }).join("\n\n");

  const step2Prompt = `You are a shopping assistant. For each receipt item, pick the single best matching product from its candidate list, optimizing for price/value ratio.

${itemCatalogs}

Return ONLY a JSON array. Each element must have:
- "receiptItemId": number
- "productId": number
- "reason": string (brief explanation, max 20 words)

Match every receipt item to exactly one product.`;

  let matches: { receiptItemId: number; productId: number; reason: string }[];
  try {
    const text = await callLLM(apiKey, step2Prompt);
    matches = parseJsonArray(text);
  } catch (e) {
    return c.json({ error: `Step 2 failed: ${(e as Error).message}` }, 502);
  }

  const productMap = new Map(filteredProducts.map((p) => [p.productId, p]));
  const itemMap = new Map(receipt.items.map((it) => [it.id, it]));

  const suggestions: Suggestion[] = matches.map((m) => {
    const product = productMap.get(m.productId);
    const item = itemMap.get(m.receiptItemId);
    return {
      receiptItemId: m.receiptItemId,
      receiptItemTitle: item?.title ?? "",
      productId: m.productId,
      productTitle: product?.productTitle ?? "",
      categoryTitle: product?.categoryTitle ?? "",
      price: product?.price ?? "",
      reason: m.reason,
    };
  });

  return c.json(suggestions);
});
