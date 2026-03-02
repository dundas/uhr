import path from "node:path";
import { readFile } from "node:fs/promises";
import { lockfilePathForScope, readLockfile } from "./lockfile";
import { listBackups } from "./backup";
import { computeIntegrity } from "./util/integrity";
import { hooksForPlatforms } from "./util/patterns";

export interface DoctorIssue {
  severity: "error" | "warning" | "info";
  message: string;
}

interface ManagedConfig {
  _managedBy?: string;
  _generatedAt?: string;
}

function configPathForPlatform(cwd: string, platform: string): string | null {
  if (platform === "claude-code") {
    return path.join(cwd, ".claude", "settings.json");
  }
  if (platform === "cursor") {
    return path.join(cwd, ".cursor", "hooks.json");
  }
  if (platform === "gemini-cli") {
    return path.join(cwd, ".gemini", "settings.json");
  }
  return null;
}

function knownPlatformPaths(cwd: string): Array<{ platform: string; path: string }> {
  return [
    { platform: "claude-code", path: path.join(cwd, ".claude", "settings.json") },
    { platform: "cursor", path: path.join(cwd, ".cursor", "hooks.json") },
    { platform: "gemini-cli", path: path.join(cwd, ".gemini", "settings.json") }
  ];
}

async function fileExists(filepath: string): Promise<boolean> {
  return await Bun.file(filepath).exists();
}

async function readManagedConfig(filepath: string): Promise<ManagedConfig | null> {
  try {
    const parsed = JSON.parse(await Bun.file(filepath).text()) as ManagedConfig;
    return parsed;
  } catch {
    return null;
  }
}

export async function runDoctor(cwd: string): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const lockfilePath = lockfilePathForScope("project", cwd);

  if (!(await fileExists(lockfilePath))) {
    issues.push({ severity: "warning", message: `Lockfile missing: ${lockfilePath}` });
    return issues;
  }

  const lockfile = await readLockfile("project", cwd);

  for (const platform of lockfile.platforms) {
    const configPath = configPathForPlatform(cwd, platform);
    if (!configPath) {
      continue;
    }

    if (!(await fileExists(configPath))) {
      issues.push({ severity: "warning", message: `Generated config missing for ${platform}: ${configPath}` });
      continue;
    }

    const parsed = await readManagedConfig(configPath);
    if (!parsed) {
      issues.push({ severity: "warning", message: `Config is not valid JSON: ${configPath}` });
      continue;
    }

    if (parsed._managedBy !== "uhr") {
      issues.push({ severity: "warning", message: `Config not marked as UHR-managed: ${configPath}` });
    }

    if (typeof parsed._generatedAt === "string" && parsed._generatedAt !== lockfile.generatedAt) {
      issues.push({
        severity: "warning",
        message: `Generated config may be stale for ${platform}: lockfile=${lockfile.generatedAt}, config=${parsed._generatedAt}`
      });
    }
  }

  for (const item of knownPlatformPaths(cwd)) {
    if (!(await fileExists(item.path))) {
      continue;
    }

    if (lockfile.platforms.includes(item.platform as "claude-code" | "cursor" | "gemini-cli")) {
      continue;
    }

    const parsed = await readManagedConfig(item.path);
    if (parsed && parsed._managedBy === "uhr") {
      issues.push({
        severity: "warning",
        message: `UHR-managed config exists for undetected platform ${item.platform}: ${item.path}`
      });
      continue;
    }

    issues.push({
      severity: "info",
      message: `Platform config exists but is unmanaged by UHR: ${item.path}`
    });
  }

  for (const [name, service] of Object.entries(lockfile.installed)) {
    const storedManifestPath = path.join(cwd, ".uhr", "services", `${name}.json`);
    if (!(await fileExists(storedManifestPath))) {
      issues.push({ severity: "warning", message: `Stored manifest missing for ${name}: ${storedManifestPath}` });
    }

    if (!service.source.startsWith("local:")) {
      continue;
    }

    const sourcePath = service.source.replace(/^local:/, "");
    if (!(await fileExists(sourcePath))) {
      issues.push({ severity: "warning", message: `Source manifest missing for ${name}: ${sourcePath}` });
      continue;
    }

    try {
      const content = await readFile(sourcePath, "utf8");
      const currentIntegrity = await computeIntegrity(content);
      if (currentIntegrity !== service.integrity) {
        issues.push({
          severity: "warning",
          message: `${name} integrity mismatch (lockfile=${service.integrity}, current=${currentIntegrity})`
        });
      }
    } catch {
      issues.push({ severity: "warning", message: `Unable to verify integrity for ${name}` });
    }
  }

  // Services with no hooks for any active platform
  const activePlatformsStr = lockfile.platforms.join(", ");
  for (const [name, service] of Object.entries(lockfile.installed)) {
    if (service.hooks.length === 0) {
      continue;
    }
    if (hooksForPlatforms(service.hooks, lockfile.platforms).length === 0) {
      const hookPlatforms = Array.from(new Set(service.hooks.flatMap((h) => h.platforms ?? []))).join(", ");
      issues.push({
        severity: "warning",
        message: `${name} has ${service.hooks.length} hook(s) but none target the lockfile platforms (${activePlatformsStr}). Hook platforms: ${hookPlatforms}`
      });
    }
  }

  // Migration diagnostic: imported hooks at risk under strict merge mode
  const importedServices = Object.entries(lockfile.installed).filter(
    ([, svc]) => svc.ownership === "imported"
  );
  if (lockfile.mergeMode === "strict" && importedServices.length > 0) {
    const names = importedServices.map(([n]) => n).join(", ");
    issues.push({
      severity: "warning",
      message: `Merge mode is "strict" but imported services exist (${names}). Imported hooks may be overwritten on rebuild. Consider switching to "preserve" mode.`
    });
  }

  // Migration diagnostic: stale backup index (entries referencing missing backup dirs)
  try {
    const backups = await listBackups(cwd);
    for (const entry of backups) {
      const backupDir = path.join(cwd, ".uhr", "backups", entry.timestamp);
      if (!(await fileExists(backupDir))) {
        issues.push({
          severity: "warning",
          message: `Backup index references missing directory: ${entry.timestamp}`
        });
      }
    }
  } catch {
    // No backup index — that's fine, skip
  }

  // Migration diagnostic: imported service source platform config drift
  for (const [name, service] of Object.entries(lockfile.installed)) {
    if (service.ownership !== "imported" || !service.sourcePlatform) {
      continue;
    }
    const platformConfigPath = configPathForPlatform(cwd, service.sourcePlatform);
    if (!platformConfigPath || !(await fileExists(platformConfigPath))) {
      issues.push({
        severity: "info",
        message: `Imported service ${name} references ${service.sourcePlatform} but platform config is missing`
      });
    }
  }

  return issues;
}
