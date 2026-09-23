import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — verification and mission drafting need it");
  }
  client ??= new Anthropic();
  return client;
}

/** claude-sonnet-5 per CLAUDE.md non-negotiable 6; overridable for the demo via env. */
export function verifyModel(): string {
  return process.env.VERIFY_MODEL || "claude-sonnet-5";
}
