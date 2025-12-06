import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncRecipeToCookidoo } from "@/lib/cookidoo";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's Cookidoo token
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        cookidooToken: true,
        cookidooTokenExp: true,
      },
    });

    if (!user?.cookidooToken) {
      return NextResponse.json({ 
        error: "Cookidoo account not connected. Please connect in Settings." 
      }, { status: 400 });
    }

    // Check token expiration
    if (user.cookidooTokenExp && new Date(user.cookidooTokenExp) < new Date()) {
      return NextResponse.json({ 
        error: "Cookidoo session expired. Please reconnect in Settings." 
      }, { status: 400 });
    }

    const body = await request.json();
    const { recipeData, locale = "en-GB", savedRecipeId } = body;

    if (!recipeData) {
      return NextResponse.json({ error: "Recipe data is required" }, { status: 400 });
    }

    console.log(`[Cookidoo Sync API] Syncing recipe for user ${session.user.id}...`);

    const result = await syncRecipeToCookidoo(
      user.cookidooToken,
      recipeData,
      locale
    );

    if (!result.success) {
      // If session expired, clear the stored token
      if (result.error?.includes("Session expired") || result.error?.includes("401")) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: {
            cookidooToken: null,
            cookidooTokenExp: null,
          },
        });
      }

      return NextResponse.json({ 
        error: result.error,
        recipeId: result.recipeId, // Return ID if created but patch failed
      }, { status: 400 });
    }

    // Update the saved recipe with Cookidoo sync info
    if (savedRecipeId && result.recipeId) {
      try {
        await prisma.recipe.update({
          where: { id: savedRecipeId },
          data: {
            cookidooId: result.recipeId,
            cookidooUrl: result.recipeUrl,
            syncedAt: new Date(),
          },
        });
        console.log(`[Cookidoo Sync API] Updated recipe ${savedRecipeId} with Cookidoo info`);
      } catch (err) {
        console.error(`[Cookidoo Sync API] Failed to update recipe sync status:`, err);
        // Don't fail the whole request if this update fails
      }
    }

    return NextResponse.json({
      success: true,
      recipeId: result.recipeId,
      recipeUrl: result.recipeUrl,
    });

  } catch (error) {
    console.error("[Cookidoo Sync API] Error:", error);
    return NextResponse.json({ 
      error: "Failed to sync recipe to Cookidoo" 
    }, { status: 500 });
  }
}

