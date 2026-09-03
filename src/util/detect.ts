import type { PlatformId } from "../types";
import { existsSync } from "node:fs";
import path from "node:path";

export function detectPlatforms(cwd = process.cwd()): PlatformId[] {
  const detected: PlatformId[] = [];
  if (existsSync(path.join(cwd, ".claude")) || Bun.which("claude")) detected.push("claude-code");
  if (existsSync(path.join(cwd, ".codex")) || Bun.which("codex")) detected.push("codex");
  if (existsSync(path.join(cwd, ".cursor")) || Bun.which("cursor")) detected.push("cursor");
  if (existsSync(path.join(cwd, ".gemini")) || Bun.which("gemini")) detected.push("gemini-cli");
  return detected.length > 0 ? detected : ["claude-code"];
}
