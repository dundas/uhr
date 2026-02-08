import path from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { detectConflicts } from "./conflicts";
import { runDoctor } from "./doctor";
import { loadManifest } from "./manifest";
import { createDefaultLockfile, readLockfile, writeLockfile } from "./lockfile";
import { applyResolvedOrder } from "./resolver";
import { rebuildFromLockfile } from "./rebuild";
import { diffManifest } from "./service-diff";
import { uninstallBlockers } from "./service-state";
import { computeIntegrity } from "./util/integrity";
import type { Conflict, InstalledService, PlatformId, ServiceManifest } from "./types";

const VALID_PLATFORMS: PlatformId[] = ["claude-code", "cursor", "gemini-cli"];

interface ParsedArgs {
  command: string | null;
  positional: string[];
  force: boolean;
  json: boolean;
  platformsRaw: string | null;
  parseError: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? null;
  const rest = argv.slice(1);

  const positional: string[] = [];
  let force = false;
  let json = false;
  let platformsRaw: string | null = null;
  let parseError: string | null = null;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token) {
      continue;
    }

    if (token === "--force") {
      force = true;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token.startsWith("--platforms=")) {
      platformsRaw = token.slice("--platforms=".length);
      continue;
    }

    if (token === "--platforms") {
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) {
        parseError = "Missing value for --platforms";
        break;
      }
      platformsRaw = value;
      i += 1;
      continue;
    }

    if (token.startsWith("--")) {
      parseError = `Unknown option: ${token}`;
      break;
    }

    positional.push(token);
  }

  return { command, positional, force, json, platformsRaw, parseError };
}

function parsePlatforms(raw: string | null): PlatformId[] | null {
  if (!raw) {
    return null;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error("--platforms requires at least one platform");
  }

  const invalid = values.filter((value) => !VALID_PLATFORMS.includes(value as PlatformId));
  if (invalid.length > 0) {
    throw new Error(`Unsupported platform(s): ${invalid.join(", ")}`);
  }

  return Array.from(new Set(values)) as PlatformId[];
}

function helpText(): string {
  return [
    "uhr — Universal Hook Registry",
    "",
    "Commands:",
    "  uhr init [--platforms claude-code,cursor,gemini-cli]",
    "  uhr install <manifest> [--force] [--platforms <list>]",
    "  uhr uninstall <name>",
    "  uhr update <name> [--force] [--platforms <list>]",
    "  uhr list",
    "  uhr check <manifest>",
    "  uhr diff <manifest>",
    "  uhr rebuild [--platforms <list>]",
    "  uhr doctor [--json]"
  ].join("\n");
}

function printConflicts(conflicts: Conflict[]): void {
  for (const conflict of conflicts) {
    const prefix = conflict.severity === "error" ? "ERROR" : conflict.severity.toUpperCase();
    console.log(`${prefix}: ${conflict.message}`);
  }
}

function hasErrors(conflicts: Conflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === "error");
}

function manifestStorePath(cwd: string, serviceName: string): string {
  return path.join(cwd, ".uhr", "services", `${serviceName}.json`);
}

async function pathExists(filepath: string): Promise<boolean> {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}

async function initProject(cwd: string, platforms: PlatformId[] | null): Promise<void> {
  const filepath = await writeLockfile("project", cwd, createDefaultLockfile(platforms ?? undefined));
  console.log(`Initialized lockfile at ${filepath}`);
}

async function ensureProjectDirs(cwd: string): Promise<void> {
  await mkdir(path.join(cwd, ".uhr", "services"), { recursive: true });
}

async function checkManifest(manifestPath: string, cwd: string): Promise<number> {
  const { manifest } = await loadManifest(manifestPath, cwd);
  const lockfile = await readLockfile("project", cwd);
  const conflicts = detectConflicts(manifest, lockfile);

  if (conflicts.length === 0) {
    console.log("No conflicts detected.");
    return 0;
  }

  printConflicts(conflicts);
  return hasErrors(conflicts) ? 1 : 0;
}

async function installManifestFromData(
  manifest: ServiceManifest,
  manifestSourcePath: string,
  manifestContent: string,
  cwd: string,
  options?: { force?: boolean; platforms?: PlatformId[] | null }
): Promise<number> {
  await ensureProjectDirs(cwd);

  const lockfile = await readLockfile("project", cwd);
  if (options?.platforms && options.platforms.length > 0) {
    lockfile.platforms = options.platforms;
  }

  const conflicts = detectConflicts(manifest, lockfile);
  printConflicts(conflicts);

  if (hasErrors(conflicts) && !options?.force) {
    console.error("Installation aborted due to errors. Re-run with --force to override.");
    return 1;
  }

  const installedService: InstalledService = {
    version: manifest.version,
    installedAt: new Date().toISOString(),
    integrity: await computeIntegrity(manifestContent),
    source: `local:${manifestSourcePath}`,
    hooks: manifest.hooks,
    permissions: manifest.permissions,
    ordering: manifest.ordering,
    requires: manifest.requires ?? [],
    conflicts: manifest.conflicts ?? []
  };

  lockfile.installed[manifest.name] = installedService;

  const updated = applyResolvedOrder({
    ...lockfile,
    generatedBy: "uhr@0.1.0"
  });

  const lockfilePath = await writeLockfile("project", cwd, updated);

  const serviceManifestPath = manifestStorePath(cwd, manifest.name);
  await Bun.write(serviceManifestPath, manifestContent);

  const rebuildResult = await rebuildFromLockfile(updated, cwd);

  console.log(`Installed ${manifest.name}@${manifest.version}`);
  console.log(`Updated ${lockfilePath}`);
  console.log(`Stored manifest at ${serviceManifestPath}`);
  for (const file of rebuildResult.writtenFiles) {
    console.log(`Generated ${file}`);
  }
  for (const warning of rebuildResult.warnings) {
    console.log(`WARNING: ${warning.hookId}: ${warning.message}`);
  }

  return 0;
}

async function installManifest(
  manifestPath: string,
  cwd: string,
  options?: { force?: boolean; platforms?: PlatformId[] | null }
): Promise<number> {
  const { filepath, content, manifest } = await loadManifest(manifestPath, cwd);
  return installManifestFromData(manifest, filepath, content, cwd, options);
}

async function uninstallService(serviceName: string, cwd: string): Promise<number> {
  const lockfile = await readLockfile("project", cwd);

  if (!lockfile.installed[serviceName]) {
    console.error(`Service not installed: ${serviceName}`);
    return 1;
  }

  const blockers = uninstallBlockers(serviceName, lockfile);
  if (blockers.length > 0) {
    console.error(`Cannot uninstall ${serviceName}; required by: ${blockers.join(", ")}`);
    return 1;
  }

  delete lockfile.installed[serviceName];
  const updated = applyResolvedOrder(lockfile);
  const lockfilePath = await writeLockfile("project", cwd, updated);

  const serviceManifestPath = manifestStorePath(cwd, serviceName);
  if (await pathExists(serviceManifestPath)) {
    await rm(serviceManifestPath, { force: true });
  }

  const rebuildResult = await rebuildFromLockfile(updated, cwd);

  console.log(`Uninstalled ${serviceName}`);
  console.log(`Updated ${lockfilePath}`);
  for (const file of rebuildResult.writtenFiles) {
    console.log(`Generated ${file}`);
  }

  return 0;
}

async function updateService(
  serviceName: string,
  cwd: string,
  options?: { force?: boolean; platforms?: PlatformId[] | null }
): Promise<number> {
  const lockfile = await readLockfile("project", cwd);
  const installed = lockfile.installed[serviceName];

  if (!installed) {
    console.error(`Service not installed: ${serviceName}`);
    return 1;
  }

  if (!installed.source.startsWith("local:")) {
    console.error(`Unsupported source for update: ${installed.source}`);
    return 1;
  }

  const sourcePath = installed.source.replace(/^local:/, "");
  const { filepath, content, manifest } = await loadManifest(sourcePath, cwd);
  if (manifest.name !== serviceName) {
    console.error(`Manifest name mismatch. Expected ${serviceName}, got ${manifest.name}`);
    return 1;
  }

  return installManifestFromData(manifest, filepath, content, cwd, options);
}

async function diffService(manifestPath: string, cwd: string): Promise<number> {
  const lockfile = await readLockfile("project", cwd);
  const { manifest } = await loadManifest(manifestPath, cwd);

  const installed = lockfile.installed[manifest.name];
  const previous: ServiceManifest | null = installed
    ? {
        name: manifest.name,
        version: installed.version,
        hooks: installed.hooks,
        permissions: installed.permissions,
        ordering: installed.ordering,
        requires: installed.requires,
        conflicts: installed.conflicts
      }
    : null;

  const diff = diffManifest(previous, manifest);

  console.log(`Service: ${diff.service}`);
  console.log(`Version: ${diff.previousVersion ?? "(not installed)"} -> ${diff.nextVersion}`);
  console.log(`Hooks to add: ${diff.addedHooks.length}`);
  for (const hook of diff.addedHooks) {
    console.log(`  + ${hook}`);
  }
  console.log(`Hooks to remove: ${diff.removedHooks.length}`);
  for (const hook of diff.removedHooks) {
    console.log(`  - ${hook}`);
  }
  console.log(`Hooks changed: ${diff.changedHooks.length}`);
  for (const hook of diff.changedHooks) {
    console.log(`  ~ ${hook}`);
  }
  console.log(`Permissions changed: ${diff.changedPermissions ? "yes" : "no"}`);

  return 0;
}

async function rebuild(cwd: string, platforms: PlatformId[] | null): Promise<number> {
  const lockfile = await readLockfile("project", cwd);
  if (platforms && platforms.length > 0) {
    lockfile.platforms = platforms;
  }

  const updated = applyResolvedOrder(lockfile);
  const lockfilePath = await writeLockfile("project", cwd, updated);
  const rebuildResult = await rebuildFromLockfile(updated, cwd);

  console.log(`Updated ${lockfilePath}`);
  for (const file of rebuildResult.writtenFiles) {
    console.log(`Generated ${file}`);
  }
  for (const warning of rebuildResult.warnings) {
    console.log(`WARNING: ${warning.hookId}: ${warning.message}`);
  }

  return 0;
}

async function doctor(cwd: string, asJson: boolean): Promise<number> {
  const issues = await runDoctor(cwd);

  if (asJson) {
    console.log(JSON.stringify({ issues }, null, 2));
    return issues.some((issue) => issue.severity === "error") ? 1 : 0;
  }

  if (issues.length === 0) {
    console.log("No issues detected.");
    return 0;
  }

  for (const issue of issues) {
    const prefix = issue.severity === "error" ? "ERROR" : issue.severity.toUpperCase();
    console.log(`${prefix}: ${issue.message}`);
  }

  return issues.some((issue) => issue.severity === "error") ? 1 : 0;
}

export async function runCli(argv: string[], cwd?: string): Promise<number> {
  const { command, positional, force, json, platformsRaw, parseError } = parseArgs(argv);
  const effectiveCwd = cwd ?? process.cwd();
  const arg1 = positional[0];

  if (parseError) {
    console.error(parseError);
    return 1;
  }

  let platforms: PlatformId[] | null = null;
  try {
    platforms = parsePlatforms(platformsRaw);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }

  if (!command || command === "--help" || command === "-h") {
    console.log(helpText());
    return 0;
  }

  if (command === "init") {
    await initProject(effectiveCwd, platforms);
    return 0;
  }

  if (command === "install") {
    if (!arg1) {
      console.error("Usage: uhr install <manifest> [--force] [--platforms <list>]");
      return 1;
    }
    return installManifest(arg1, effectiveCwd, { force, platforms });
  }

  if (command === "uninstall") {
    if (!arg1) {
      console.error("Usage: uhr uninstall <name>");
      return 1;
    }
    return uninstallService(arg1, effectiveCwd);
  }

  if (command === "update") {
    if (!arg1) {
      console.error("Usage: uhr update <name> [--force] [--platforms <list>]");
      return 1;
    }
    return updateService(arg1, effectiveCwd, { force, platforms });
  }

  if (command === "check") {
    if (!arg1) {
      console.error("Usage: uhr check <manifest>");
      return 1;
    }
    return checkManifest(arg1, effectiveCwd);
  }

  if (command === "diff") {
    if (!arg1) {
      console.error("Usage: uhr diff <manifest>");
      return 1;
    }
    return diffService(arg1, effectiveCwd);
  }

  if (command === "rebuild") {
    return rebuild(effectiveCwd, platforms);
  }

  if (command === "doctor") {
    return doctor(effectiveCwd, json);
  }

  if (command === "list") {
    const lockfile = await readLockfile("project", effectiveCwd);
    const names = Object.keys(lockfile.installed);
    if (names.length === 0) {
      console.log("No services installed.");
      return 0;
    }
    for (const name of names) {
      const service = lockfile.installed[name];
      console.log(`${name}@${service.version}`);
    }
    return 0;
  }

  console.error(`Not implemented yet: ${command}`);
  return 1;
}
