import { z } from "zod";

export const RecipeUrlRequestSchema = z.object({
  url: z.string().url(),
  language: z.string().optional(),
});

export const SaveRecipeRequestSchema = z.object({
  title: z.string(),
  originalUrl: z.string().url(),
  cookidooJson: z.any(), // Validated earlier via CookidooRecipeSchema; accept as-is for persistence
  language: z.string().optional().default("en"),
});

// Minimal schema to validate OpenAI output shape
export const CookidooRecipeSchema = z
  .object({
    name: z.string(),
    image: z.string().optional().nullable(),
    ingredients: z
      .array(
        z.object({
          type: z.string(),
          text: z.string(),
        })
      )
      .nullish()
      .default([]),
    instructions: z
      .array(
        z.object({
          type: z.string(),
          text: z.string(),
          annotations: z.array(z.any()).optional().nullable(),
          missedUsages: z.array(z.any()).optional().nullable(),
        })
      )
      .nullish()
      .default([]),
    descriptiveAssets: z
      .array(
        z.object({
          square: z.string().optional().nullable(),
          portrait: z.string().optional().nullable(),
          landscape: z.string().optional().nullable(),
        })
      )
      .optional()
      .nullable(),
    isImageCopyrightOwned: z.boolean().optional().nullable(),
    isBasedOn: z.string().optional().nullable(),
    author: z
      .object({
        type: z.string().optional().nullable(),
        name: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),
    prepTime: z.number().optional().nullable(),
    totalTime: z.number().optional().nullable(),
    tools: z.array(z.string()).optional().nullable(),
    yield: z
      .object({
        value: z.number().optional().nullable(),
        unitText: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),
    hints: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    original_url: z.string().optional().nullable(),
  })
  .passthrough();

