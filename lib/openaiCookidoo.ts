import OpenAI from "openai";
import { SYSTEM_PROMPT, REVIEW_PROMPT } from "@/lib/prompts";
import { RecipeData } from "@/lib/types";
import { CookidooRecipeSchema } from "@/lib/validation";

const OPENAI_TIMEOUT_MS = 60000; // 60 seconds for generation
const REVIEW_TIMEOUT_MS = 90000; // 90 seconds for review (larger input)

interface Annotation {
  type: string;
  data: {
    description?: string | { text: string; annotations?: unknown[] };
    time?: number;
    speed?: string;
    temperature?: { value: string; unit: string };
    direction?: string;
    name?: string; // For MODE annotations
  };
  position: {
    offset: number;
    length: number;
  };
}

interface Instruction {
  type: string;
  text: string;
  annotations?: Annotation[];
}

/**
 * Post-process annotations to fix incorrect offsets.
 * ChatGPT often miscalculates character positions, so we search for the
 * annotated text in the step and correct the offset/length.
 */
function fixAnnotationOffsets(instructions: Instruction[]): Instruction[] {
  return instructions.map((instruction) => {
    if (!instruction.annotations || instruction.annotations.length === 0) {
      return instruction;
    }

    const text = instruction.text;
    const fixedAnnotations = instruction.annotations.map((annotation) => {
      // Convert TTS with "Varoma" temperature to MODE annotation
      // Cookidoo API rejects "Varoma" as a temperature value - it needs a MODE annotation instead
      if (annotation.type === "TTS" && annotation.data.temperature?.value?.toString().toLowerCase() === "varoma") {
        console.log(`[Varoma Fix] Converting TTS with Varoma to MODE annotation`);
        return {
          type: "MODE",
          position: annotation.position,
          data: {
            name: "varoma",
            ...(annotation.data.time ? { time: annotation.data.time } : {}),
          }
        } as Annotation;
      }

      // Fix TTS annotations - find the actual time/temp/speed pattern in the text
      if (annotation.type === "TTS") {
        const currentOffset = annotation.position.offset;
        const currentLength = annotation.position.length;
        const currentCapture = text.substring(currentOffset, currentOffset + currentLength);
        
        // Look for Thermomix instruction patterns in the text
        // Patterns: "X min./Y°C/vel. Z", "X sec./vel. Z", "X min./Y°C//vel. Z"
        const ttsPatterns = [
          /\d+\s*min\.\/\d+°C\/\/vel\.\s*(?:soft|\d+)/gi,  // with reverse (double slash)
          /\d+\s*min\.\/\d+°C\/vel\.\s*(?:soft|\d+)/gi,    // standard with temp
          /\d+\s*min\.\/vel\.\s*(?:soft|\d+)/gi,           // without temp
          /\d+\s*sec\.\/vel\.\s*(?:soft|\d+)/gi,           // seconds
          /\d+\s*min\.\/\d+°C/gi,                          // just time and temp
        ];
        
        for (const pattern of ttsPatterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            if (match.index !== undefined) {
              const matchText = match[0];
              const matchOffset = match.index;
              const matchLength = matchText.length;
              
              // Check if this match overlaps with the current annotation
              const currentEnd = currentOffset + currentLength;
              const matchEnd = matchOffset + matchLength;
              
              // If they overlap, use the cleaner match
              if (currentOffset <= matchEnd && matchOffset <= currentEnd) {
                if (matchOffset !== currentOffset || matchLength !== currentLength) {
                  console.log(`[TTS Fix] "${currentCapture}" -> "${matchText}" (offset ${currentOffset}->${matchOffset}, length ${currentLength}->${matchLength})`);
                  return {
                    ...annotation,
                    position: {
                      offset: matchOffset,
                      length: matchLength
                    }
                  };
                }
              }
            }
          }
        }
        
        return annotation;
      }
      
      // Clean MODE annotations - remove invalid fields like 'speed'
      // MODE annotations should only have: name (required), time (optional)
      if (annotation.type === "MODE") {
        const modeData = annotation.data as { name?: string; time?: number; speed?: string };
        if (modeData.speed) {
          console.log(`[MODE Fix] Removing invalid 'speed' field from MODE annotation`);
        }
        return {
          type: "MODE",
          position: annotation.position,
          data: {
            name: modeData.name || "dough",
            ...(modeData.time ? { time: modeData.time } : {}),
          }
        } as Annotation;
      }

      // For INGREDIENT annotations, try to find the correct position
      if (annotation.type === "INGREDIENT" && annotation.data.description) {
        const currentOffset = annotation.position.offset;
        const currentLength = annotation.position.length;
        
        // What ChatGPT thinks it's annotating
        const currentCapture = text.substring(currentOffset, currentOffset + currentLength);
        
        // Extract the key word from the ingredient description
        // e.g., "200 g dried borlotti beans" -> try to find "borlotti beans" or "beans"
        // Handle both string format and object format (with VOLUME annotation)
        const rawDescription = annotation.data.description;
        const description: string = typeof rawDescription === 'string' 
          ? rawDescription 
          : (rawDescription as { text?: string }).text || '';
        
        if (!description) {
          return annotation;
        }
        
        // Try to find what the annotation SHOULD be pointing to
        // Strategy: Look for words from the description in the step text
        const descWords = description.toLowerCase().split(/\s+/);
        
        // Try finding progressively shorter phrases from the description
        let bestMatch: { offset: number; length: number; text: string } | null = null;
        
        // First, try to find multi-word matches (more specific)
        for (let wordCount = Math.min(4, descWords.length); wordCount >= 1; wordCount--) {
          for (let startIdx = 0; startIdx <= descWords.length - wordCount; startIdx++) {
            const phrase = descWords.slice(startIdx, startIdx + wordCount).join(" ");
            
            // Skip very short words and common words
            if (phrase.length < 3 || ["to", "of", "g", "ml", "a", "an", "the"].includes(phrase)) {
              continue;
            }
            
            // Search for this phrase in the step text (case-insensitive)
            const textLower = text.toLowerCase();
            const phraseIndex = textLower.indexOf(phrase);
            
            if (phraseIndex !== -1) {
              // Found a match - get the actual text (preserving case)
              const actualText = text.substring(phraseIndex, phraseIndex + phrase.length);
              
              // Prefer longer matches
              if (!bestMatch || phrase.length > bestMatch.length) {
                bestMatch = {
                  offset: phraseIndex,
                  length: phrase.length,
                  text: actualText
                };
              }
            }
          }
          
          // If we found a good match with this word count, use it
          if (bestMatch && bestMatch.length >= 4) {
            break;
          }
        }
        
        // If we found a match and it's different from what ChatGPT calculated, fix it
        if (bestMatch) {
          const isCorrect = currentOffset === bestMatch.offset && currentLength === bestMatch.length;
          
          if (!isCorrect) {
            console.log(`[Annotation Fix] "${currentCapture}" -> "${bestMatch.text}" (offset ${currentOffset}->${bestMatch.offset}, length ${currentLength}->${bestMatch.length})`);
            return {
              ...annotation,
              position: {
                offset: bestMatch.offset,
                length: bestMatch.length
              }
            };
          }
        }
      }
      
      return annotation;
    });

    return {
      ...instruction,
      annotations: fixedAnnotations
    };
  });
}

/**
 * Sanitize special characters in all text fields of the recipe.
 * Cookidoo API doesn't handle certain special characters well.
 * Replace problematic characters with safe alternatives.
 */
function escapeSpecialCharacters(recipe: Record<string, unknown>): Record<string, unknown> {
  const sanitizeText = (text: string): string => {
    return text
      .replace(/'/g, "'")      // Replace straight single quote with Unicode right single quote
      .replace(/`/g, "'")      // Replace backtick with Unicode right single quote
      .replace(/"/g, '"')      // Replace straight double quote with Unicode right double quote
      .replace(/"/g, '"');     // Normalize curly double quotes
  };

  // Clone the recipe to avoid mutating the original
  const escaped = JSON.parse(JSON.stringify(recipe));

  // Sanitize name
  if (typeof escaped.name === "string") {
    escaped.name = sanitizeText(escaped.name);
  }

  // Sanitize hints
  if (typeof escaped.hints === "string") {
    escaped.hints = sanitizeText(escaped.hints);
  }

  // Sanitize ingredients
  if (Array.isArray(escaped.ingredients)) {
    escaped.ingredients = escaped.ingredients.map((ing: { text?: string; type?: string }) => {
      if (ing.text && typeof ing.text === "string") {
        return { ...ing, text: sanitizeText(ing.text) };
      }
      return ing;
    });
  }

  // Sanitize instructions
  if (Array.isArray(escaped.instructions)) {
    escaped.instructions = escaped.instructions.map((inst: Instruction) => {
      const sanitizedInst = { ...inst };
      if (typeof inst.text === "string") {
        sanitizedInst.text = sanitizeText(inst.text);
      }
      // Sanitize annotation descriptions
      if (Array.isArray(inst.annotations)) {
        sanitizedInst.annotations = inst.annotations.map((ann: Annotation) => {
          if (ann.data?.description) {
            const desc = ann.data.description;
            if (typeof desc === "string") {
              return {
                ...ann,
                data: { ...ann.data, description: sanitizeText(desc) }
              };
            } else if (typeof desc === "object" && desc.text) {
              return {
                ...ann,
                data: {
                  ...ann.data,
                  description: { ...desc, text: sanitizeText(desc.text) }
                }
              };
            }
          }
          return ann;
        });
      }
      return sanitizedInst;
    });
  }

  return escaped;
}

export async function convertToCookidoo(recipeData: RecipeData, language: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable not set");
  }

  const openai = new OpenAI({ apiKey });

  const ingredientsText =
    recipeData.ingredients.length > 0 ? recipeData.ingredients.map((ing) => `- ${ing}`).join("\n") : "Not extracted";

  const instructionsText =
    recipeData.instructions.length > 0
      ? recipeData.instructions.map((inst, i) => `${i + 1}. ${inst}`).join("\n")
      : "Not extracted";

  const userPrompt = `Convert this recipe to Cookidoo/Thermomix format.

🚨 TARGET LANGUAGE: ${language.toUpperCase()}
ALL text fields must be in ${language}: name, ingredients, step text, hints.
Only keep Thermomix notation in standard format (min., sec., vel., °C).

Title: ${recipeData.title || "Unknown Recipe"}
Description: ${recipeData.description || "No description"}
Servings: ${recipeData.servings || "Not specified"}
Prep Time: ${recipeData.prep_time || "Not specified"}
Cook Time: ${recipeData.cook_time || "Not specified"}

INGREDIENTS:
${ingredientsText}

INSTRUCTIONS:
${instructionsText}

${recipeData.raw_content ? `\nRAW CONTENT (if structured data missing):\n${recipeData.raw_content}` : ""}

Original URL: ${recipeData.url}

Convert this to a complete Cookidoo recipe with proper Thermomix settings for each step.`;

  try {
    // === PASS 1: GENERATE ===
    // Using gpt-4o for generation - this is the complex, creative task
    console.log("[OpenAI] Starting Pass 1: Generate (gpt-4o)...");
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), OPENAI_TIMEOUT_MS);
    
    let response;
    try {
      response = await openai.chat.completions.create(
        {
          model: "gpt-4o",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
          response_format: { type: "json_object" },
        },
        { signal: controller1.signal }
      );
    } finally {
      clearTimeout(timeout1);
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    let parsed = JSON.parse(content);
    console.log("[OpenAI] Pass 1 complete");

    // === PASS 2: REVIEW AND FIX ===
    // Using gpt-4o-mini for review - it's a more mechanical task (check rules, fix issues)
    // This is ~17x cheaper and faster than gpt-4o
    console.log("[OpenAI] Starting Pass 2: Review (gpt-4o-mini)...");
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), REVIEW_TIMEOUT_MS);
    
    // Send minified JSON to reduce input size and speed up processing
    const minifiedJson = JSON.stringify(parsed);
    
    try {
      const reviewResponse = await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: REVIEW_PROMPT },
            { role: "user", content: `Review and fix this Cookidoo recipe JSON:\n\n${minifiedJson}` },
          ],
          temperature: 0.2,
          max_tokens: 12000, // Increased to handle full recipe output
          response_format: { type: "json_object" },
        },
        { signal: controller2.signal }
      );

      const reviewContent = reviewResponse.choices[0]?.message?.content;
      if (reviewContent) {
        try {
          const reviewed = JSON.parse(reviewContent);
          parsed = reviewed;
          console.log("[OpenAI] Pass 2 complete");
        } catch (e) {
          console.log("[OpenAI] Pass 2 failed to parse, using Pass 1 output");
        }
      }
    } catch (reviewError) {
      console.log("[OpenAI] Pass 2 failed, using Pass 1 output:", reviewError);
    } finally {
      clearTimeout(timeout2);
    }

    // Defensive fallbacks to reduce schema failures
    if (!parsed.name || typeof parsed.name !== "string") {
      parsed.name = recipeData.title || "Unknown recipe";
    }
    if (!parsed.original_url && recipeData.url) {
      parsed.original_url = recipeData.url;
    }
    if (!parsed.ingredients) {
      parsed.ingredients = [];
    }
    if (!parsed.instructions) {
      parsed.instructions = [];
    }
    
    // Normalize ingredients array - model sometimes outputs wrong format
    if (Array.isArray(parsed.ingredients)) {
      parsed.ingredients = parsed.ingredients.map((ing: unknown) => {
        // If it's a string, convert to object format
        if (typeof ing === "string") {
          return { type: "INGREDIENT", text: ing };
        }
        // If it's an object but missing text field
        if (typeof ing === "object" && ing !== null) {
          const ingObj = ing as Record<string, unknown>;
          // Try to find the text from various possible fields
          const text = ingObj.text || ingObj.name || ingObj.ingredient || ingObj.description || "";
          return {
            type: "INGREDIENT",
            text: String(text)
          };
        }
        return { type: "INGREDIENT", text: "" };
      });
    }

    // Fix annotation offsets - ChatGPT often miscalculates character positions
    if (parsed.instructions && Array.isArray(parsed.instructions)) {
      parsed.instructions = fixAnnotationOffsets(parsed.instructions as Instruction[]);
    }

    // Escape single quotes in all text fields - Cookidoo API doesn't handle them well
    parsed = escapeSpecialCharacters(parsed);

    return CookidooRecipeSchema.parse(parsed);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("OpenAI request timed out");
    }
    throw error;
  }
}

