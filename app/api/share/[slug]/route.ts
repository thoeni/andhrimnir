import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 });
    }

    const share = await prisma.share.findUnique({
      where: { slug },
      include: { recipe: true },
    });

    if (!share?.recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    return new NextResponse(JSON.stringify(share.recipe.cookidooJson), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching shared recipe:", error);
    return NextResponse.json({ error: "Failed to fetch recipe" }, { status: 500 });
  }
}

