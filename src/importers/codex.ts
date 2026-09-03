import path from "node:path";
import type { HookDeclaration } from "../types";
import type { ImportedServiceDraft, ImportSummary } from "./types";

const REVERSE_EVENT_MAP: Record<string, HookDeclaration["on"] | undefined> = {
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  PreToolUse: "beforeToolExecution",
  PostToolUse: "afterToolExecution",
  UserPromptSubmit: "beforePromptSubmit",
  PermissionRequest: "permissionRequest",
  Stop: "stop",
  SubagentStop: "subagentStop",
  PreCompact: "beforeCompact"
};

const REVERSE_TOOL_MAP: Record<string, string> = {
  Bash: "bash",
  Write: "write",
  Edit: "edit",
  apply_patch: "multi-edit"
};

function reverseTools(matcher: string | undefined): string[] | null {
  if (!matcher) return ["*"];
  const tools = matcher.split("|").map((tool) => tool.trim()).filter(Boolean);
  if (tools.length === 0 || tools.some((tool) => !/^[A-Za-z0-9_.:-]+$/.test(tool))) return null;
  const reversed = tools.map((tool) => REVERSE_TOOL_MAP[tool] ?? (tool.startsWith("mcp__") ? tool : undefined));
  return reversed.every((tool): tool is string => tool !== undefined) ? reversed : null;
}

export async function importCodex(cwd: string): Promise<{ summary: ImportSummary; service: ImportedServiceDraft | null }> {
  const sourcePath = path.join(cwd, ".codex", "hooks.json");
  const serviceName = "imported-codex";
  const file = Bun.file(sourcePath);
  if (!(await file.exists())) {
    return { summary: { platform: "codex", found: false, hooksImported: 0, serviceName, sourcePath, warnings: [] }, service: null };
  }

  const parsed = JSON.parse(await file.text()) as {
    hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number; async?: boolean }> }>>;
  };
  const warnings: string[] = [];
  const hooks: HookDeclaration[] = [];

  for (const [platformEvent, groups] of Object.entries(parsed.hooks ?? {})) {
    const universalEvent = REVERSE_EVENT_MAP[platformEvent];
    if (!universalEvent) {
      warnings.push(`Unmapped Codex event skipped: ${platformEvent}`);
      continue;
    }
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex] ?? {};
      const tools = reverseTools(group.matcher);
      if (!tools) {
        warnings.push(`Codex matcher cannot be represented as universal tools and was skipped: ${group.matcher}`);
        continue;
      }
      for (let handlerIndex = 0; handlerIndex < (group.hooks ?? []).length; handlerIndex += 1) {
        const handler = group.hooks?.[handlerIndex];
        if (handler?.type !== "command" || !handler.command) {
          warnings.push(`Unsupported Codex ${handler?.type ?? "unknown"} handler skipped: ${platformEvent}[${groupIndex}]`);
          continue;
        }
        hooks.push({
          id: `codex-${platformEvent.toLowerCase()}-${groupIndex + 1}-${handlerIndex + 1}`,
          on: universalEvent,
          command: handler.command,
          tools,
          blocking: handler.async !== true,
          background: handler.async === true,
          ...(handler.timeout !== undefined ? { timeout: handler.timeout * 1000 } : {}),
          platforms: ["codex"]
        });
      }
    }
  }

  return {
    summary: { platform: "codex", found: true, hooksImported: hooks.length, serviceName, sourcePath, warnings },
    service: { name: serviceName, sourcePath, sourcePlatform: "codex", hooks }
  };
}
