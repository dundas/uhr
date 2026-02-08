import path from "node:path";
import type { HookDeclaration } from "../types";
import type { ImportedServiceDraft, ImportSummary } from "./types";

const REVERSE_EVENT_MAP: Record<string, HookDeclaration["on"] | undefined> = {
  PreToolUse: "beforeToolExecution",
  PostToolUse: "afterToolExecution",
  Stop: "stop",
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  Notification: "notification",
  UserPromptSubmit: "beforePromptSubmit",
  PermissionRequest: "permissionRequest",
  SubagentStop: "subagentStop",
  PreCompact: "beforeCompact"
};

function reverseTools(matcher: string): string[] {
  if (!matcher || matcher.trim().length === 0) {
    return ["*"];
  }

  const map: Record<string, string> = {
    Write: "write",
    Edit: "edit",
    MultiEdit: "multi-edit",
    Bash: "bash",
    Read: "read",
    Grep: "grep",
    WebFetch: "fetch"
  };

  return matcher
    .split("|")
    .map((part) => part.trim())
    .map((part) => map[part])
    .filter((value): value is string => Boolean(value));
}

export async function importClaude(cwd: string): Promise<{ summary: ImportSummary; service: ImportedServiceDraft | null }> {
  const sourcePath = path.join(cwd, ".claude", "settings.json");
  const file = Bun.file(sourcePath);
  const serviceName = "imported-claude-code";

  if (!(await file.exists())) {
    return {
      summary: {
        platform: "claude-code",
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
    hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    permissions?: { allowedTools?: string[] };
  };

  const warnings: string[] = [];
  const hooks: HookDeclaration[] = [];

  for (const [platformEvent, entries] of Object.entries(parsed.hooks ?? {})) {
    const universalEvent = REVERSE_EVENT_MAP[platformEvent];
    if (!universalEvent) {
      warnings.push(`Unmapped Claude event skipped: ${platformEvent}`);
      continue;
    }

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i] ?? {};
      const commands = entry.hooks ?? [];
      for (let j = 0; j < commands.length; j += 1) {
        const command = commands[j]?.command;
        if (!command) {
          continue;
        }
        hooks.push({
          id: `claude-${platformEvent.toLowerCase()}-${i + 1}-${j + 1}`,
          on: universalEvent,
          command,
          tools: reverseTools(entry.matcher ?? "")
        });
      }
    }
  }

  return {
    summary: {
      platform: "claude-code",
      found: true,
      hooksImported: hooks.length,
      serviceName,
      sourcePath,
      warnings
    },
    service: {
      name: serviceName,
      sourcePath,
      sourcePlatform: "claude-code",
      hooks,
      permissions: {
        allow: parsed.permissions?.allowedTools ?? [],
        deny: []
      }
    }
  };
}
