import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { shopsRouter } from "./routes/shops.js";
import { categoriesRouter } from "./routes/categories.js";
import { productsRouter } from "./routes/products.js";
import { receiptsRouter } from "./routes/receipts.js";
import { optimizeRouter } from "./routes/optimize.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/shops", shopsRouter);
app.route("/api/categories", categoriesRouter);
app.route("/api/products", productsRouter);
app.route("/api/receipts", receiptsRouter);
app.route("/api/optimize", optimizeRouter);

// @ts-ignore
const port = Number(process.env.API_PORT ?? 3000);
// @ts-ignore
const hostname = process.env.API_HOST ?? "0.0.0.0";

console.log(`API listening on http://${hostname}:${port}`);

serve({ fetch: app.fetch, port, hostname });
