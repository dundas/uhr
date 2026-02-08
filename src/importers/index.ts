import type { PlatformId } from "../types";
import { importClaude } from "./claude-code";
import { importCursor } from "./cursor";
import { importGemini } from "./gemini-cli";
import type { ImportSummary, ImportedServiceDraft } from "./types";

export interface ImportResult {
  summaries: ImportSummary[];
  services: ImportedServiceDraft[];
}

export async function importPlatforms(cwd: string, platforms: PlatformId[]): Promise<ImportResult> {
  const summaries: ImportSummary[] = [];
  const services: ImportedServiceDraft[] = [];

  for (const platform of platforms) {
    if (platform === "claude-code") {
      const result = await importClaude(cwd);
      summaries.push(result.summary);
      if (result.service) {
        services.push(result.service);
      }
      continue;
    }

    if (platform === "cursor") {
      const result = await importCursor(cwd);
      summaries.push(result.summary);
      if (result.service) {
        services.push(result.service);
      }
      continue;
    }

    if (platform === "gemini-cli") {
      const result = await importGemini(cwd);
      summaries.push(result.summary);
      if (result.service) {
        services.push(result.service);
      }
    }
  }

  return { summaries, services };
}
