import { Hono } from "hono";
import { db, shops } from "@receipt-optimizer/database";
import { eq } from "drizzle-orm";

export const shopsRouter = new Hono();

// GET /api/shops
shopsRouter.get("/", async (c) => {
  const rows = await db.query.shops.findMany();
  return c.json(rows);
});

// POST /api/shops  { name: string }
shopsRouter.post("/", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  const [shop] = await db.insert(shops).values({ name }).returning();
  return c.json(shop, 201);
});

// DELETE /api/shops/:id
shopsRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(shops).where(eq(shops.id, id));
  return c.body(null, 204);
});
