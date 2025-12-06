interface CookidooLoginResult {
  success: boolean;
  token?: string;
  error?: string;
}

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

/**
 * Extract cookies from Set-Cookie headers and merge with existing cookies
 */
function extractCookies(response: Response, existingCookies: Map<string, string>): void {
  // Try getSetCookie() first (modern API)
  let setCookies: string[] = [];
  
  if (typeof response.headers.getSetCookie === 'function') {
    setCookies = response.headers.getSetCookie();
  }
  
  // Fallback: try to get raw set-cookie header
  // Note: In Node.js fetch, multiple set-cookie headers may be combined
  if (setCookies.length === 0) {
    const rawCookies = response.headers.get('set-cookie');
    if (rawCookies) {
      // Split on comma, but be careful not to split on commas within cookie values
      // A simple approach: split on ", " followed by a word and "="
      setCookies = rawCookies.split(/,\s*(?=[^;]+=)/);
    }
  }
  
  for (const cookie of setCookies) {
    const [nameValue] = cookie.split(";");
    const [name, ...valueParts] = nameValue.split("=");
    if (name && name.trim()) {
      existingCookies.set(name.trim(), valueParts.join("="));
    }
  }
}

/**
 * Convert cookie map to cookie header string
 */
function cookiesToString(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/**
 * Login to Cookidoo and capture the session token.
 * 
 * Flow:
 * 1. Visit login page to get initial cookies (cidaas_dr, __cf_bm)
 * 2. Extract requestId from the login form
 * 3. POST credentials to login endpoint
 * 4. Follow redirects to complete OAuth flow
 * 5. Capture final session cookies
 */
export async function loginToCookidoo(
  email: string,
  password: string
): Promise<CookidooLoginResult> {
  const cookies = new Map<string, string>();
  
  try {
    console.log("[Cookidoo] Step 1: Visiting login page...");
    
    // Step 1: Visit the login page to get initial cookies and requestId
    const loginPageRes = await fetch("https://eu.login.vorwerk.com/ciam/login", {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    extractCookies(loginPageRes, cookies);
    const html = await loginPageRes.text();
    
    console.log("[Cookidoo] Got cookies:", Array.from(cookies.keys()).join(", "));

    // Extract requestId from the page
    // It could be in various formats - let's try multiple patterns
    let requestId: string | null = null;
    
    const patterns = [
      /name="requestId"[^>]*value="([^"]+)"/i,
      /value="([^"]+)"[^>]*name="requestId"/i,
      /"requestId"\s*:\s*"([^"]+)"/i,
      /requestId[=:]'?([a-f0-9-]{36})'?/i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        requestId = match[1];
        break;
      }
    }

    if (!requestId) {
      console.log("[Cookidoo] Could not find requestId, checking for redirect...");
      // The page might redirect us first, let's check the response URL
      console.log("[Cookidoo] Final URL:", loginPageRes.url);
      
      // Try to extract from URL if present
      const urlMatch = loginPageRes.url.match(/requestId=([a-f0-9-]+)/i);
      if (urlMatch) {
        requestId = urlMatch[1];
      }
    }

    if (!requestId) {
      // Generate a UUID as requestId (some auth flows accept client-generated ones)
      requestId = crypto.randomUUID();
      console.log("[Cookidoo] Using generated requestId:", requestId);
    } else {
      console.log("[Cookidoo] Found requestId:", requestId.substring(0, 8) + "...");
    }

    // Step 2: Submit login credentials
    console.log("[Cookidoo] Step 2: Submitting credentials...");
    
    const loginRes = await fetch("https://ciam.prod.cookidoo.vorwerk-digital.com/login-srv/login", {
      method: "POST",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "max-age=0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://eu.login.vorwerk.com",
        "Referer": "https://eu.login.vorwerk.com/",
        "User-Agent": USER_AGENT,
        "Cookie": cookiesToString(cookies),
      },
      body: new URLSearchParams({
        requestId,
        username: email,
        password: password,
      }).toString(),
      redirect: "manual",
    });

    extractCookies(loginRes, cookies);
    console.log("[Cookidoo] Login response status:", loginRes.status);
    
    // Check for errors
    if (loginRes.status === 401 || loginRes.status === 403) {
      return { success: false, error: "Invalid email or password" };
    }

    // Step 3: Follow the redirect chain
    let location = loginRes.headers.get("location");
    
    if (!location && loginRes.status !== 302) {
      const body = await loginRes.text();
      if (body.includes("error") || body.includes("Invalid") || body.includes("invalid")) {
        return { success: false, error: "Invalid email or password" };
      }
      console.log("[Cookidoo] No redirect, status:", loginRes.status);
      return { success: false, error: "Login failed - unexpected response" };
    }

    console.log("[Cookidoo] Step 3: Following redirect chain...");
    
    let redirectCount = 0;
    const maxRedirects = 15;
    
    while (location && redirectCount < maxRedirects) {
      redirectCount++;
      const domain = new URL(location).hostname;
      console.log(`[Cookidoo] Redirect ${redirectCount} to ${domain}: ${location.substring(0, 80)}...`);
      
      const redirectRes = await fetch(location, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cookie": cookiesToString(cookies),
          "Referer": "https://eu.login.vorwerk.com/",
        },
        redirect: "manual",
      });

      // Log cookies received from this redirect
      const newCookies = redirectRes.headers.getSetCookie?.() || [];
      if (newCookies.length > 0) {
        console.log(`[Cookidoo] Cookies from ${domain}:`, newCookies.map(c => c.split('=')[0]).join(', '));
      }

      extractCookies(redirectRes, cookies);
      location = redirectRes.headers.get("location");
      
      // Check if we've reached Cookidoo
      if (domain.includes("cookidoo.") && redirectRes.status === 200) {
        console.log("[Cookidoo] Reached Cookidoo successfully!");
        break;
      }
      
      // Also check if response URL is on Cookidoo (might differ from location)
      if (redirectRes.url.includes("cookidoo.") && redirectRes.status === 200) {
        console.log("[Cookidoo] Landed on Cookidoo!");
        break;
      }
    }

    // Check if we have auth cookies
    const hasAuthCookie = cookies.has("_oauth2_proxy") || 
                          cookies.has("v-authenticated") ||
                          cookies.has("v-is-authenticated");

    console.log("[Cookidoo] Final cookies:", Array.from(cookies.keys()).join(", "));

    if (hasAuthCookie) {
      console.log("[Cookidoo] Login successful!");
      return {
        success: true,
        token: cookiesToString(cookies),
      };
    }

    // Even without specific auth cookies, if we completed the flow, return what we have
    if (cookies.size > 0 && redirectCount > 0) {
      console.log("[Cookidoo] Completed redirect chain, returning cookies");
      return {
        success: true,
        token: cookiesToString(cookies),
      };
    }

    return { 
      success: false, 
      error: "Login completed but no authentication token received" 
    };

  } catch (error) {
    console.error("[Cookidoo] Login error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Test if a Cookidoo token is still valid
 */
export async function validateCookidooToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://cookidoo.co.uk/profile/en-GB", {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": token,
      },
      redirect: "manual",
    });
    
    // 200 = valid, 302 to login = invalid
    if (response.status === 200) {
      return true;
    }
    
    // Check if redirect is to login (invalid) or elsewhere
    const location = response.headers.get("location");
    if (location?.includes("login")) {
      return false;
    }
    
    // If it's another kind of redirect, the token might still be valid
    return response.status < 400;
  } catch {
    return false;
  }
}

// ============================================================================
// Recipe Sync Functions
// ============================================================================

interface CookidooSyncResult {
  success: boolean;
  recipeId?: string;
  recipeUrl?: string;
  error?: string;
}

/**
 * Sync a recipe to Cookidoo.
 * 
 * Flow:
 * 1. POST to create a new recipe (just the name) - returns recipe ID
 * 2. PATCH to update the recipe with full details
 */
export async function syncRecipeToCookidoo(
  token: string,
  recipeData: Record<string, unknown>,
  locale: string = "en-GB"
): Promise<CookidooSyncResult> {
  const baseUrl = `https://cookidoo.co.uk/created-recipes/${locale}`;
  const recipeName = (recipeData.name as string) || "Untitled Recipe";

  try {
    console.log(`[Cookidoo Sync] Creating recipe: "${recipeName}"...`);
    
    // Log token info for debugging (first 100 chars, hiding sensitive parts)
    console.log(`[Cookidoo Sync] Token length: ${token.length}`);
    console.log(`[Cookidoo Sync] Token cookies: ${token.split(';').map(c => c.split('=')[0].trim()).join(', ')}`);
    
    // Ensure we have the language cookie
    let cookieString = token;
    if (!token.includes('tmde-lang=')) {
      cookieString = `tmde-lang=${locale}; ${token}`;
    }

    // Step 1: Create the recipe
    const createRes = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Content-Type": "application/json",
        "Origin": "https://cookidoo.co.uk",
        "Referer": `https://cookidoo.co.uk/created-recipes/${locale}`,
        "User-Agent": USER_AGENT,
        "Cookie": cookieString,
        "X-Requested-With": "xmlhttprequest",
      },
      body: JSON.stringify({ recipeName }),
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error("[Cookidoo Sync] Create failed:", createRes.status, errorText);
      
      if (createRes.status === 401 || createRes.status === 403) {
        return { success: false, error: "Session expired - please reconnect your Cookidoo account" };
      }
      
      return { success: false, error: `Failed to create recipe: ${createRes.status}` };
    }

    const createData = await createRes.json();
    const recipeId = createData.recipeId || createData.id;

    if (!recipeId) {
      console.error("[Cookidoo Sync] No recipe ID in response:", createData);
      return { success: false, error: "No recipe ID returned from Cookidoo" };
    }

    console.log(`[Cookidoo Sync] Recipe created with ID: ${recipeId}`);

    // Step 2: PATCH with full recipe data
    console.log("[Cookidoo Sync] Updating recipe with full data...");

    const patchUrl = `${baseUrl}/${recipeId}`;
    
    // Prepare the recipe data for PATCH
    // Remove any fields that Cookidoo doesn't accept
    const patchData = { ...recipeData };
    delete patchData.id; // Don't send the ID in the body
    
    // Sanitize instructions - remove any invalid annotations that would cause API errors
    if (Array.isArray(patchData.instructions)) {
      const validAnnotationTypes = ["INGREDIENT", "TTS", "MODE"];
      // Valid MODE names that Cookidoo accepts (from official recipe examples)
      const validModeNames = ["dough", "turbo", "warm_up", "blend", "rice_cooker"];
      
      patchData.instructions = (patchData.instructions as Array<Record<string, unknown>>).map((instruction, idx) => {
        if (!instruction.annotations || !Array.isArray(instruction.annotations)) {
          return instruction;
        }
        
        const cleanedAnnotations = (instruction.annotations as Array<Record<string, unknown>>).filter((ann, annIdx) => {
          // Check if type is valid
          if (!validAnnotationTypes.includes(ann.type as string)) {
            console.log(`[Cookidoo Sync] Removing invalid annotation type "${ann.type}" from instruction ${idx}, annotation ${annIdx}`);
            return false;
          }
          
          // MODE must have a valid name from the allowed list
          if (ann.type === "MODE") {
            const data = ann.data as Record<string, unknown> | undefined;
            const modeName = (data?.name as string)?.toLowerCase();
            
            if (!modeName) {
              console.log(`[Cookidoo Sync] Removing MODE annotation without name from instruction ${idx}, annotation ${annIdx}`);
              return false;
            }
            
            if (!validModeNames.includes(modeName)) {
              console.log(`[Cookidoo Sync] Removing MODE annotation with invalid name "${modeName}" from instruction ${idx}, annotation ${annIdx}`);
              return false;
            }
          }
          
          // TTS must have at least time or speed
          if (ann.type === "TTS") {
            const data = ann.data as Record<string, unknown> | undefined;
            if (!data?.time && !data?.speed) {
              console.log(`[Cookidoo Sync] Removing TTS annotation without time/speed from instruction ${idx}, annotation ${annIdx}`);
              return false;
            }
          }
          
          return true;
        });
        
        return { ...instruction, annotations: cleanedAnnotations };
      });
    }
    
    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Content-Type": "application/json",
        "Origin": "https://cookidoo.co.uk",
        "Referer": `${patchUrl}/edit/ingredients-and-preparation-steps?active=steps`,
        "User-Agent": USER_AGENT,
        "Cookie": token,
        "X-Requested-With": "xmlhttprequest",
      },
      body: JSON.stringify(patchData),
    });

    if (!patchRes.ok) {
      const errorText = await patchRes.text();
      console.error("[Cookidoo Sync] Patch failed:", patchRes.status, errorText);
      
      // Try to parse error for more details
      try {
        const errorJson = JSON.parse(errorText);
        return { 
          success: false, 
          error: `Failed to update recipe: ${errorJson.message || errorJson.error || patchRes.status}`,
          recipeId, // Return ID so user can manually edit
        };
      } catch {
        return { 
          success: false, 
          error: `Failed to update recipe: ${patchRes.status}`,
          recipeId,
        };
      }
    }

    const recipeUrl = `https://cookidoo.co.uk/created-recipes/${locale}/${recipeId}`;
    console.log(`[Cookidoo Sync] Recipe synced successfully: ${recipeUrl}`);

    return {
      success: true,
      recipeId,
      recipeUrl,
    };

  } catch (error) {
    console.error("[Cookidoo Sync] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
