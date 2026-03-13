const API = "";

// ── Root app (routing) ────────────────────────────────────────────────────────

function app() {
  return {
    page: "settings",

    init() {
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
    },

    async remove(id) {
      await fetch(`${API}/api/categories/${id}`, { method: "DELETE" });
      await this.load();
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

    async init() {
      document.addEventListener("receipt-details-load", (e) => this.load(e.detail.id));
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
        const res = await fetch(`${API}/api/optimize/${this.receiptId}`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) { this.optimizeError = data.error ?? "Unknown error"; return; }
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
