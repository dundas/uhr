import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { geminiCliAdapter } from "./gemini-cli";
import type { Adapter } from "./types";

export function builtInAdapters(): Adapter[] {
  return [claudeCodeAdapter, codexAdapter, cursorAdapter, geminiCliAdapter];
}
