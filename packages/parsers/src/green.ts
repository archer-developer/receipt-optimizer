/**
 * Parser for Green shop (green-dostavka.by).
 * Run with: pnpm --filter @receipt-optimizer/parsers parse:green
 */
import { db, categories, products } from "@receipt-optimizer/database";
import { eq, and, notInArray } from "drizzle-orm";

const GREEN_SHOP_ID = 1;
const STORE_ID = 2;
const API_BASE = "https://green-dostavka.by/api/v1/products";
const PAGE_LIMIT = 100;

interface StoreProduct {
  price: number;
  priceWithSale: number;
  isActive: boolean;
}

interface ApiProduct {
  id: number;
  slug: string | null;
  title: string;
  unit: string | null;
  volume: string | null;
  measur: string | null;
  storeProduct: StoreProduct;
}

interface ApiResponse {
  skip: number;
  limit: number;
  items: ApiProduct[];
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchProducts(categoryId: string, skip: number): Promise<ApiResponse> {
  const url = `${API_BASE}?storeId=${STORE_ID}&categoryId=${categoryId}&limit=${PAGE_LIMIT}&skip=${skip}&includeTop=true`;
  log(`  Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<ApiResponse>;
}

async function fetchAllProducts(categoryId: string): Promise<ApiProduct[]> {
  const all: ApiProduct[] = [];
  let skip = 0;

  while (true) {
    const page = await fetchProducts(categoryId, skip);
    all.push(...page.items);
    if (page.items.length < PAGE_LIMIT) break;
    skip += PAGE_LIMIT;
  }

  return all;
}

async function run() {
  log(`Starting Green parser (shop_id=${GREEN_SHOP_ID})`);

  const dbCategories = await db.query.categories.findMany({
    where: eq(categories.shopId, GREEN_SHOP_ID),
  });

  const actionableCategories = dbCategories.filter((c) => c.originId);
  log(`Found ${dbCategories.length} categories, ${actionableCategories.length} with origin_id`);

  for (const category of actionableCategories) {
    log(`Processing category "${category.title}" (origin_id=${category.originId})`);

    let apiProducts: ApiProduct[];
    try {
      apiProducts = await fetchAllProducts(category.originId!);
    } catch (err) {
      log(`  ERROR fetching category ${category.originId}: ${(err as Error).message}`);
      continue;
    }

    log(`  Fetched ${apiProducts.length} products from API`);

    const seenOriginIds: string[] = [];

    for (const item of apiProducts) {
      const originId = String(item.id);
      seenOriginIds.push(originId);

      const price = String((item.storeProduct.priceWithSale / 100).toFixed(2));

      const existing = await db.query.products.findFirst({
        where: and(
          eq(products.originId, originId),
          eq(products.categoryId, category.id),
        ),
      });

      if (existing) {
        await db
          .update(products)
          .set({
            slug: item.slug,
            title: item.title,
            unit: item.unit,
            volume: item.volume,
            measur: item.measur,
            price,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(products.id, existing.id));
        log(`  Updated: ${item.title}`);
      } else {
        await db.insert(products).values({
          categoryId: category.id,
          originId,
          slug: item.slug,
          title: item.title,
          unit: item.unit,
          volume: item.volume,
          measur: item.measur,
          price,
          status: "active",
        });
        log(`  Created: ${item.title}`);
      }
    }

    // Mark products not returned by the API as inactive
    if (seenOriginIds.length > 0) {
      const deactivated = await db
        .update(products)
        .set({ status: "inactive" })
        .where(
          and(
            eq(products.categoryId, category.id),
            notInArray(products.originId, seenOriginIds),
          ),
        )
        .returning({ id: products.id });

      if (deactivated.length > 0) {
        log(`  Marked ${deactivated.length} product(s) as inactive`);
      }
    }
  }

  log("Green parser finished.");
  // @ts-ignore
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  // @ts-ignore
  process.exit(1);
});
