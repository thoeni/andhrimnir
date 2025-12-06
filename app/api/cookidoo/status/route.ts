import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateCookidooToken } from "@/lib/cookidoo";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        cookidooToken: true,
        cookidooTokenExp: true,
      },
    });

    if (!user?.cookidooToken) {
      return NextResponse.json({ 
        connected: false,
        message: "No Cookidoo account linked",
      });
    }

    // Log token info for debugging
    const cookieNames = user.cookidooToken.split(';').map(c => c.split('=')[0].trim());
    console.log("[Cookidoo Status] Stored cookies:", cookieNames.join(', '));
    
    // Check for essential cookies
    const hasOauth2Proxy = cookieNames.includes('_oauth2_proxy');
    const hasVAuthenticated = cookieNames.includes('v-authenticated');
    console.log(`[Cookidoo Status] Has _oauth2_proxy: ${hasOauth2Proxy}, Has v-authenticated: ${hasVAuthenticated}`);

    // Check if token is expired
    if (user.cookidooTokenExp && new Date(user.cookidooTokenExp) < new Date()) {
      return NextResponse.json({ 
        connected: false,
        message: "Cookidoo session expired - please reconnect",
      });
    }

    // Optionally validate the token is still working
    const isValid = await validateCookidooToken(user.cookidooToken);

    if (!isValid) {
      return NextResponse.json({ 
        connected: false,
        message: "Cookidoo session invalid - please reconnect",
      });
    }

    return NextResponse.json({ 
      connected: true,
      expiresAt: user.cookidooTokenExp,
    });

  } catch (error) {
    console.error("[Cookidoo Status] Error:", error);
    return NextResponse.json({ 
      error: "Failed to check Cookidoo status" 
    }, { status: 500 });
  }
}

// Disconnect Cookidoo account
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        cookidooToken: null,
        cookidooTokenExp: null,
      },
    });

    return NextResponse.json({ 
      success: true,
      message: "Cookidoo account disconnected",
    });

  } catch (error) {
    console.error("[Cookidoo Disconnect] Error:", error);
    return NextResponse.json({ 
      error: "Failed to disconnect Cookidoo" 
    }, { status: 500 });
  }
}

