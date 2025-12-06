import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { SaveRecipeRequestSchema } from "@/lib/validation";
import { generateUniqueSlug } from "@/lib/slug";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 20), 100);
    
    // Filter by user if logged in, otherwise show all (for backwards compatibility)
    const where = session?.user?.id ? { userId: session.user.id } : {};
    
    const recipes = await prisma.recipe.findMany({
      where,
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
    const session = await getServerSession(authOptions);
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
        userId: session?.user?.id || null, // Associate with user if logged in
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

