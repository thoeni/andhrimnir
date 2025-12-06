import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SaveRecipeRequestSchema } from "@/lib/validation";
import { generateUniqueSlug } from "@/lib/slug";

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 20), 100);
    const recipes = await prisma.recipe.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        originalUrl: true,
        language: true,
        createdAt: true,
        share: { select: { slug: true } },
      },
    });
    const mapped = recipes.map((r) => ({
      ...r,
      slug: r.share?.slug ?? null,
    }));
    return NextResponse.json({ recipes: mapped });
  } catch (error) {
    console.error("Error listing recipes:", error);
    return NextResponse.json({ error: "Failed to list recipes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = SaveRecipeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload for saving recipe" }, { status: 400 });
    }

    const { title, originalUrl, cookidooJson, language } = parsed.data;

    const slug = await generateUniqueSlug();

    const recipe = await prisma.recipe.create({
      data: {
        title,
        originalUrl,
        cookidooJson: cookidooJson as Prisma.InputJsonValue,
        language: language || "en",
        share: {
          create: {
            slug,
          },
        },
      },
      include: {
        share: true,
      },
    });

    return NextResponse.json({ recipe });
  } catch (error) {
    console.error("Error saving recipe:", error);
    return NextResponse.json({ error: "Failed to save recipe" }, { status: 500 });
  }
}

