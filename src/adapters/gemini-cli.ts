import path from "node:path";
import type { HookDeclaration } from "../types";
import type { Adapter, AdapterWarning } from "./types";

const EVENT_MAP: Record<string, string | undefined> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeToolExecution: "BeforeTool",
  afterToolExecution: "AfterTool",
  beforePromptSubmit: "BeforeModel",
  afterModelResponse: "AfterModel",
  stop: "AfterAgent",
  notification: "Notification",
  beforeCompact: "BeforeCompact",
  beforeToolSelection: "BeforeToolSelection"
};

const TOOL_MAP: Record<string, string> = {
  write: "write_file",
  edit: "replace",
  "multi-edit": "replace",
  bash: "shell",
  read: "read_file",
  grep: "grep",
  fetch: "web_fetch"
};

function findHookByRef(ref: string, installed: Record<string, { hooks: HookDeclaration[] }>): HookDeclaration | null {
  const [serviceName, hookId] = ref.split("/");
  if (!serviceName || !hookId) {
    return null;
  }
  const service = installed[serviceName];
  if (!service) {
    return null;
  }
  return service.hooks.find((hook) => hook.id === hookId) ?? null;
}

function matcherForTools(tools?: string[]): string {
  if (!tools || tools.length === 0 || tools.includes("*")) {
    return "";
  }

  const mapped = Array.from(new Set(tools.map((tool) => TOOL_MAP[tool]).filter(Boolean))).sort();
  return mapped.join("|");
}

export const geminiCliAdapter: Adapter = {
  id: "gemini-cli",
  name: "Gemini CLI",
  detect: () => true,
  generate: (lockfile, cwd) => {
    const warnings: AdapterWarning[] = [];
    const hooks: Record<string, unknown[]> = {};

    for (const [eventName, refs] of Object.entries(lockfile.resolvedOrder)) {
      const mappedEvent = EVENT_MAP[eventName];
      if (!mappedEvent) {
        for (const ref of refs) {
          warnings.push({ hookId: ref, message: `No Gemini mapping for universal event: ${eventName}` });
        }
        continue;
      }

      if (!hooks[mappedEvent]) {
        hooks[mappedEvent] = [];
      }

      for (const ref of refs) {
        const hook = findHookByRef(ref, lockfile.installed);
        if (!hook) {
          continue;
        }

        if (hook.platforms && hook.platforms.length > 0 && !hook.platforms.includes("gemini-cli")) {
          continue;
        }

        hooks[mappedEvent].push({
          name: ref.replace("/", "-"),
          matcher: matcherForTools(hook.tools),
          command: hook.command
        });
      }
    }

    return {
      filepath: path.join(cwd, ".gemini", "settings.json"),
      content: {
        _managedBy: "uhr",
        _generatedAt: lockfile.generatedAt,
        hooks
      },
      warnings
    };
  }
};
