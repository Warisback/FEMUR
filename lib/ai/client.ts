import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set — verification and mission drafting need it");
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/**
 * gemini-3.6-flash: the strongest model this key's free tier can run reliably
 * (Pro-class models have zero free-tier quota; 3.7/3.8-flash shed load under
 * demand). Overridable via env once billing exists.
 */
export function verifyModel(): string {
  return process.env.VERIFY_MODEL || "gemini-3.6-flash";
}
