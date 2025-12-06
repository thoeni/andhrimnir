import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    // Validate that the token contains the required cookies
    const hasOauth2Proxy = token.includes('_oauth2_proxy=');
    const hasVAuthenticated = token.includes('v-authenticated=');

    if (!hasOauth2Proxy || !hasVAuthenticated) {
      return NextResponse.json({ 
        error: "Token must contain _oauth2_proxy and v-authenticated cookies" 
      }, { status: 400 });
    }

    // Clean up the token - ensure it's properly formatted
    let cleanToken = token.trim();
    
    // Add essential cookies if missing
    if (!cleanToken.includes('v-is-authenticated=')) {
      cleanToken = `v-is-authenticated=true; ${cleanToken}`;
    }
    if (!cleanToken.includes('tmde-lang=')) {
      cleanToken = `tmde-lang=en-GB; ${cleanToken}`;
    }

    console.log(`[Cookidoo Manual] Saving token for user ${session.user.id}`);
    console.log(`[Cookidoo Manual] Token cookies: ${cleanToken.split(';').map(c => c.split('=')[0].trim()).join(', ')}`);

    // Save the token to the user's profile
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        cookidooToken: cleanToken,
        cookidooTokenExp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return NextResponse.json({ 
      success: true,
      message: "Token saved successfully",
    });

  } catch (error) {
    console.error("[Cookidoo Manual] Error:", error);
    return NextResponse.json({ 
      error: "Failed to save token" 
    }, { status: 500 });
  }
}

