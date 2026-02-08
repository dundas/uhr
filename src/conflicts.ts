import { permissionPatternsOverlap, toolsOverlap } from "./util/patterns";
import type { Conflict, HookDeclaration, ServiceManifest, UhrLockfile } from "./types";

function hookKey(hook: HookDeclaration): string {
  const tools = [...(hook.tools ?? ["*"])].sort().join("|");
  return `${hook.on}::${tools}::${hook.command}`;
}

export function detectConflicts(manifest: ServiceManifest, lockfile: UhrLockfile): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const [name, installed] of Object.entries(lockfile.installed)) {
    if (name === manifest.name) {
      continue;
    }
    if (manifest.conflicts?.includes(name) || installed.conflicts?.includes(manifest.name)) {
      conflicts.push({
        type: "explicit",
        severity: "error",
        message: `${manifest.name} conflicts with ${name}`
      });
    }

    for (const allowed of manifest.permissions?.allow ?? []) {
      for (const denied of installed.permissions?.deny ?? []) {
        if (permissionPatternsOverlap(allowed, denied)) {
          conflicts.push({
            type: "permission_contradiction",
            severity: "error",
            message: `${manifest.name} allows ${allowed} but ${name} denies ${denied}`
          });
        }
      }
    }

    for (const denied of manifest.permissions?.deny ?? []) {
      for (const allowed of installed.permissions?.allow ?? []) {
        if (permissionPatternsOverlap(denied, allowed)) {
          conflicts.push({
            type: "permission_contradiction",
            severity: "error",
            message: `${manifest.name} denies ${denied} but ${name} allows ${allowed}`
          });
        }
      }
    }

    for (const candidateHook of manifest.hooks) {
      for (const existingHook of installed.hooks) {
        if (candidateHook.on !== existingHook.on) {
          continue;
        }

        if (!toolsOverlap(candidateHook.tools, existingHook.tools)) {
          continue;
        }

        if (hookKey(candidateHook) === hookKey(existingHook)) {
          conflicts.push({
            type: "duplicate_hook",
            severity: "warning",
            message: `${manifest.name}/${candidateHook.id} duplicates ${name}/${existingHook.id}`
          });
        } else {
          conflicts.push({
            type: "shared_slot",
            severity: "info",
            message: `${manifest.name}/${candidateHook.id} shares ${candidateHook.on} with ${name}/${existingHook.id}`
          });
        }
      }
    }

    // Ownership collision: warn when a managed service overlaps with imported hooks
    if (installed.ownership === "imported") {
      for (const candidateHook of manifest.hooks) {
        for (const importedHook of installed.hooks) {
          if (candidateHook.on === importedHook.on && toolsOverlap(candidateHook.tools, importedHook.tools)) {
            conflicts.push({
              type: "ownership_collision",
              severity: "warning",
              message: `${manifest.name}/${candidateHook.id} may override imported hook ${name}/${importedHook.id} on ${candidateHook.on}`
            });
          }
        }
      }
    }
  }

  // Platform gap: hooks targeting platforms not in the lockfile
  for (const hook of manifest.hooks) {
    if (hook.platforms && hook.platforms.length > 0) {
      for (const platform of hook.platforms) {
        if (!lockfile.platforms.includes(platform)) {
          conflicts.push({
            type: "platform_gap",
            severity: "warning",
            message: `${manifest.name}/${hook.id} targets ${platform} which is not in lockfile platforms`
          });
        }
      }
    }
  }

  for (const required of manifest.requires ?? []) {
    if (!lockfile.installed[required]) {
      conflicts.push({
        type: "missing_requirement",
        severity: "error",
        message: `${manifest.name} requires ${required}`
      });
    }
  }

  return conflicts;
}
