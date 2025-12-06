export interface RecipeData {
  source: string;
  title: string | null;
  description: string | null;
  author: string | null;
  prep_time: string | null;
  cook_time: string | null;
  total_time: string | null;
  servings: string | null;
  ingredients: string[];
  instructions: string[];
  cuisine: string | null;
  category: string | null;
  keywords: string | null;
  image: string | null;
  raw_content?: string | null;
  url: string;
}

