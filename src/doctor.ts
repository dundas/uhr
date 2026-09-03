import path from "node:path";
import { readFile } from "node:fs/promises";
import { lockfilePathForScope, readLockfile } from "./lockfile";
import { listBackups } from "./backup";
import { computeIntegrity } from "./util/integrity";
import { hooksForPlatforms } from "./util/patterns";
import { configPathForPlatform, ownershipPathForPlatform, SUPPORTED_PLATFORMS } from "./platforms";
import { assertSafeTarget } from "./util/safe-fs";
import { codexAdapter } from "./adapters/codex";
import type { PlatformId } from "./types";

export interface DoctorIssue {
  severity: "error" | "warning" | "info";
  message: string;
}

interface ManagedConfig {
  _managedBy?: string;
  _generatedAt?: string;
}

function knownPlatformPaths(cwd: string): Array<{ platform: PlatformId; path: string }> {
  return SUPPORTED_PLATFORMS.map((platform) => ({ platform, path: configPathForPlatform(cwd, platform) }));
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

async function codexRuntimeDiagnostic(cwd: string): Promise<DoctorIssue> {
  const configPath = path.join(cwd, ".codex", "config.toml");
  try {
    await assertSafeTarget(cwd, configPath);
  } catch (error) {
    return { severity: "error", message: `Unsafe Codex config target: ${(error as Error).message}` };
  }

  const configFile = Bun.file(configPath);
  if (await configFile.exists()) {
    try {
      const config = Bun.TOML.parse(await configFile.text()) as {
        features?: { hooks?: boolean; codex_hooks?: boolean };
      };
      const hooksEnabled = config.features?.hooks ?? config.features?.codex_hooks;
      if (hooksEnabled === false) {
        return { severity: "error", message: `Codex hooks are explicitly disabled in ${configPath}` };
      }
    } catch {
      return {
        severity: "warning",
        message: `Codex hook enablement and trust cannot be verified because ${configPath} is invalid TOML`
      };
    }
  }

  if (Bun.which("codex") === null) {
    return {
      severity: "warning",
      message: "Codex hook availability cannot be verified because the codex executable is not on PATH"
    };
  }

  return {
    severity: "warning",
    message: "Codex project-hook trust cannot be verified non-interactively; review and trust the generated hook with /hooks"
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function containsGeneratedCodexHooks(actual: unknown, generated: unknown): boolean {
  if (!isObject(actual) || !isObject(generated) || !isObject(actual.hooks) || !isObject(generated.hooks)) return false;
  for (const [event, expectedValue] of Object.entries(generated.hooks)) {
    if (!Array.isArray(expectedValue)) return false;
    const remaining = Array.isArray(actual.hooks[event]) ? [...actual.hooks[event] as unknown[]] : [];
    for (const expected of expectedValue) {
      const index = remaining.findIndex((candidate) => sameJson(candidate, expected));
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
  }
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    try {
      await assertSafeTarget(cwd, configPath);
      if (platform === "codex") await assertSafeTarget(cwd, ownershipPathForPlatform(cwd, "codex"));
    } catch (error) {
      issues.push({ severity: "error", message: `Unsafe config target for ${platform}: ${(error as Error).message}` });
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

    if (platform === "codex") {
      const actual = parsed as unknown;
      const expected = codexAdapter.generate(lockfile, cwd).content;
      const ownershipPath = ownershipPathForPlatform(cwd, "codex");
      if (!(await fileExists(ownershipPath))) {
        issues.push({ severity: "warning", message: `Codex UHR ownership record missing: ${ownershipPath}` });
      } else {
        try {
          const ownership = JSON.parse(await Bun.file(ownershipPath).text()) as { generatedAt?: string; content?: unknown };
          if (ownership.generatedAt !== lockfile.generatedAt || !sameJson(ownership.content, expected)) {
            issues.push({ severity: "warning", message: `Generated config drift detected for codex: ownership record does not match lockfile` });
          }
        } catch {
          issues.push({ severity: "warning", message: `Codex UHR ownership record is invalid JSON: ${ownershipPath}` });
        }
      }
      if (!containsGeneratedCodexHooks(actual, expected)) {
        issues.push({ severity: "warning", message: `Generated config drift detected for codex: ${configPath}` });
      }
      issues.push(await codexRuntimeDiagnostic(cwd));
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
    try {
      await assertSafeTarget(cwd, item.path);
    } catch (error) {
      if (!lockfile.platforms.includes(item.platform)) {
        issues.push({ severity: "error", message: `Unsafe config target for ${item.platform}: ${(error as Error).message}` });
      }
      continue;
    }

    if (!(await fileExists(item.path))) {
      continue;
    }

    if (lockfile.platforms.includes(item.platform)) {
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
      // A first install records missing provider files so restore can remove
      // only UHR-owned generated output. With no copied file there is no
      // backup directory to retain; that is an intentional empty snapshot.
      if (entry.files.length === 0) continue;
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
    if (!(await fileExists(platformConfigPath))) {
      issues.push({
        severity: "info",
        message: `Imported service ${name} references ${service.sourcePlatform} but platform config is missing`
      });
    }
  }

  return issues;
}
