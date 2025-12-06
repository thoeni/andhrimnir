import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const ADMIN_EMAIL = "thoeni@gmail.com";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 50), 200);
    
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        blocked: true,
        blockedAt: true,
        blockedReason: true,
        _count: {
          select: { recipes: true },
        },
      },
    });

    const mapped = users.map((u) => ({
      ...u,
      recipeCount: u._count.recipes,
      _count: undefined,
    }));

    return NextResponse.json({ users: mapped });
  } catch (error) {
    console.error("Error listing users for admin:", error);
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }
}

