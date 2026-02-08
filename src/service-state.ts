import type { UhrLockfile } from "./types";

export function uninstallBlockers(serviceName: string, lockfile: UhrLockfile): string[] {
  const blockers: string[] = [];

  for (const [name, installed] of Object.entries(lockfile.installed)) {
    if (name === serviceName) {
      continue;
    }
    if ((installed.requires ?? []).includes(serviceName)) {
      blockers.push(name);
    }
  }

  return blockers.sort();
}
