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
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const cookie of setCookies) {
    const [nameValue] = cookie.split(";");
    const [name, ...valueParts] = nameValue.split("=");
    if (name) {
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
      console.log(`[Cookidoo] Redirect ${redirectCount}: ${location.substring(0, 60)}...`);
      
      const redirectRes = await fetch(location, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cookie": cookiesToString(cookies),
          "Referer": "https://eu.login.vorwerk.com/",
        },
        redirect: "manual",
      });

      extractCookies(redirectRes, cookies);
      location = redirectRes.headers.get("location");
      
      // Check if we've reached Cookidoo
      if (redirectRes.url.includes("cookidoo.") && redirectRes.status === 200) {
        console.log("[Cookidoo] Reached Cookidoo successfully!");
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
