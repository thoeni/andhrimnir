import * as cheerio from "cheerio";
import { RecipeData } from "@/lib/types";

const FETCH_TIMEOUT_MS = 15000;

// Custom error class for recipe fetch errors
export class RecipeFetchError extends Error {
  constructor(
    message: string,
    public readonly code: "URL_NOT_FOUND" | "URL_MALFORMED" | "FETCH_FAILED" | "TIMEOUT" | "NO_RECIPE"
  ) {
    super(message);
    this.name = "RecipeFetchError";
  }
}

// Fetch and parse recipe from URL with timeout
export async function fetchRecipe(url: string): Promise<RecipeData> {
  // Validate URL format first
  try {
    new URL(url);
  } catch {
    throw new RecipeFetchError(
      "The URL appears to be malformed. Please check the format and try again.",
      "URL_MALFORMED"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (response.status === 404) {
      throw new RecipeFetchError(
        "The page was not found. The recipe may have been moved or deleted.",
        "URL_NOT_FOUND"
      );
    }

    if (!response.ok) {
      throw new RecipeFetchError(
        `Could not access the page (status: ${response.status}). Please check the URL.`,
        "FETCH_FAILED"
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const recipeData = extractSchemaRecipe($, url);
    if (recipeData) return recipeData;

    return extractFromHtml($, url);
  } catch (error) {
    if (error instanceof RecipeFetchError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RecipeFetchError(
        "The request timed out. The website may be slow or unavailable.",
        "TIMEOUT"
      );
    }
    // Handle network errors (e.g., DNS resolution failed, connection refused)
    if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network"))) {
      throw new RecipeFetchError(
        "Could not connect to the website. Please check if the URL is correct.",
        "URL_MALFORMED"
      );
    }
    throw new RecipeFetchError(
      error instanceof Error ? error.message : "An unexpected error occurred",
      "FETCH_FAILED"
    );
  } finally {
    clearTimeout(timeout);
  }
}

// Extract recipe from Schema.org JSON-LD
function extractSchemaRecipe($: cheerio.CheerioAPI, url: string): RecipeData | null {
  const scripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < scripts.length; i++) {
    try {
      const content = $(scripts[i]).html();
      if (!content) continue;

      const data = JSON.parse(content);
      const items = data["@graph"] || [data];

      for (const item of Array.isArray(items) ? items : [items]) {
        if (item["@type"] === "Recipe" || (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))) {
          return normalizeSchemaRecipe(item, url);
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

// Normalize schema.org Recipe to our format
function normalizeSchemaRecipe(schema: Record<string, unknown>, url: string): RecipeData {
  const getText = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(getText).filter(Boolean).join(", ");
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      return (obj.text as string) || (obj.name as string) || null;
    }
    return null;
  };

  const parseDuration = (duration: unknown): string | null => {
    if (typeof duration !== "string") return null;
    const match = duration.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
    if (!match) return duration;

    const [, hours, minutes, seconds] = match;
    const parts: string[] = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}min`);
    if (seconds) parts.push(`${seconds}s`);
    return parts.length > 0 ? parts.join(" ") : null;
  };

  const rawIngredients = (schema.recipeIngredient || schema.ingredients || []) as unknown[];
  const ingredients: string[] = [];
  for (const ing of Array.isArray(rawIngredients) ? rawIngredients : [rawIngredients]) {
    const text = getText(ing);
    if (text) ingredients.push(text);
  }

  const rawInstructions = (schema.recipeInstructions || []) as unknown[];
  const instructions: string[] = [];

  const processInstruction = (inst: unknown): void => {
    if (typeof inst === "string") {
      instructions.push(inst);
    } else if (typeof inst === "object" && inst !== null) {
      const obj = inst as Record<string, unknown>;
      if (obj["@type"] === "HowToSection") {
        const sectionSteps = (obj.itemListElement || []) as unknown[];
        for (const step of Array.isArray(sectionSteps) ? sectionSteps : [sectionSteps]) {
          processInstruction(step);
        }
      } else {
        const text = getText(obj.text || obj.name);
        if (text) instructions.push(text);
      }
    }
  };

  for (const inst of Array.isArray(rawInstructions) ? rawInstructions : [rawInstructions]) {
    processInstruction(inst);
  }

  let author: string | null = null;
  if (schema.author) {
    if (typeof schema.author === "string") {
      author = schema.author;
    } else if (typeof schema.author === "object") {
      const authorObj = schema.author as Record<string, unknown>;
      author = getText(authorObj.name) || null;
    }
  }

  return {
    source: "schema.org",
    title: getText(schema.name),
    description: getText(schema.description),
    author,
    prep_time: parseDuration(schema.prepTime),
    cook_time: parseDuration(schema.cookTime),
    total_time: parseDuration(schema.totalTime),
    servings: getText(schema.recipeYield),
    ingredients,
    instructions,
    cuisine: getText(schema.recipeCuisine),
    category: getText(schema.recipeCategory),
    keywords: getText(schema.keywords),
    image: getText(schema.image),
    url,
  };
}

// Fallback: Extract recipe from HTML
function extractFromHtml($: cheerio.CheerioAPI, url: string): RecipeData {
  $("script, style, nav, footer, header, aside, .ad, .advertisement").remove();

  const title = $("h1").first().text().trim() || $("title").text().trim() || null;

  const ingredients: string[] = [];
  const ingredientContainers = $('[class*="ingredient" i], [id*="ingredient" i]');
  ingredientContainers.find("li").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 2) ingredients.push(text);
  });

  if (ingredients.length === 0) {
    ingredientContainers.each((_, el) => {
      const tagName = el.type === "tag" ? el.name?.toLowerCase() : undefined;
      if (["li", "p", "span", "div"].includes(tagName || "")) {
        const text = $(el).text().trim();
        if (text && text.length > 2 && text.length < 200) {
          ingredients.push(text);
        }
      }
    });
  }

  const instructions: string[] = [];
  const instructionContainers = $(
    '[class*="instruction" i], [class*="direction" i], [class*="step" i], [class*="method" i], [class*="preparation" i], [id*="instruction" i], [id*="direction" i]'
  );
  instructionContainers.find("li, p").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10) instructions.push(text);
  });

  let rawContent: string | null = null;
  if (ingredients.length === 0 || instructions.length === 0) {
    const mainEl = $("main, article, [class*='content' i], [class*='recipe' i]").first();
    rawContent = (mainEl.length ? mainEl : $("body")).text().replace(/\\s+/g, " ").trim().slice(0, 10000);
  }

  return {
    source: "html_extraction",
    title,
    description: null,
    author: null,
    prep_time: null,
    cook_time: null,
    total_time: null,
    servings: null,
    ingredients,
    instructions,
    cuisine: null,
    category: null,
    keywords: null,
    image: null,
    raw_content: rawContent,
    url,
  };
}

