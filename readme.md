# Andhrimnir

> *Named after the Norse cook who feeds the einherjar (heroic dead) in Valhalla*

A web application that converts any recipe URL into **Thermomix/Cookidoo format** with precise times, temperatures, and speeds.

## Features

- **URL-based recipe fetching** — Paste any food blog URL
- **Intelligent extraction** — Uses Schema.org structured data when available, falls back to HTML parsing
- **AI-powered conversion** — OpenAI transforms recipes into precise Thermomix instructions
- **Cookidoo-ready format** — Output JSON matches Cookidoo's "Created Recipes" structure
- **Beautiful UI** — Clean white and green design matching Thermomix branding

## Quick Start

### Prerequisites

- Node.js 18+
- OpenAI API key
- Postgres (Vercel Postgres/Neon free tier works well)

### Installation

```bash
# Install dependencies
npm install

# Set up environment
cat <<'EOF' > .env.local
OPENAI_API_KEY=sk-your-key-here
DATABASE_URL=postgresql://user:password@host:port/dbname
EOF
```

### Running

```bash
# Development server
npm run dev

# Open in browser
open http://localhost:3000
```

## Usage

1. Open the app in your browser
2. Paste a recipe URL from any food blog
3. Click "Convert Recipe"
4. View the converted recipe with Thermomix settings
5. Copy the JSON for use in Cookidoo's "Created Recipes"

## Project Structure

```
andhrimnir/
├── app/
│   ├── layout.tsx           # Root layout with fonts
│   ├── page.tsx             # Main page component
│   ├── globals.css          # Styles (Thermomix green/white)
│   └── api/
│       ├── convert/route.ts # Convert + persist recipes
│       └── recipes/         # List and fetch recipes
├── lib/
│   ├── prisma.ts            # Prisma client helper
│   ├── recipeFetcher.ts     # Fetch/parse recipes
│   ├── openaiCookidoo.ts    # OpenAI conversion helper
│   ├── prompts.ts           # System prompt
│   └── validation.ts        # Zod schemas
├── prisma/
│   ├── schema.prisma        # DB schema (recipes table)
│   └── migrations/          # Created after first migrate
├── package.json
├── tsconfig.json
└── readme.md
```

## API

### POST `/api/convert`

Convert a recipe URL to Cookidoo format.

**Request:**
```json
{
  "url": "https://www.seriouseats.com/perfect-risotto-recipe"
}
```

**Response:**
```json
{
  "success": true,
  "originalUrl": "https://...",
  "recipe": {
    "title": "Perfect Risotto",
    "servings": "4 portions",
    "ingredients": [...],
    "steps": [
      {
        "number": 1,
        "instruction": "Chop onion",
        "thermomix": {
          "time_seconds": 5,
          "speed": 5,
          "temperature": null,
          "mode": "normal"
        }
      }
    ]
  }
}
```

### GET `/api/recipes`
- List recent recipes (id, title, originalUrl, createdAt). Optional `limit` param (default 20, max 100).

### GET `/api/recipes/[id]`
- Fetch a stored recipe by id.

## Recipe Output Format

The output follows a structured format optimized for Thermomix:

- **Ingredients** grouped logically with quantities in metric
- **Steps** with precise Thermomix settings:
  - `time_seconds` — Duration in seconds
  - `speed` — 1-10, "soft-stir", or "turbo"
  - `temperature` — null, 37-120°C, or "varoma"
  - `mode` — "normal" or "reverse"
  - `accessory` — "butterfly", "varoma", etc.

## Supported Recipe Sources

Works best with food blogs that use Schema.org Recipe structured data:

- Serious Eats
- BBC Good Food
- Bon Appétit
- AllRecipes
- Food Network
- NYT Cooking
- Most WordPress recipe plugins

For sites without structured data, the app falls back to HTML parsing.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **AI:** OpenAI GPT-4o
- **Parsing:** Cheerio
- **Styling:** CSS (custom, Thermomix-branded)
- **Database:** Postgres (Prisma ORM; Vercel Postgres/Neon friendly)

## Deployment

Deploy to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/andhrimnir)

Remember to set `OPENAI_API_KEY` in your environment variables.

## License

MIT
