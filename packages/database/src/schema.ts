import { pgTable, serial, text, numeric, integer, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const shops = pgTable("shops", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
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
});

export const receiptsRelations = relations(receipts, ({ many }) => ({
  items: many(receiptItems),
}));

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt: one(receipts, { fields: [receiptItems.receiptId], references: [receipts.id] }),
}));
