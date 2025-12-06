"use client";

import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface CookidooIngredient {
  type: string;
  text: string;
}

interface AnnotationPosition {
  offset: number;
  length: number;
}

interface VolumeAnnotation {
  type: "VOLUME";
  position: AnnotationPosition;
  data: {
    amount: number;
    unit: string;
    unitText: string;
  };
}

interface IngredientDescription {
  text: string;
  annotations?: VolumeAnnotation[];
}

interface CookidooAnnotation {
  type: "INGREDIENT" | "TTS" | "MODE";
  position: AnnotationPosition;
  data: {
    description?: string | IngredientDescription;
    time?: number;
    speed?: string;
    temperature?: { value: string; unit: string };
    direction?: string;
    name?: string;
  };
}

interface CookidooInstruction {
  type: string;
  text: string;
  annotations?: CookidooAnnotation[];
  missedUsages?: unknown[];
}

interface CookidooDescriptiveAsset {
  square?: string | null;
  portrait?: string | null;
  landscape?: string | null;
}

interface CookidooRecipe {
  name: string;
  image?: string | null;
  ingredients: CookidooIngredient[];
  instructions: CookidooInstruction[];
  descriptiveAssets?: CookidooDescriptiveAsset[] | null;
  isImageCopyrightOwned?: boolean | null;
  isBasedOn?: string | null;
  author?: { type?: string | null; name?: string | null } | null;
  prepTime?: number | null; // seconds
  totalTime?: number | null; // seconds
  tools?: string[] | null;
  yield?: { value?: number | null; unitText?: string | null } | null;
  hints?: string | null;
  notes?: string | null;
  original_url?: string | null;
}

type ViewState = "input" | "loading" | "result" | "error";
type NavTab = "import" | "list";
const LANG_OPTIONS = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

interface StoredRecipeSummary {
  id: string;
  title: string;
  originalUrl: string;
  createdAt: string;
  slug: string | null;
  language?: string;
}

// Get flag for a language code
function getLanguageFlag(code?: string): string {
  const lang = LANG_OPTIONS.find(l => l.code === code);
  return lang?.flag || "🌐";
}

interface StoredRecipeDetail {
  id: string;
  title: string;
  originalUrl: string;
  createdAt: string;
  share?: { slug: string };
  cookidooJson: CookidooRecipe;
}

// Helper to check if an INGREDIENT annotation has a VOLUME annotation
function hasVolumeAnnotation(annotation: CookidooAnnotation): boolean {
  if (annotation.type !== "INGREDIENT") return false;
  const desc = annotation.data.description;
  if (typeof desc === "object" && desc !== null && "annotations" in desc) {
    return Array.isArray(desc.annotations) && desc.annotations.some(a => a.type === "VOLUME");
  }
  return false;
}

// Renders step text with annotations highlighted
function renderAnnotatedText(text: string, annotations?: CookidooAnnotation[]) {
  if (!annotations || annotations.length === 0) {
    return <span>{text}</span>;
  }

  // Sort annotations by offset
  const sorted = [...annotations].sort((a, b) => a.position.offset - b.position.offset);
  
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  sorted.forEach((annotation, idx) => {
    const { offset, length } = annotation.position;
    
    // Validate offset and length
    if (offset < 0 || offset >= text.length || length <= 0) {
      return;
    }
    
    const end = Math.min(offset + length, text.length);
    
    // Add text before this annotation
    if (offset > lastIndex) {
      elements.push(<span key={`text-${idx}`}>{text.slice(lastIndex, offset)}</span>);
    }
    
    // Determine icon and class based on annotation type
    const isIngredient = annotation.type === "INGREDIENT";
    const isTTS = annotation.type === "TTS";
    const hasVolume = hasVolumeAnnotation(annotation);
    
    let icon = "";
    let className = "annotation";
    
    if (isIngredient) {
      icon = hasVolume ? "⚖️" : "🥄";
      className = "annotation annotation-ingredient";
    } else if (isTTS) {
      icon = "⏱️";
      className = "annotation annotation-tts";
    } else if (annotation.type === "MODE") {
      icon = "⚙️";
      className = "annotation annotation-mode";
    }
    
    // Add the annotated text
    elements.push(
      <span key={`ann-${idx}`} className={className} title={annotation.type}>
        {text.slice(offset, end)}
        {icon && <span className="annotation-icon">{icon}</span>}
      </span>
    );
    
    lastIndex = end;
  });
  
  // Add remaining text
  if (lastIndex < text.length) {
    elements.push(<span key="text-end">{text.slice(lastIndex)}</span>);
  }
  
  return <>{elements}</>;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [url, setUrl] = useState("");
  const [viewState, setViewState] = useState<ViewState>("input");
  const [navTab, setNavTab] = useState<NavTab | null>(null); // null = landing page
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recipes, setRecipes] = useState<StoredRecipeSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState("Fetching recipe from URL");
  const [recipe, setRecipe] = useState<CookidooRecipe | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [lastOriginalUrl, setLastOriginalUrl] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  const [viewingSavedId, setViewingSavedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  
  const isAuthenticated = status === "authenticated";
  const isLoading = status === "loading";

const SAMPLE_URL = "https://www.seriouseats.com/mushroom-risotto-recipe-5279129";

const handleNewImport = () => {
  setNavTab("import");
  setUrl("");
  setRecipe(null);
  setError("");
  setViewState("input");
  setSaveMessage("");
  setSavedRecipeId(null);
  setShareSlug(null);
};

const handleConvert = async () => {
    if (!url.trim()) {
      setError("Please enter a valid URL");
      setViewState("error");
      return;
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      setError("Please enter a valid URL");
      setViewState("error");
      return;
    }

    setViewState("loading");
    setLoadingStatus("Fetching recipe from URL");

    // Progress messages
    const statusMessages = [
      "Fetching recipe from URL",
      "Extracting ingredients and instructions",
      "Converting to Thermomix format",
      "Optimizing cooking parameters",
      "Almost done...",
    ];

    let statusIndex = 0;
    const statusInterval = setInterval(() => {
      statusIndex = Math.min(statusIndex + 1, statusMessages.length - 1);
      setLoadingStatus(statusMessages[statusIndex]);
    }, 2000);

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, language }),
      });

      clearInterval(statusInterval);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const detail = data?.error || `Failed to convert recipe (status ${response.status})`;
        throw new Error(detail);
      }

      const data = await response.json();
      setRecipe(data.recipe);
      setLastOriginalUrl(data.originalUrl);
      setViewState("result");
      
      // Auto-save the recipe
      try {
        const saveResponse = await fetch("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.recipe.name,
            originalUrl: data.originalUrl || url,
            cookidooJson: data.recipe,
            language: language,
          }),
        });
        if (saveResponse.ok) {
          const saveData = await saveResponse.json();
          setSavedRecipeId(saveData?.recipe?.id ?? null);
          setShareSlug(saveData?.recipe?.share?.slug ?? null);
          setSaveMessage("Auto-saved to library");
          fetchRecipes(); // refresh the list in background
        }
      } catch {
        // Silent fail for auto-save - user can still copy JSON
        setSavedRecipeId(null);
        setShareSlug(null);
        setSaveMessage("");
      }
    } catch (err) {
      clearInterval(statusInterval);
      setError(err instanceof Error ? err.message : "An error occurred");
      setViewState("error");
    }
  };

  const fetchRecipes = async () => {
    setListLoading(true);
    setListError("");
    try {
      const response = await fetch("/api/recipes?limit=50");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to load recipes");
      }
      const data = await response.json();
      setRecipes(data.recipes || []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load recipes");
    } finally {
      setListLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/recipes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to delete recipe");
      }
      setRecipes((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete recipe");
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewSaved = async (id: string) => {
    setViewingSavedId(id);
    setViewState("loading");
    setLoadingStatus("Loading saved recipe...");
    try {
      const response = await fetch(`/api/recipes/${id}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to load recipe");
      }
      const data = (await response.json()) as { recipe: StoredRecipeDetail };
      const saved = data.recipe;
      setRecipe(saved.cookidooJson);
      setLastOriginalUrl(saved.originalUrl);
      setSavedRecipeId(saved.id);
      setShareSlug(saved.share?.slug ?? null);
      setViewState("result");
      setNavTab("import");
      setSaveMessage("Loaded from saved recipe");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recipe");
      setViewState("error");
    } finally {
      setViewingSavedId(null);
    }
  };

  useEffect(() => {
    if (navTab === "list") {
      fetchRecipes();
    }
  }, [navTab]);

  const handleCopy = async () => {
    if (!recipe) return;
    await navigator.clipboard.writeText(JSON.stringify(recipe, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetToInput = () => {
    setRecipe(null);
    setError("");
    setViewState("input");
  };

  const shareUrl =
    shareSlug && typeof window !== "undefined"
      ? `${window.location.origin}/api/share/${shareSlug}`
      : shareSlug
      ? `/api/share/${shareSlug}`
      : "";

  const handleShareCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setSaveMessage("Share link copied");
    setTimeout(() => setSaveMessage(""), 2000);
  };

  const handleSendToCookidoo = async () => {
    if (!recipe) {
      setSaveMessage("Convert a recipe first");
      return;
    }

    setSaveMessage("Generating link...");
    try {
      let currentSlug = shareSlug;
      let currentId = savedRecipeId;

      // Create record if none exists
      if (!currentId) {
        const response = await fetch("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: recipe.name,
            originalUrl: lastOriginalUrl || url,
            cookidooJson: recipe,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Failed to save recipe");
        }
        currentId = data?.recipe?.id ?? null;
        currentSlug = data?.recipe?.share?.slug ?? null;
        setSavedRecipeId(currentId);
        setShareSlug(currentSlug);
        await fetchRecipes();
      }

      // If saved but missing slug (older records), fetch to auto-create
      if (!currentSlug && currentId) {
        const response = await fetch(`/api/recipes/${currentId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Failed to generate share link");
        }
        currentSlug = data?.recipe?.share?.slug ?? null;
        setShareSlug(currentSlug);
      }

      if (!currentSlug) {
        throw new Error("Unable to generate share link");
      }

      setShowShareModal(true);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Failed to generate Cookidoo link");
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  };

  return (
    <>
      <div className="background-pattern" />

      <div className={`layout ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        {/* Mobile menu button */}
        <button 
          className={`mobile-menu-btn ${mobileMenuOpen ? "hidden" : ""}`}
          onClick={() => setMobileMenuOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>

        {/* Mobile overlay */}
        <div 
          className={`mobile-overlay ${mobileMenuOpen ? "visible" : ""}`}
          onClick={() => setMobileMenuOpen(false)}
        />

        <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"} ${mobileMenuOpen ? "mobile-open" : ""}`}>
          <button 
            className="sidebar-toggle"
            onClick={() => {
              setSidebarOpen(!sidebarOpen);
              setMobileMenuOpen(false);
            }}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen ? (
                <polyline points="15 18 9 12 15 6" />
              ) : (
                <polyline points="9 18 15 12 9 6" />
              )}
            </svg>
          </button>
          {sidebarOpen && (
            <>
              <div className="logo" onClick={() => { setNavTab(null); setMobileMenuOpen(false); }} style={{ cursor: "pointer" }}>
                <img 
                  src="/viking.png" 
                  alt="Andhrimnir Viking Logo" 
                  className="logo-icon"
                />
                <div>
                  <h1>Andhrimnir</h1>
                  <p className="nav-subtitle">THERMOMIX COMPANION</p>
                </div>
              </div>
              <nav className="nav">
                <button
                  className={`nav-item ${navTab === "import" ? "active" : ""} ${!isAuthenticated ? "nav-item-disabled" : ""}`}
                  onClick={() => {
                    if (isAuthenticated) {
                      handleNewImport();
                    } else {
                      signIn("google");
                    }
                    setMobileMenuOpen(false);
                  }}
                  title={!isAuthenticated ? "Sign in to import recipes" : undefined}
                >
                  {isAuthenticated ? "Import recipe" : "Sign in to import"}
                </button>
                <button
                  className={`nav-item ${navTab === "list" ? "active" : ""}`}
                  onClick={() => {
                    setNavTab("list");
                    setMobileMenuOpen(false);
                  }}
                >
                  Saved recipes
                </button>
              </nav>
              
              {/* Auth Section */}
              <div className="auth-section">
                {isLoading ? (
                  <div className="auth-loading">Loading...</div>
                ) : isAuthenticated ? (
                  <div className="auth-user">
                    {session?.user?.image && (
                      <img 
                        src={session.user.image} 
                        alt={session.user.name || "User"} 
                        className="auth-avatar"
                      />
                    )}
                    <div className="auth-info">
                      <span className="auth-name">{session?.user?.name || "User"}</span>
                      <button 
                        className="auth-btn auth-btn-logout"
                        onClick={() => signOut()}
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                ) : (
                  <button 
                    className="auth-btn auth-btn-login"
                    onClick={() => signIn("google")}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in with Google
                  </button>
                )}
              </div>
            </>
          )}
        </aside>

        <main className="container">
          {/* Landing Page */}
          {navTab === null && (
            <section className="landing">
              <div className="landing-logo">
                <img 
                  src="/viking.png" 
                  alt="Andhrimnir Viking Logo" 
                  className="landing-logo-img"
                />
                <h1 className="landing-title">Andhrimnir</h1>
                <p className="landing-subtitle">Your Thermomix Recipe Companion</p>
              </div>
              <p className="landing-description">
                Transform any recipe from the web into Cookidoo-ready format with precise times, temperatures, and speeds.
              </p>
              <div className="landing-actions">
                {isAuthenticated ? (
                  <button 
                    className="landing-btn landing-btn-primary"
                    onClick={handleNewImport}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Import a Recipe
                  </button>
                ) : (
                  <button 
                    className="landing-btn landing-btn-primary"
                    onClick={() => signIn("google")}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in to Import
                  </button>
                )}
                <button 
                  className="landing-btn landing-btn-secondary"
                  onClick={() => setNavTab("list")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                  View Saved Recipes
                </button>
              </div>
            </section>
          )}

          {/* Hero Section - only show when not on landing */}
          {navTab !== null && (
            <header className="hero">
              <p className="tagline">
                Transform any recipe into <span className="highlight">Thermomix magic</span>
              </p>
              <p className="subtitle">
                Paste a recipe URL from your favorite food blog. We&apos;ll convert it to Cookidoo format with precise times,
                temperatures, and speeds.
              </p>
            </header>
          )}

          {navTab === "import" && (
            <>
              {/* Auth Gate for Import - but allow viewing saved recipes without auth */}
              {!isAuthenticated && !savedRecipeId && viewState === "input" ? (
                <section className="auth-gate">
                  <div className="auth-gate-content">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <h2>Sign in to Import Recipes</h2>
                    <p>Create an account to convert and save your favorite recipes to Thermomix format.</p>
                    <button 
                      className="btn-primary auth-gate-btn"
                      onClick={() => signIn("google")}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Sign in with Google
                    </button>
                  </div>
                </section>
              ) : (
              <>
              {/* Input Section */}
              {viewState === "input" && (
                <section className="input-section">
                  <div className="input-card">
                    <div className="input-wrapper">
                      <label htmlFor="recipe-url">Recipe URL</label>
                      <div className="input-group">
                        <input
                          type="url"
                          id="recipe-url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleConvert()}
                          placeholder="https://www.seriouseats.com/perfect-risotto-recipe..."
                          autoComplete="off"
                          spellCheck="false"
                        />
                        <select
                          id="language"
                          value={language}
                          onChange={(e) => setLanguage(e.target.value)}
                          className="lang-select"
                          title={LANG_OPTIONS.find(o => o.code === language)?.label}
                        >
                          {LANG_OPTIONS.map((opt) => (
                            <option key={opt.code} value={opt.code}>
                              {opt.flag}
                            </option>
                          ))}
                        </select>
                        <button onClick={handleConvert} className="btn-primary">
                          <span className="btn-text">Convert Recipe</span>
                        </button>
                      </div>
                    </div>
                    <p className="helper-text">
                      Works with most food blogs: Serious Eats, BBC Good Food, Bon Appétit, AllRecipes, and more
                    </p>
                    <div className="helper-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setUrl(SAMPLE_URL)}
                        aria-label="Use a sample recipe URL"
                      >
                        Use sample URL
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Loading Section */}
              {viewState === "loading" && (
                <section className="loading-section">
                  <div className="loading-card">
                    <div className="cooking-animation">
                      <svg viewBox="0 0 100 100" className="thermomix-icon">
                        <ellipse cx="50" cy="90" rx="35" ry="6" fill="#E5E7EB" />
                        <rect x="20" y="25" width="60" height="55" rx="10" className="bowl" strokeWidth="2" />
                        <rect x="28" y="32" width="44" height="38" rx="6" fill="#F9FAFB" />
                        <circle cx="50" cy="51" r="14" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1" />
                        <path className="blade" d="M50 42 L60 51 L50 60 L40 51 Z" />
                        <circle cx="50" cy="51" r="4" fill="#9CA3AF" />
                        <rect x="30" y="72" width="40" height="8" rx="3" className="base" />
                        <rect x="38" y="82" width="24" height="4" rx="1" className="display" />
                      </svg>
                    </div>
                    <h3>Converting your recipe...</h3>
                    <p className="loading-status">{loadingStatus}</p>
                  </div>
                </section>
              )}

              {/* Result Section */}
              {viewState === "result" && recipe && (
                <section className="result-section">
                  <div className="result-header">
                    <h2>{recipe.name}</h2>
                    <div className="result-actions">
                      <button onClick={handleCopy} className={`btn-secondary ${copied ? "copied" : ""}`}>
                        {copied ? (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20,6 9,17 4,12" />
                            </svg>
                            Copied!
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                            Copy JSON
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleSendToCookidoo}
                        className="btn-secondary"
                        title={shareUrl ? `Show Cookidoo link` : "Save first to generate a Cookidoo link"}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                          <path d="M16 6l-4-4-4 4" />
                          <path d="M12 2v14" />
                        </svg>
                        {"Send to Cookidoo"}
                      </button>
                      <button onClick={resetToInput} className="btn-ghost">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        New Recipe
                      </button>
                    </div>
                  </div>

                  <div className="recipe-preview">
                    <div className="preview-grid">
                      <div className="meta-card">
                        <h4>Overview</h4>
                        <div className="meta-items">
                          {lastOriginalUrl && (
                            <div className="meta-item">
                              <span className="label">Source</span>
                              <span className="value">
                                <a className="link-muted" href={lastOriginalUrl} target="_blank" rel="noreferrer">
                                  View source
                                </a>
                              </span>
                            </div>
                          )}
                          {recipe.yield?.value && (
                            <div className="meta-item">
                              <span className="label">Servings</span>
                              <span className="value">
                                {recipe.yield.value}
                                {recipe.yield.unitText ? ` ${recipe.yield.unitText}` : ""}
                              </span>
                            </div>
                          )}
                          {typeof recipe.prepTime === "number" && (
                            <div className="meta-item">
                              <span className="label">Prep Time</span>
                              <span className="value">{formatTime(recipe.prepTime)}</span>
                            </div>
                          )}
                          {typeof recipe.totalTime === "number" && (
                            <div className="meta-item">
                              <span className="label">Total Time</span>
                              <span className="value">{formatTime(recipe.totalTime)}</span>
                            </div>
                          )}
                        </div>
                        {shareUrl && (
                          <div className="share-hint">
                            <span className="label">Cookidoo link</span>
                            <a className="link-muted" href={shareUrl} target="_blank" rel="noreferrer">
                              {shareUrl}
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="ingredients-card">
                        <h4>Ingredients</h4>
                        <div className="ingredients-list">
                          {recipe.ingredients.length === 0 && (
                            <div className="ingredient-item">No ingredients provided.</div>
                          )}
                          {recipe.ingredients.map((ingredient, idx) => (
                            <div key={idx} className="ingredient-item">
                              {ingredient.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="steps-card">
                      <h4>Thermomix Steps</h4>
                      <div className="steps-list">
                        {recipe.instructions.map((step, idx) => (
                          <div key={idx} className="step-item">
                            <div className="step-number">{idx + 1}</div>
                            <div className="step-content">
                              <div className="step-instruction">
                                {renderAnnotatedText(step.text, step.annotations)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {saveMessage && (
                    <div className="save-bar">
                      <span className="save-message">{saveMessage}</span>
                    </div>
                  )}

                  <details className="json-output">
                    <summary>View Raw JSON (for Cookidoo import)</summary>
                    <pre>{JSON.stringify(recipe, null, 2)}</pre>
                  </details>
                </section>
              )}
            </>
              )}
            </>
          )}

          {navTab === "list" && (
            <section className="list-section">
              {!isAuthenticated ? (
                <section className="auth-gate">
                  <div className="auth-gate-content">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    <h2>Sign in to View Your Recipes</h2>
                    <p>Your saved recipes are linked to your account. Sign in to access them.</p>
                    <button 
                      className="btn-primary auth-gate-btn"
                      onClick={() => signIn("google")}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Sign in with Google
                    </button>
                  </div>
                </section>
              ) : (
              <>
              <div className="list-header">
                <div>
                  <h2>Your recipes</h2>
                  <p className="helper-text">Saved conversions ready to copy or reuse.</p>
                </div>
                <div className="list-actions">
                  <button
                    className="icon-button"
                    onClick={fetchRecipes}
                    disabled={listLoading}
                    aria-label="Refresh recipes"
                    title="Refresh"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-3-6.708" />
                      <polyline points="21 3 21 9 15 9" />
                    </svg>
                  </button>
                </div>
              </div>
              {listError && <p className="error-text">{listError}</p>}
              {!listError && (
                <div className="recipes-table">
                  {recipes.length === 0 ? (
                    <div className="empty-state">
                      <p className="helper-text">No recipes saved yet.</p>
                      <button className="btn-primary" onClick={handleNewImport}>
                        Import your first recipe
                      </button>
                    </div>
                  ) : (
                    <div className="list-cards">
                      {recipes.map((r) => (
                        <div
                          key={r.id}
                          className="list-card"
                          role="button"
                          tabIndex={0}
                          onClick={() => handleViewSaved(r.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleViewSaved(r.id)}
                          aria-label={`View saved recipe ${r.title}`}
                        >
                          <div className="list-card-header">
                            <div>
                              <div className="list-card-meta">
                                <span className="lang-flag" title={LANG_OPTIONS.find(l => l.code === r.language)?.label || "Unknown"}>
                                  {getLanguageFlag(r.language)}
                                </span>
                                <div className="pill">{r.slug ? "Shared" : "Saved"}</div>
                              </div>
                              <h3 className="list-card-title">{r.title}</h3>
                              <p className="small-text">{new Date(r.createdAt).toLocaleString()}</p>
                            </div>
                            <button
                              className="icon-button danger"
                              aria-label="Delete recipe"
                              title="Delete recipe"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(r.id);
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                              disabled={deletingId === r.id}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          </div>
                          <div className="list-card-footer">
                            <code className="small-text">{r.originalUrl}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </>
              )}
            </section>
          )}

          {/* Error Section */}
          {viewState === "error" && navTab === "import" && (
            <section className="error-section">
              <div className="error-card">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="error-icon">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <h3>Oops! Something went wrong</h3>
                <p>{error || "Unable to convert recipe. Please try again."}</p>
                <button onClick={resetToInput} className="btn-primary">
                  Try Again
                </button>
              </div>
            </section>
          )}
        </main>
      </div>

      <footer>
        <p>Named after the Norse cook who feeds the gods in Valhalla</p>
      </footer>

      {showShareModal && (
        <div className="modal-backdrop" onClick={() => setShowShareModal(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Cookidoo import URL</h3>
              <button className="icon-button" onClick={() => setShowShareModal(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {shareUrl ? (
              <>
                <code className="share-popup-link">{shareUrl}</code>
                <p className="small-text">Copy and paste this URL into Cookidoo to import the recipe JSON.</p>
                <div className="modal-actions">
                  <button className="btn-secondary" onClick={handleShareCopy}>
                    Copy link
                  </button>
                  <button className="btn-primary" onClick={() => setShowShareModal(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="small-text">
                  Recipe is being saved... Please wait a moment for the Cookidoo link to appear.
                </p>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={() => setShowShareModal(false)}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

