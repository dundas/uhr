import path from "node:path";
import type { HookDeclaration } from "../types";
import type { Adapter, AdapterWarning } from "./types";

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

function hasAnyTool(tools: string[] | undefined, candidates: string[]): boolean {
  const selected = tools && tools.length > 0 ? tools : ["*"];
  if (selected.includes("*")) {
    return true;
  }
  return selected.some((tool) => candidates.includes(tool));
}

function mapEvent(universalEvent: string, hook: HookDeclaration): { event: string | null; warning?: string } {
  if (universalEvent === "beforePromptSubmit") {
    return { event: "beforeSubmitPrompt" };
  }
  if (universalEvent === "beforeFileRead") {
    return { event: "beforeReadFile" };
  }
  if (universalEvent === "beforeMcpExecution") {
    return { event: "beforeMCPExecution" };
  }
  if (universalEvent === "stop") {
    return { event: "stop" };
  }

  if (universalEvent === "beforeToolExecution") {
    if (hasAnyTool(hook.tools, ["bash"])) {
      return { event: "beforeShellExecution" };
    }
    return { event: null, warning: "No Cursor equivalent for beforeToolExecution on non-shell tools" };
  }

  if (universalEvent === "afterToolExecution") {
    if (hasAnyTool(hook.tools, ["write", "edit", "multi-edit"])) {
      return { event: "afterFileEdit" };
    }
    return { event: null, warning: "No Cursor equivalent for afterToolExecution on non-file tools" };
  }

  return { event: null, warning: `No Cursor mapping for universal event: ${universalEvent}` };
}

export const cursorAdapter: Adapter = {
  id: "cursor",
  name: "Cursor",
  detect: () => true,
  generate: (lockfile, cwd) => {
    const warnings: AdapterWarning[] = [];
    const hooks: Record<string, Array<{ command: string }>> = {
      beforeSubmitPrompt: [],
      beforeReadFile: [],
      beforeMCPExecution: [],
      stop: [],
      beforeShellExecution: [],
      afterFileEdit: []
    };

    for (const [eventName, refs] of Object.entries(lockfile.resolvedOrder)) {
      for (const ref of refs) {
        const hook = findHookByRef(ref, lockfile.installed);
        if (!hook) {
          continue;
        }

        if (hook.platforms && hook.platforms.length > 0 && !hook.platforms.includes("cursor")) {
          continue;
        }

        const mapped = mapEvent(eventName, hook);
        if (!mapped.event) {
          warnings.push({
            hookId: ref,
            message: mapped.warning ?? "Unsupported Cursor mapping"
          });
          continue;
        }

        hooks[mapped.event].push({ command: hook.command });
      }
    }

    return {
      filepath: path.join(cwd, ".cursor", "hooks.json"),
      content: {
        version: 1,
        _managedBy: "uhr",
        _generatedAt: lockfile.generatedAt,
        hooks
      },
      warnings
    };
  }
};
