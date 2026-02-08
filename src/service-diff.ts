import type { ServiceManifest } from "./types";

function hookRef(hook: { id: string; on: string; tools?: string[]; command: string }): string {
  const tools = (hook.tools ?? ["*"]).join("|");
  return `${hook.id} [${hook.on}] tools=${tools} cmd=${hook.command}`;
}

export interface ManifestDiff {
  service: string;
  previousVersion: string | null;
  nextVersion: string;
  addedHooks: string[];
  removedHooks: string[];
  changedHooks: string[];
  changedPermissions: boolean;
}

export function diffManifest(previous: ServiceManifest | null, next: ServiceManifest): ManifestDiff {
  const prevHooks = new Map<string, string>();
  const nextHooks = new Map<string, string>();

  for (const hook of previous?.hooks ?? []) {
    prevHooks.set(hook.id, hookRef(hook));
  }
  for (const hook of next.hooks) {
    nextHooks.set(hook.id, hookRef(hook));
  }

  const addedHooks: string[] = [];
  const removedHooks: string[] = [];
  const changedHooks: string[] = [];

  for (const [id, ref] of nextHooks.entries()) {
    if (!prevHooks.has(id)) {
      addedHooks.push(ref);
      continue;
    }
    if (prevHooks.get(id) !== ref) {
      changedHooks.push(ref);
    }
  }

  for (const [id, ref] of prevHooks.entries()) {
    if (!nextHooks.has(id)) {
      removedHooks.push(ref);
    }
  }

  const prevPerms = JSON.stringify(previous?.permissions ?? { allow: [], deny: [] });
  const nextPerms = JSON.stringify(next.permissions ?? { allow: [], deny: [] });

  return {
    service: next.name,
    previousVersion: previous?.version ?? null,
    nextVersion: next.version,
    addedHooks: addedHooks.sort(),
    removedHooks: removedHooks.sort(),
    changedHooks: changedHooks.sort(),
    changedPermissions: prevPerms !== nextPerms
  };
}
