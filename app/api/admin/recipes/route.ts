import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

const ADMIN_EMAIL = "thoeni@gmail.com";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    // Only allow admin access
    if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const recipes = await prisma.recipe.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        originalUrl: true,
        language: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({ recipes });
  } catch (error) {
    console.error("Error fetching admin recipes:", error);
    return NextResponse.json({ error: "Failed to fetch recipes" }, { status: 500 });
  }
}

