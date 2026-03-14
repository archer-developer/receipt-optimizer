# Receipt Optimizer

A self-hosted web app that helps you optimize grocery shopping. Enter your receipt items, sync product catalogs from local shops, and let an LLM suggest the best matching products with prices and reasoning.

## Features

- **Receipt management** — create and edit receipts with individual line items and notes
- **AI optimization** — two-step LLM pipeline picks the best-matching products for each receipt item, optimizing for price/value ratio
- **Saved propositions** — store and compare multiple optimization variants per receipt; re-check individual items against the latest catalog at any time
- **Product catalog sync** — parser fetches live product data (prices, slugs, availability) from shop APIs
- **Price change tracking** — saved propositions highlight products whose prices have changed since the variant was created
- **Multilingual UI** — English and Belarusian; easily extensible to more languages
- **Mobile-friendly** — responsive layout with burger menu, icon-only buttons on small screens

## Stack

| Layer | Technology |
|---|---|
| Frontend | Alpine.js v3, plain CSS, nginx (no build step) |
| API | Hono + Node.js |
| Database | PostgreSQL 16 + Drizzle ORM |
| Parsers | Node.js / tsx scripts |
| Infrastructure | Docker Compose, pnpm workspaces |
| LLM | Anthropic Claude or Google Gemini (configurable) |

## Project structure

```
packages/
  database/   # Drizzle schema, migrations, shared DB client
  api/        # Hono REST API (port 3000)
  ui/         # Static frontend served by nginx (port 8080)
  parsers/    # One-shot catalog sync scripts
```

## Getting started

### 1. Configure environment

Copy `.env.example` to `.env` (or set variables directly) and fill in your API keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
# or
GEMINI_API_KEY=AIza...
LLM_PROVIDER=anthropic   # or: gemini
LLM_MODEL=               # optional override; leave empty for defaults
```

### 2. Start services

```bash
docker compose up -d
```

The UI is available at **http://localhost:8080**.

### 3. Apply database migrations

On first run, apply the schema:

```bash
cd packages/database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/receipt_optimizer pnpm db:migrate
```

### 4. Sync the product catalog

Run the Green shop parser to populate products and categories:

```bash
docker compose build parser
docker compose run --rm parser pnpm --filter @receipt-optimizer/parsers parse:green
```

> **Note:** Always rebuild the parser image after code changes before running it.

## Usage

1. **Settings** — add a shop and import categories by entering their origin IDs
2. **Receipts** — create a receipt and add line items (title + quantity/value, optional note)
3. **Optimize** — on the receipt detail page, click *Optimize with AI* to get product suggestions
4. **Save** — save a proposition to compare it later; refresh individual items at any time to re-run the LLM against the latest catalog

## LLM configuration

| Variable | Default (Anthropic) | Default (Gemini) |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `gemini` |
| `LLM_MODEL` | `claude-haiku-4-5-20251001` | `gemini-3.1-flash-lite-preview` |

Set `LLM_MODEL` to override the model for either provider.

## Development

The API and UI support live reload without rebuilding:

- **UI** — `packages/ui/public/` is mounted as a Docker volume; save a file and refresh the browser
- **API** — `packages/api/src/` and `packages/database/src/` are also volume-mounted; the container runs `tsx watch` and restarts on file changes

For schema changes:

```bash
cd packages/database
DATABASE_URL=... pnpm db:generate   # generate migration
DATABASE_URL=... pnpm db:migrate    # apply migration
```

## Adding a language

1. Copy `packages/ui/public/locales/en.js` to `locales/xx.js` and translate all values
2. Add `<script src="locales/xx.js"></script>` in `index.html`
3. Add `{ code: 'xx', label: 'XX' }` to the `languages` array in `langSwitcher()` in `app.js`
