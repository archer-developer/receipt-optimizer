/**
 * Parser for Gippo shop (app.willesden.by).
 * Run with: pnpm --filter @receipt-optimizer/parsers parse:gippo
 *
 * Strategy:
 *  - Fetches /api/guest/shop/categories to build the full category list
 *  - Syncs leaf categories (those with no children) into the DB
 *  - For each leaf category, paginates through products API to fetch products
 */
import { db, categories, products } from "@receipt-optimizer/database";
import { eq, and, notInArray, max } from "drizzle-orm";

const GIPPO_SHOP_ID = 3;
const MARKET_ID = 13;
const BASE_URL = "https://app.willesden.by/api/guest/shop";
const PER_PAGE = 100;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// --- Types ---

interface GippoCategory {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  parent_slug: string | null;
  featured: boolean;
}

function categorySlug(cat: GippoCategory): string {
  return cat.parent_slug ?? cat.slug;
}

interface ProductProposal {
  price: number;
  promo_price_before: number | null;
}

interface GippoProduct {
  id: string;
  title: string;
  slug: string | null;
  short_name_uom: string | null;
  markets: Array<{ proposal: ProductProposal }>;
}

interface ProductsResponse {
  data: GippoProduct[];
}

// --- Helpers ---

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchCategories(): Promise<GippoCategory[]> {
  const url = `${BASE_URL}/categories?market_id=${MARKET_ID}`;
  log(`  Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<GippoCategory[]>;
}

async function fetchProductPage(categoryId: string, page: number): Promise<GippoProduct[]> {
  const url = `${BASE_URL}/products?per_page=${PER_PAGE}&filter%5Bcategories%5D%5Bid%5D=${categoryId}&market_id=${MARKET_ID}&page=${page}`;
  log(`  Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const body = (await res.json()) as ProductsResponse;
  return body.data ?? [];
}

// --- Main ---

async function run() {
  log(`Starting Gippo parser (shop_id=${GIPPO_SHOP_ID})`);

  // 1. Fetch and sync leaf categories
  log("Fetching categories...");
  const allCategories = await fetchCategories();

  const parentIds = new Set(allCategories.map((c) => c.parent_id).filter(Boolean));
  const leafCategories = allCategories.filter((c) => !parentIds.has(c.id));
  log(`Found ${allCategories.length} categories, ${leafCategories.length} leaf categories`);

  for (const leaf of leafCategories) {
    const existing = await db.query.categories.findFirst({
      where: and(
        eq(categories.shopId, GIPPO_SHOP_ID),
        eq(categories.originId, leaf.id),
      ),
    });

    const slug = categorySlug(leaf);
    if (!existing) {
      await db.insert(categories).values({
        shopId: GIPPO_SHOP_ID,
        originId: leaf.id,
        title: leaf.title,
        slug,
      });
      log(`  Created category: ${leaf.title}`);
    } else if (existing.title !== leaf.title || existing.slug !== slug) {
      await db
        .update(categories)
        .set({ title: leaf.title, slug })
        .where(eq(categories.id, existing.id));
      log(`  Updated category: ${leaf.title}`);
    }
  }

  // 2. Process products for each leaf category
  const dbCategories = await db.query.categories.findMany({
    where: eq(categories.shopId, GIPPO_SHOP_ID),
  });

  for (const dbCat of dbCategories) {
    const [{ lastFetched }] = await db
      .select({ lastFetched: max(products.updatedAt) })
      .from(products)
      .where(eq(products.categoryId, dbCat.id));

    if (lastFetched && Date.now() - lastFetched.getTime() < COOLDOWN_MS) {
      const minutesAgo = Math.round((Date.now() - lastFetched.getTime()) / 60000);
      log(`Skipping "${dbCat.title}" — fetched ${minutesAgo}m ago (cooldown 60m)`);
      continue;
    }

    log(`Processing category "${dbCat.title}" (origin_id=${dbCat.originId})`);

    const seenOriginIds: string[] = [];
    let page = 1;

    while (true) {
      let pageProducts: GippoProduct[];
      try {
        pageProducts = await fetchProductPage(dbCat.originId, page);
      } catch (err) {
        log(`  ERROR fetching page ${page}: ${(err as Error).message}`);
        break;
      }

      log(`  Page ${page} — ${pageProducts.length} products`);

      for (const item of pageProducts) {
        const originId = item.id;
        seenOriginIds.push(originId);

        const proposal = item.markets?.[0]?.proposal;
        if (!proposal) continue;

        const price = String(proposal.price.toFixed(2));
        const unit = item.short_name_uom ?? null;

        const existing = await db.query.products.findFirst({
          where: and(
            eq(products.originId, originId),
            eq(products.categoryId, dbCat.id),
          ),
        });

        if (existing) {
          await db
            .update(products)
            .set({
              slug: item.slug,
              title: item.title,
              unit,
              price,
              status: "active",
              updatedAt: new Date(),
            })
            .where(eq(products.id, existing.id));
        } else {
          await db.insert(products).values({
            categoryId: dbCat.id,
            originId,
            slug: item.slug,
            title: item.title,
            unit,
            price,
            status: "active",
          });
        }
      }

      if (pageProducts.length < PER_PAGE) break;
      page++;
    }

    log(`  Processed ${seenOriginIds.length} products total`);

    if (seenOriginIds.length > 0) {
      const deactivated = await db
        .update(products)
        .set({ status: "inactive" })
        .where(
          and(
            eq(products.categoryId, dbCat.id),
            notInArray(products.originId, seenOriginIds),
          ),
        )
        .returning({ id: products.id });

      if (deactivated.length > 0) {
        log(`  Marked ${deactivated.length} product(s) as inactive`);
      }
    }
  }

  log("Gippo parser finished.");
  // @ts-ignore
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  // @ts-ignore
  process.exit(1);
});
