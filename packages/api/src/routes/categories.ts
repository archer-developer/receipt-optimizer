import { Hono } from "hono";
import { db, categories } from "@receipt-optimizer/database";
import { eq } from "drizzle-orm";

export const categoriesRouter = new Hono();

// GET /api/categories?shopId=1
categoriesRouter.get("/", async (c) => {
  const shopId = c.req.query("shopId");
  const rows = shopId
    ? await db.query.categories.findMany({ where: eq(categories.shopId, Number(shopId)) })
    : await db.query.categories.findMany();
  return c.json(rows);
});

// POST /api/categories  { shopId: number, title: string }
categoriesRouter.post("/", async (c) => {
  const { shopId, originId, title } = await c.req.json<{ shopId: number; originId: string; title: string }>();
  const [category] = await db.insert(categories).values({ shopId, originId, title }).returning();
  return c.json(category, 201);
});

// DELETE /api/categories/:id
categoriesRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(categories).where(eq(categories.id, id));
  return c.body(null, 204);
});
