/**
 * Parser for Edostavka shop (edostavka.by).
 * Run with: pnpm --filter @receipt-optimizer/parsers parse:edostavka
 *
 * Strategy:
 *  - Fetches /categories page, extracts __NEXT_DATA__ to build the full category tree
 *  - Syncs leaf categories into the DB
 *  - For each leaf category, paginates through /category/{id}?page={n} to fetch products
 */
import { db, categories, products } from "@receipt-optimizer/database";
import { eq, and, notInArray, max } from "drizzle-orm";
import * as cheerio from "cheerio";

const EDOSTAVKA_SHOP_ID = 4;
const BASE_URL = "https://edostavka.by";
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// @ts-ignore
const PROXY_URL: string | undefined = process.env.LLM_PROXY_URL;

// --- Types ---

interface EdoCategory {
  categoryListId: number;
  categoryListName: string;
  parentId: number | null;
  categories: EdoCategory[];
}

interface ProductPrice {
  basePrice: number;
  discountedPrice: number | null;
}

interface EdoProduct {
  productId: number;
  productName: string;
  price: ProductPrice;
  quantityInfo: { measure: string | null };
}

interface Listing {
  products: EdoProduct[];
  pageNumber: number;
  pageAmount: number;
}

// --- Helpers ---

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

let _proxyFetch: typeof fetch | null = null;

async function getProxyFetch(): Promise<typeof fetch> {
  if (!PROXY_URL) return fetch;
  if (_proxyFetch) return _proxyFetch;

  const { fetch: undiciFetch, Agent, ProxyAgent } = await import("undici" as any);
  const isSocks = /^socks[45]?:\/\//i.test(PROXY_URL);

  let dispatcher;
  if (isSocks) {
    const { SocksClient } = await import("socks");
    const parsed = new URL(PROXY_URL);
    const type = parsed.protocol === "socks4:" ? 4 : 5;
    dispatcher = new Agent({
      connect: async (options: any, callback: any) => {
        try {
          const { socket } = await SocksClient.createConnection({
            proxy: {
              host: parsed.hostname,
              port: Number(parsed.port),
              type,
              ...(parsed.username ? { userId: decodeURIComponent(parsed.username) } : {}),
              ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
            },
            command: "connect",
            destination: {
              host: options.hostname,
              port: typeof options.port === "string" ? Number(options.port) : options.port,
            },
          });
          socket.setKeepAlive(true);
          callback(null, socket);
        } catch (err) {
          callback(err, null);
        }
      },
    });
  } else {
    dispatcher = new ProxyAgent(PROXY_URL);
  }

  _proxyFetch = (reqUrl: any, init?: any) =>
    undiciFetch(reqUrl, { ...init, dispatcher }) as unknown as Promise<Response>;
  return _proxyFetch!;
}

async function fetchNextData<T>(url: string): Promise<T> {
  log(`  Fetching ${url}`);
  const proxyFetch = await getProxyFetch();
  const res = await proxyFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9",
    },
  } as any);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) throw new Error(`No __NEXT_DATA__ found at ${url}`);
  const data = JSON.parse(raw);
  return data.props.pageProps as T;
}

function collectLeafCategories(cats: EdoCategory[]): EdoCategory[] {
  const leaves: EdoCategory[] = [];
  function traverse(list: EdoCategory[]) {
    for (const cat of list) {
      if (!cat.categories || cat.categories.length === 0) {
        leaves.push(cat);
      } else {
        traverse(cat.categories);
      }
    }
  }
  traverse(cats);
  return leaves;
}

async function fetchProductPage(categoryId: number, page: number): Promise<Listing | undefined> {
  const url = `${BASE_URL}/category/${categoryId}?page=${page}`;
  const pageProps = await fetchNextData<{ listing?: Listing }>(url);
  return pageProps.listing;
}

// --- Main ---

async function run() {
  log(`Starting Edostavka parser (shop_id=${EDOSTAVKA_SHOP_ID})`);

  // 1. Fetch and sync categories
  log("Fetching category tree from /categories...");
  const { categories: categoryTree } = await fetchNextData<{ categories: EdoCategory[] }>(
    `${BASE_URL}/categories`,
  );

  const leafCategories = collectLeafCategories(categoryTree);
  log(`Found ${leafCategories.length} leaf categories`);

  for (const leaf of leafCategories) {
    const originId = String(leaf.categoryListId);
    const existing = await db.query.categories.findFirst({
      where: and(
        eq(categories.shopId, EDOSTAVKA_SHOP_ID),
        eq(categories.originId, originId),
      ),
    });

    if (!existing) {
      await db.insert(categories).values({
        shopId: EDOSTAVKA_SHOP_ID,
        originId,
        title: leaf.categoryListName,
      });
      log(`  Created category: ${leaf.categoryListName}`);
    } else if (existing.title !== leaf.categoryListName) {
      await db
        .update(categories)
        .set({ title: leaf.categoryListName })
        .where(eq(categories.id, existing.id));
      log(`  Updated category title: ${leaf.categoryListName}`);
    }
  }

  // 2. Process products for each leaf category
  const dbCategories = await db.query.categories.findMany({
    where: eq(categories.shopId, EDOSTAVKA_SHOP_ID),
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
      let listing: Listing | undefined;
      try {
        listing = await fetchProductPage(Number(dbCat.originId), page);
      } catch (err) {
        log(`  ERROR fetching page ${page}: ${(err as Error).message}`);
        break;
      }

      if (!listing) {
        log(`  Page ${page}: no listing in response, skipping`);
        break;
      }

      log(`  Page ${page}/${listing.pageAmount} — ${listing.products.length} products`);

      for (const item of listing.products) {
        const originId = String(item.productId);
        seenOriginIds.push(originId);

        const rawPrice = item.price.discountedPrice ?? item.price.basePrice;
        const price = String(rawPrice.toFixed(2));
        const unit = item.quantityInfo.measure ?? null;

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
              title: item.productName,
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
            title: item.productName,
            unit,
            price,
            status: "active",
          });
        }
      }

      if (page >= listing.pageAmount) break;
      page++;
    }

    log(`  Processed ${seenOriginIds.length} products total`);

    // Mark products no longer returned by the site as inactive
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

  log("Edostavka parser finished.");
  // @ts-ignore
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  // @ts-ignore
  process.exit(1);
});
