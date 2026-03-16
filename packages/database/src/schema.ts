import { pgTable, serial, text, numeric, integer, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const shops = pgTable("shops", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  shopId: integer("shop_id").references(() => shops.id).notNull(),
  originId: text("origin_id").notNull(),
  title: text("title").notNull(),
}, (t) => ({
  originIdIdx: index("categories_origin_id_idx").on(t.originId),
}));

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => categories.id).notNull(),
  originId: text("origin_id").notNull(),
  slug: text("slug"),
  title: text("title").notNull(),
  description: text("description"),
  unit: text("unit"),
  volume: text("volume"),
  measur: text("measur"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("active"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  originIdIdx: index("products_origin_id_idx").on(t.originId),
}));

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
});

export const receiptItems = pgTable("receipt_items", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").references(() => receipts.id).notNull(),
  title: text("title").notNull(),
  value: text("value").notNull(),
  note: text("note"),
});

export const receiptVariants = pgTable("receipt_variants", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").references(() => receipts.id).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const receiptVariantItems = pgTable("receipt_variant_items", {
  id: serial("id").primaryKey(),
  variantId: integer("variant_id").references(() => receiptVariants.id).notNull(),
  receiptItemId: integer("receipt_item_id").references(() => receiptItems.id).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
});

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  shop: one(shops, { fields: [categories.shopId], references: [shops.id] }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
}));

export const receiptsRelations = relations(receipts, ({ many }) => ({
  items: many(receiptItems),
  variants: many(receiptVariants),
}));

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt: one(receipts, { fields: [receiptItems.receiptId], references: [receipts.id] }),
}));

export const receiptVariantsRelations = relations(receiptVariants, ({ one, many }) => ({
  receipt: one(receipts, { fields: [receiptVariants.receiptId], references: [receipts.id] }),
  items: many(receiptVariantItems),
}));

export const receiptVariantItemsRelations = relations(receiptVariantItems, ({ one }) => ({
  variant: one(receiptVariants, { fields: [receiptVariantItems.variantId], references: [receiptVariants.id] }),
  product: one(products, { fields: [receiptVariantItems.productId], references: [products.id] }),
}));
