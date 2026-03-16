const API = "";

// ── Root app (routing + locale) ───────────────────────────────────────────────

function app() {
  return {
    page: "settings",
    // Reactive locale revision counter — Alpine re-evaluates t() calls in
    // templates whenever this value changes.
    localeRev: 0,

    // Reactive translation helper.  Templates use x-text="t('key')" because
    // Alpine tracks property access on `this`; reading `this.localeRev` inside
    // the method is enough to make Alpine re-run the binding on locale change.
    t(key) {
      // eslint-disable-next-line no-unused-expressions
      this.localeRev; // tracked by Alpine
      return window.__i18nResolve(window.LOCALE, key);
    },

    init() {
      // Apply locale persisted from a previous session.
      // LOCALES is already populated by the locale <script> tags at this point.
      const saved = localStorage.getItem("locale") || "en";
      if (window.LOCALES[saved]) {
        window.LOCALE = window.LOCALES[saved];
        window.__localeCode = saved;
      }

      // Listen for locale swaps triggered by the switcher component.
      document.addEventListener("locale-changed", () => {
        this.localeRev += 1;
      });

      window.addEventListener("hashchange", () => this.applyHash());
      this.applyHash();
    },

    applyHash() {
      const hash = window.location.hash.slice(1) || "settings";

      if (hash === "settings") {
        this.page = "settings";
      } else if (hash === "receipts") {
        this.page = "receipts";
      } else if (hash === "receipts/new") {
        this.page = "receipt-form";
        this.$nextTick(() =>
          document.dispatchEvent(new CustomEvent("receipt-form-load", { detail: { id: null } }))
        );
      } else {
        const editMatch = hash.match(/^receipts\/(\d+)\/edit$/);
        if (editMatch) {
          this.page = "receipt-form";
          this.$nextTick(() =>
            document.dispatchEvent(new CustomEvent("receipt-form-load", { detail: { id: Number(editMatch[1]) } }))
          );
          return;
        }
        const detailMatch = hash.match(/^receipts\/(\d+)$/);
        if (detailMatch) {
          this.page = "receipt-details";
          this.$nextTick(() =>
            document.dispatchEvent(new CustomEvent("receipt-details-load", { detail: { id: Number(detailMatch[1]) } }))
          );
          return;
        }
        window.location.hash = "settings";
      }
    },
  };
}

// ── Language switcher ─────────────────────────────────────────────────────────

function langSwitcher() {
  return {
    // Data-driven list of available languages.
    // Add more entries here when new locale files are introduced.
    languages: [
      { code: "en", label: "EN" },
      { code: "be", label: "BE" },
    ],

    current: window.__localeCode || "en",

    init() {
      document.addEventListener("locale-changed", (e) => {
        this.current = e.detail.code;
      });
    },

    select(code) {
      if (code === this.current) return;
      window.setLocale(code);
      this.current = code;
    },
  };
}

// ── Settings: Shops ──────────────────────────────────────────────────────────

function shopsManager() {
  return {
    shops: [],
    newName: "",

    async init() { await this.load(); },

    async load() {
      const res = await fetch(`${API}/api/shops`);
      this.shops = await res.json();
    },

    async create() {
      await fetch(`${API}/api/shops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.newName }),
      });
      this.newName = "";
      await this.load();
    },

    async remove(id) {
      await fetch(`${API}/api/shops/${id}`, { method: "DELETE" });
      await this.load();
    },
  };
}

// ── Settings: Categories ─────────────────────────────────────────────────────

function categoriesManager() {
  return {
    shops: [],
    categories: [],
    selectedShopId: "",
    filterShopId: "",
    newOriginId: "",
    newTitle: "",
    currentPage: 1,
    pageSize: 20,

    get totalPages() {
      return Math.max(1, Math.ceil(this.categories.length / this.pageSize));
    },

    get pagedCategories() {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.categories.slice(start, start + this.pageSize);
    },

    shopIcon(shopId) {
      const shop = this.shops.find(s => s.id === shopId);
      return shop?.icon || null;
    },

    shopName(shopId) {
      const shop = this.shops.find(s => s.id === shopId);
      return shop?.name || "";
    },

    async init() {
      const res = await fetch(`${API}/api/shops`);
      this.shops = await res.json();
      await this.load();
    },

    async load() {
      const url = this.filterShopId
        ? `${API}/api/categories?shopId=${this.filterShopId}`
        : `${API}/api/categories`;
      const res = await fetch(url);
      this.categories = await res.json();
      // Clamp current page in case items were removed or filter changed
      if (this.currentPage > this.totalPages) {
        this.currentPage = this.totalPages;
      }
    },

    async create() {
      await fetch(`${API}/api/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId: Number(this.selectedShopId), originId: this.newOriginId, title: this.newTitle }),
      });
      this.newOriginId = "";
      this.newTitle = "";
      await this.load();
      // Jump to last page so the newly added item is visible
      this.currentPage = this.totalPages;
    },

    async remove(id) {
      await fetch(`${API}/api/categories/${id}`, { method: "DELETE" });
      await this.load();
      // load() already clamps, but ensure we don't sit on an empty page
      if (this.currentPage > this.totalPages) {
        this.currentPage = this.totalPages;
      }
    },
  };
}

// ── Receipts list ─────────────────────────────────────────────────────────────

function receiptsManager() {
  return {
    receipts: [],
    confirm: { visible: false, receiptId: null },

    async init() { await this.load(); },

    async load() {
      const res = await fetch(`${API}/api/receipts`);
      this.receipts = await res.json();
    },

    confirmRemove(receipt) {
      this.confirm = { visible: true, receiptId: receipt.id };
    },

    async remove() {
      await fetch(`${API}/api/receipts/${this.confirm.receiptId}`, { method: "DELETE" });
      this.confirm.visible = false;
      await this.load();
    },
  };
}

// ── Receipt details ───────────────────────────────────────────────────────────

function receiptDetails() {
  return {
    receiptId: null,
    title: "",
    items: [],
    suggestions: [],
    optimizing: false,
    optimizeError: "",
    savingVariant: false,
    variants: [],
    refreshingItems: {},
    shops: [],
    selectedShopIds: [],
    categoriesPerItem: 2,
    configOpen: false,

    async init() {
      document.addEventListener("receipt-details-load", (e) => this.load(e.detail.id));
      const res = await fetch(`${API}/api/shops`);
      this.shops = await res.json();
      this.selectedShopIds = this.shops.map((s) => s.id);
    },

    toggleShop(id) {
      if (this.selectedShopIds.includes(id)) {
        this.selectedShopIds = this.selectedShopIds.filter((s) => s !== id);
      } else {
        this.selectedShopIds = [...this.selectedShopIds, id];
      }
    },

    async load(id) {
      this.receiptId = id;
      this.items = [];
      this.suggestions = [];
      this.variants = [];
      const res = await fetch(`${API}/api/receipts/${id}`);
      const data = await res.json();
      this.title = data.title;
      this.items = data.items ?? [];
      await this.loadVariants();
    },

    async loadVariants() {
      const res = await fetch(`${API}/api/variants?receiptId=${this.receiptId}`);
      this.variants = await res.json();
    },

    get suggestionsTotal() {
      return this.suggestions
        .reduce((sum, s) => sum + parseFloat(s.price || "0"), 0)
        .toFixed(2);
    },

    formatDate(iso) {
      return new Date(iso).toLocaleString();
    },

    async optimize() {
      this.optimizing = true;
      this.optimizeError = "";
      this.suggestions = [];
      try {
        const body = {
          categoriesPerItem: this.categoriesPerItem,
          ...(this.selectedShopIds.length !== this.shops.length && { shopIds: this.selectedShopIds }),
        };
        const res = await fetch(`${API}/api/optimize/${this.receiptId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { this.optimizeError = data.error ?? t("receiptDetails.unknownError"); return; }
        this.suggestions = data;
      } catch (e) {
        this.optimizeError = e.message;
      } finally {
        this.optimizing = false;
      }
    },

    async saveVariant() {
      this.savingVariant = true;
      try {
        await fetch(`${API}/api/variants`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiptId: this.receiptId, suggestions: this.suggestions }),
        });
        this.suggestions = [];
        await this.loadVariants();
      } finally {
        this.savingVariant = false;
      }
    },

    async deleteVariant(id) {
      await fetch(`${API}/api/variants/${id}`, { method: "DELETE" });
      await this.loadVariants();
    },

    productUrl(item) {
      const shop = item.product.category?.shop;
      if (!shop) return null;
      const name = (shop.name || "").toLowerCase();
      if (name.includes("edostavka")) return `https://edostavka.by/product/${item.product.originId}`;
      if (name.includes("green") && item.product.slug) return `https://green-dostavka.by/product/${item.product.slug}/`;
      return null;
    },

    // Returns true when the saved price on a variant item differs from the
    // current product price fetched alongside the variant.
    itemPriceChanged(item) {
      return parseFloat(item.price) !== parseFloat(item.product.price);
    },

    // Recalculates the total using current product prices.
    variantCurrentTotal(variant) {
      return variant.items
        .reduce((sum, item) => sum + parseFloat(item.product.price || "0"), 0)
        .toFixed(2);
    },

    // Returns true when at least one item in the variant has a changed price.
    variantHasPriceChange(variant) {
      return variant.items.some((item) => this.itemPriceChanged(item));
    },

    async refreshVariantItem(variant, item) {
      if (this.refreshingItems[item.id]) return;
      this.refreshingItems[item.id] = true;
      this.refreshingItems = { ...this.refreshingItems };
      try {
        const res = await fetch(
          `${API}/api/variants/${variant.id}/items/${item.id}/refresh`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error("refresh failed");
        const data = await res.json();
        const idx = variant.items.findIndex((i) => i.id === item.id);
        if (idx !== -1) variant.items[idx] = { ...data.item };
        variant.totalPrice = data.newTotal;
      } catch (_e) {
        this.refreshingItems[item.id + "_err"] = true;
        this.refreshingItems = { ...this.refreshingItems };
        setTimeout(() => {
          delete this.refreshingItems[item.id + "_err"];
          this.refreshingItems = { ...this.refreshingItems };
        }, 3000);
      } finally {
        delete this.refreshingItems[item.id];
        this.refreshingItems = { ...this.refreshingItems };
      }
    },
  };
}

// ── Receipt form (create / edit) ──────────────────────────────────────────────

function receiptForm() {
  return {
    receiptId: null,
    title: "",
    items: [],
    newItemTitle: "",
    newItemValue: "",
    newItemNote: "",

    async init() {
      document.addEventListener("receipt-form-load", (e) => this.load(e.detail.id));
    },

    async load(id) {
      this.receiptId = id;
      this.items = [];
      if (!id) {
        this.title = "";
        return;
      }
      const res = await fetch(`${API}/api/receipts/${id}`);
      const data = await res.json();
      this.title = data.title;
      this.items = data.items ?? [];
    },

    async save() {
      if (this.receiptId) {
        await fetch(`${API}/api/receipts/${this.receiptId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: this.title }),
        });
      } else {
        const res = await fetch(`${API}/api/receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: this.title }),
        });
        const created = await res.json();
        this.receiptId = created.id;
        window.location.hash = `receipts/${created.id}/edit`;
        await this.load(this.receiptId);
      }
    },

    async addItem() {
      await fetch(`${API}/api/receipts/${this.receiptId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: this.newItemTitle, value: this.newItemValue, note: this.newItemNote || null }),
      });
      this.newItemTitle = "";
      this.newItemValue = "";
      this.newItemNote = "";
      await this.load(this.receiptId);
    },

    async updateItem(item) {
      await fetch(`${API}/api/receipts/${this.receiptId}/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: item.title, value: item.value, note: item.note }),
      });
    },

    async removeItem(itemId) {
      await fetch(`${API}/api/receipts/${this.receiptId}/items/${itemId}`, { method: "DELETE" });
      await this.load(this.receiptId);
    },
  };
}
