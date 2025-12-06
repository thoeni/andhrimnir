import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { convertToCookidoo } from "@/lib/openaiCookidoo";
import { fetchRecipe } from "@/lib/recipeFetcher";
import { RecipeUrlRequestSchema } from "@/lib/validation";
import { authOptions } from "@/lib/auth";

// Simple in-memory rate limit (per IP) to protect the endpoint and OpenAI quota
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const buckets = new Map<string, { count: number; expiresAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.expiresAt < now) {
    buckets.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    // Require authentication for recipe conversion
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Please sign in to convert recipes" }, { status: 401 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (!rateLimit(ip)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please try again shortly." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = RecipeUrlRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body. Expecting { url: string }" }, { status: 400 });
    }
    const { url, language = "en" } = parsed.data;

    console.log(`[convert] fetch start url=${url}`);
    const recipeData = await fetchRecipe(url);

    if (!recipeData.ingredients.length && !recipeData.instructions.length && !recipeData.raw_content) {
      return NextResponse.json({ error: "Could not extract recipe data from the provided URL" }, { status: 400 });
    }

    const cookidooRecipe = await convertToCookidoo(recipeData, language);
    console.log(`[convert] success url=${url}`);

    return NextResponse.json({
      success: true,
      recipe: cookidooRecipe,
      originalUrl: url,
    });
  } catch (error) {
    console.error("Error converting recipe:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

