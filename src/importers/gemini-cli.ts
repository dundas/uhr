import path from "node:path";
import type { HookDeclaration } from "../types";
import type { ImportedServiceDraft, ImportSummary } from "./types";

const REVERSE_EVENT_MAP: Record<string, HookDeclaration["on"] | undefined> = {
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  BeforeTool: "beforeToolExecution",
  AfterTool: "afterToolExecution",
  BeforeModel: "beforePromptSubmit",
  AfterModel: "afterModelResponse",
  AfterAgent: "stop",
  Notification: "notification",
  BeforeCompact: "beforeCompact",
  BeforeToolSelection: "beforeToolSelection"
};

function reverseMatcher(matcher: string): string[] {
  if (!matcher || matcher.trim().length === 0) {
    return ["*"];
  }

  const map: Record<string, string> = {
    write_file: "write",
    replace: "edit",
    shell: "bash",
    read_file: "read",
    grep: "grep",
    web_fetch: "fetch"
  };

  return matcher
    .split("|")
    .map((item) => item.trim())
    .map((item) => map[item])
    .filter((value): value is string => Boolean(value));
}

export async function importGemini(cwd: string): Promise<{ summary: ImportSummary; service: ImportedServiceDraft | null }> {
  const sourcePath = path.join(cwd, ".gemini", "settings.json");
  const file = Bun.file(sourcePath);
  const serviceName = "imported-gemini-cli";

  if (!(await file.exists())) {
    return {
      summary: {
        platform: "gemini-cli",
        found: false,
        hooksImported: 0,
        serviceName,
        sourcePath,
        warnings: []
      },
      service: null
    };
  }

  const parsed = JSON.parse(await file.text()) as {
    hooks?: Record<string, Array<{ command?: string; matcher?: string }>>;
  };

  const warnings: string[] = [];
  const hooks: HookDeclaration[] = [];

  for (const [platformEvent, entries] of Object.entries(parsed.hooks ?? {})) {
    const universalEvent = REVERSE_EVENT_MAP[platformEvent];
    if (!universalEvent) {
      warnings.push(`Unmapped Gemini event skipped: ${platformEvent}`);
      continue;
    }

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i] ?? {};
      if (!entry.command) {
        continue;
      }

      hooks.push({
        id: `gemini-${platformEvent.toLowerCase()}-${i + 1}`,
        on: universalEvent,
        command: entry.command,
        tools: reverseMatcher(entry.matcher ?? "")
      });
    }
  }

  return {
    summary: {
      platform: "gemini-cli",
      found: true,
      hooksImported: hooks.length,
      serviceName,
      sourcePath,
      warnings
    },
    service: {
      name: serviceName,
      sourcePath,
      sourcePlatform: "gemini-cli",
      hooks
    }
  };
}
