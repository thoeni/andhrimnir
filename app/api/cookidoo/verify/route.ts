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
    const { savedRecipeId, cookidooId, locale = "en-GB" } = body;

    if (!savedRecipeId || !cookidooId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get user's Cookidoo token
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        cookidooToken: true,
      },
    });

    if (!user?.cookidooToken) {
      // No token, can't verify - assume still synced
      return NextResponse.json({ exists: true, reason: "no_token" });
    }

    // Extract domain from locale (e.g., en-GB -> cookidoo.co.uk)
    const domainMap: Record<string, string> = {
      "en-GB": "cookidoo.co.uk",
      "en-US": "cookidoo.com",
      "it-IT": "cookidoo.it",
      "de-DE": "cookidoo.de",
      "fr-FR": "cookidoo.fr",
      "es-ES": "cookidoo.es",
      "pt-PT": "cookidoo.pt",
      "nl-NL": "cookidoo.nl",
      "pl-PL": "cookidoo.pl",
    };
    const domain = domainMap[locale] || "cookidoo.co.uk";

    // Make HEAD request to check if recipe exists
    const checkUrl = `https://${domain}/created-recipes/${locale}/${cookidooId}`;
    
    console.log(`[Cookidoo Verify] Checking: ${checkUrl}`);

    const response = await fetch(checkUrl, {
      method: "HEAD",
      headers: {
        "Cookie": user.cookidooToken,
        "Accept": "application/json",
      },
      redirect: "manual", // Don't follow redirects
    });

    console.log(`[Cookidoo Verify] Response status: ${response.status}`);

    // If 404 or redirect to login (302/303), recipe doesn't exist
    if (response.status === 404 || response.status === 302 || response.status === 303) {
      // Clear sync status in database
      await prisma.recipe.update({
        where: { id: savedRecipeId },
        data: {
          cookidooId: null,
          cookidooUrl: null,
          syncedAt: null,
        },
      });
      
      console.log(`[Cookidoo Verify] Recipe ${savedRecipeId} no longer exists on Cookidoo, cleared sync status`);
      
      return NextResponse.json({ 
        exists: false, 
        cleared: true,
        reason: response.status === 404 ? "not_found" : "redirect" 
      });
    }

    // Recipe exists
    return NextResponse.json({ exists: true });

  } catch (error) {
    console.error("[Cookidoo Verify] Error:", error);
    // On error, don't clear status - assume still synced
    return NextResponse.json({ exists: true, reason: "error" });
  }
}

