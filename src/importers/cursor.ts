import path from "node:path";
import type { HookDeclaration } from "../types";
import type { ImportedServiceDraft, ImportSummary } from "./types";

const REVERSE_EVENT_MAP: Record<string, HookDeclaration["on"] | undefined> = {
  beforeSubmitPrompt: "beforePromptSubmit",
  beforeReadFile: "beforeFileRead",
  beforeMCPExecution: "beforeMcpExecution",
  stop: "stop",
  beforeShellExecution: "beforeToolExecution",
  afterFileEdit: "afterToolExecution"
};

const DEFAULT_TOOLS: Record<string, string[]> = {
  beforeShellExecution: ["bash"],
  afterFileEdit: ["write", "edit", "multi-edit"]
};

export async function importCursor(cwd: string): Promise<{ summary: ImportSummary; service: ImportedServiceDraft | null }> {
  const sourcePath = path.join(cwd, ".cursor", "hooks.json");
  const file = Bun.file(sourcePath);
  const serviceName = "imported-cursor";

  if (!(await file.exists())) {
    return {
      summary: {
        platform: "cursor",
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
    hooks?: Record<string, Array<{ command?: string }>>;
  };

  const warnings: string[] = [];
  const hooks: HookDeclaration[] = [];

  for (const [platformEvent, entries] of Object.entries(parsed.hooks ?? {})) {
    const universalEvent = REVERSE_EVENT_MAP[platformEvent];
    if (!universalEvent) {
      warnings.push(`Unmapped Cursor event skipped: ${platformEvent}`);
      continue;
    }

    for (let i = 0; i < entries.length; i += 1) {
      const command = entries[i]?.command;
      if (!command) {
        continue;
      }

      hooks.push({
        id: `cursor-${platformEvent.toLowerCase()}-${i + 1}`,
        on: universalEvent,
        command,
        tools: DEFAULT_TOOLS[platformEvent] ?? ["*"]
      });
    }
  }

  return {
    summary: {
      platform: "cursor",
      found: true,
      hooksImported: hooks.length,
      serviceName,
      sourcePath,
      warnings
    },
    service: {
      name: serviceName,
      sourcePath,
      sourcePlatform: "cursor",
      hooks
    }
  };
}
