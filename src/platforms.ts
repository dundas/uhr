import path from "node:path";
import type { PlatformId } from "./types";

export const SUPPORTED_PLATFORMS: PlatformId[] = ["claude-code", "codex", "cursor", "gemini-cli"];

export function configPathForPlatform(cwd: string, platform: PlatformId): string {
  if (platform === "claude-code") return path.join(cwd, ".claude", "settings.json");
  if (platform === "codex") return path.join(cwd, ".codex", "hooks.json");
  if (platform === "cursor") return path.join(cwd, ".cursor", "hooks.json");
  return path.join(cwd, ".gemini", "settings.json");
}

export function ownershipPathForPlatform(cwd: string, platform: PlatformId): string {
  return path.join(cwd, ".uhr", "generated", `${platform}.json`);
}
