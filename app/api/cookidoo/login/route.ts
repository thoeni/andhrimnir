import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loginToCookidoo } from "@/lib/cookidoo";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    console.log(`[Cookidoo API] Attempting login for user ${session.user.id}...`);

    const result = await loginToCookidoo(email, password);

    if (!result.success || !result.token) {
      return NextResponse.json({ 
        error: result.error || "Login failed" 
      }, { status: 400 });
    }

    // Save the token to the user's profile
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        cookidooToken: result.token,
        cookidooTokenExp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    console.log(`[Cookidoo API] Token saved for user ${session.user.id}`);

    return NextResponse.json({ 
      success: true,
      message: "Cookidoo account linked successfully",
    });

  } catch (error) {
    console.error("[Cookidoo API] Error:", error);
    return NextResponse.json({ 
      error: "Failed to connect to Cookidoo" 
    }, { status: 500 });
  }
}

