import { prisma } from "@/lib/prisma";

const WORDS_A = [
  "green",
  "fresh",
  "quick",
  "smart",
  "smooth",
  "mint",
  "velvet",
  "zesty",
  "bright",
  "crisp",
  "light",
  "pure",
  "bold",
  "vivid",
  "glow",
];

const WORDS_B = [
  "mix",
  "blend",
  "stir",
  "chop",
  "steam",
  "serve",
  "taste",
  "dash",
  "simmer",
  "whisk",
  "knead",
  "pulse",
  "zest",
  "carve",
  "dice",
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function generateUniqueSlug(attempts = 10): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const slug = `${randomChoice(WORDS_A)}-${randomChoice(WORDS_B)}`;
    const exists = await prisma.share.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  // Fallback with a suffix to avoid collisions
  const slug = `${randomChoice(WORDS_A)}-${randomChoice(WORDS_B)}-${Math.floor(Math.random() * 1000)}`;
  return slug;
}

