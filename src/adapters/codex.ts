import { existsSync } from "node:fs";
import type { HookDeclaration } from "../types";
import { configPathForPlatform } from "../platforms";
import type { Adapter, AdapterWarning } from "./types";

const EVENT_MAP: Record<string, string | undefined> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeToolExecution: "PreToolUse",
  afterToolExecution: "PostToolUse",
  beforePromptSubmit: "UserPromptSubmit",
  permissionRequest: "PermissionRequest",
  stop: "Stop",
  subagentStop: "SubagentStop",
  beforeCompact: "PreCompact"
};

const TOOL_MATCHER_EVENTS = new Set(["PreToolUse", "PermissionRequest", "PostToolUse"]);
const BLOCKING_EVENTS = new Set(["SessionStart", "PreToolUse", "PermissionRequest", "PostToolUse", "UserPromptSubmit", "Stop", "SubagentStop", "PreCompact"]);
const TOOL_MAP: Record<string, string | undefined> = {
  bash: "Bash",
  write: "Write",
  edit: "Edit",
  "multi-edit": "apply_patch"
};

function findHook(ref: string, installed: Record<string, { hooks: HookDeclaration[] }>): HookDeclaration | null {
  const separator = ref.indexOf("/");
  if (separator < 1) return null;
  return installed[ref.slice(0, separator)]?.hooks.find((hook) => hook.id === ref.slice(separator + 1)) ?? null;
}

function matcherForTools(ref: string, tools: string[] | undefined, warnings: AdapterWarning[]): { matcher?: string; usable: boolean } {
  if (!tools || tools.length === 0 || tools.includes("*")) return { usable: true };
  const mapped: string[] = [];
  const unsupported: string[] = [];
  for (const tool of tools) {
    if (tool.startsWith("mcp__")) mapped.push(tool);
    else if (TOOL_MAP[tool]) mapped.push(TOOL_MAP[tool] as string);
    else unsupported.push(tool);
  }
  if (unsupported.length > 0) {
    warnings.push({ hookId: ref, message: `Codex cannot truthfully match universal tool(s): ${unsupported.join(", ")}` });
  }
  const unique = Array.from(new Set(mapped)).sort();
  return { matcher: unique.length > 0 ? unique.join("|") : undefined, usable: unique.length > 0 };
}

function timeoutInWholeSeconds(ref: string, timeoutMs: number, warnings: AdapterWarning[]): number {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  if (timeoutSeconds * 1000 !== timeoutMs) {
    warnings.push({
      hookId: ref,
      message: `Codex requires positive whole-second timeouts; ${timeoutMs}ms rounded up to ${timeoutSeconds} second(s)`
    });
  }
  return timeoutSeconds;
}

export const codexAdapter: Adapter = {
  id: "codex",
  name: "Codex",
  detect: (cwd = process.cwd()) => Bun.which("codex") !== null || existsSync(configPathForPlatform(cwd, "codex")),
  generate: (lockfile, cwd) => {
    const warnings: AdapterWarning[] = [];
    const hooks: Record<string, unknown[]> = {};

    for (const [eventName, refs] of Object.entries(lockfile.resolvedOrder)) {
      const platformEvent = EVENT_MAP[eventName];
      for (const ref of refs) {
        const hook = findHook(ref, lockfile.installed);
        if (!hook || (hook.platforms?.length && !hook.platforms.includes("codex"))) continue;
        if (!platformEvent) {
          warnings.push({ hookId: ref, message: `No Codex mapping for universal event: ${eventName}` });
          continue;
        }

        const tools = matcherForTools(ref, hook.tools, warnings);
        if (!tools.usable) continue;
        if (tools.matcher && !TOOL_MATCHER_EVENTS.has(platformEvent)) {
          warnings.push({ hookId: ref, message: `Codex ignores matcher/tool filters for ${platformEvent}; hook omitted to avoid broadening its scope` });
          continue;
        }

        const handler: Record<string, unknown> = { type: "command", command: hook.command };
        if (hook.timeout !== undefined) {
          const timeoutSeconds = timeoutInWholeSeconds(ref, hook.timeout, warnings);
          if (platformEvent === "SessionEnd" && timeoutSeconds > 3) {
            handler.timeout = 3;
            warnings.push({ hookId: ref, message: "Codex SessionEnd timeout is limited to 3 seconds; timeout clamped to 3" });
          } else {
            handler.timeout = timeoutSeconds;
          }
        }
        if (hook.background) {
          if (platformEvent === "SessionEnd") {
            warnings.push({ hookId: ref, message: "Codex SessionEnd always runs synchronously; background execution is unavailable" });
          } else {
            handler.async = true;
          }
        }
        if (hook.blocking && !BLOCKING_EVENTS.has(platformEvent)) {
          warnings.push({ hookId: ref, message: `Codex ${platformEvent} cannot provide the requested blocking semantics` });
        }
        if (hook.blocking && platformEvent === "PostToolUse") {
          warnings.push({ hookId: ref, message: "Codex PostToolUse blocking feedback cannot undo the tool action because it already ran" });
        }

        const group: Record<string, unknown> = { hooks: [handler] };
        if (tools.matcher) group.matcher = tools.matcher;
        (hooks[platformEvent] ??= []).push(group);
      }
    }

    return {
      filepath: configPathForPlatform(cwd, "codex"),
      content: { description: "Hooks generated by UHR. Preserve-mode ownership is tracked outside this provider file.", hooks },
      warnings
    };
  }
};
