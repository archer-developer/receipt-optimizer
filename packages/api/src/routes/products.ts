import { Hono } from "hono";
import { db, products } from "@receipt-optimizer/database";
import { eq } from "drizzle-orm";

export const productsRouter = new Hono();

// GET /api/products
productsRouter.get("/", async (c) => {
  const rows = await db.query.products.findMany();
  return c.json(rows);
});

// GET /api/products/:id
productsRouter.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
  });
  if (!product) return c.json({ error: "Not found" }, 404);
  return c.json(product);
});
