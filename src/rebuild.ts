import path from "node:path";
import { builtInAdapters } from "./adapters";
import type { AdapterWarning } from "./adapters/types";
import { createBackup } from "./backup";
import { ownershipPathForPlatform } from "./platforms";
import type { UhrLockfile } from "./types";
import { assertSafeTarget, atomicWriteFile } from "./util/safe-fs";

export interface RebuildOptions {
  trigger?: string;
}

export interface RebuildResult {
  writtenFiles: string[];
  warnings: AdapterWarning[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeClaudePreserve(existing: unknown, generated: unknown): unknown {
  if (!isObject(existing) || !isObject(generated)) {
    return generated;
  }

  const merged: Record<string, unknown> = { ...existing, ...generated };
  const existingHooks = isObject(existing.hooks) ? (existing.hooks as Record<string, unknown[]>) : {};
  const generatedHooks = isObject(generated.hooks) ? (generated.hooks as Record<string, unknown[]>) : {};

  const hooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [eventName, generatedEntries] of Object.entries(generatedHooks)) {
    const oldEntries = Array.isArray(existingHooks[eventName]) ? (existingHooks[eventName] as unknown[]) : [];
    const unmanaged = oldEntries.filter((entry) => !isObject(entry) || typeof entry._uhrSource !== "string");
    hooks[eventName] = [...unmanaged, ...(generatedEntries ?? [])];
  }

  merged.hooks = hooks;

  if (isObject(existing.permissions) && isObject(generated.permissions)) {
    const existingAllowed = Array.isArray(existing.permissions.allowedTools)
      ? (existing.permissions.allowedTools as string[])
      : [];
    const generatedAllowed = Array.isArray(generated.permissions.allowedTools)
      ? (generated.permissions.allowedTools as string[])
      : [];

    merged.permissions = {
      ...(existing.permissions as Record<string, unknown>),
      ...(generated.permissions as Record<string, unknown>),
      allowedTools: Array.from(new Set([...existingAllowed, ...generatedAllowed])).sort()
    };
  }

  return merged;
}

function mergeCursorPreserve(existing: unknown, generated: unknown): unknown {
  if (!isObject(existing) || !isObject(generated)) {
    return generated;
  }

  const merged: Record<string, unknown> = { ...existing, ...generated };
  const existingHooks = isObject(existing.hooks) ? (existing.hooks as Record<string, unknown[]>) : {};
  const generatedHooks = isObject(generated.hooks) ? (generated.hooks as Record<string, unknown[]>) : {};

  const hooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [eventName, generatedEntries] of Object.entries(generatedHooks)) {
    const oldEntries = Array.isArray(existingHooks[eventName]) ? (existingHooks[eventName] as unknown[]) : [];
    const nextEntries: unknown[] = [];
    const seen = new Set<string>();

    for (const entry of [...oldEntries, ...(generatedEntries ?? [])]) {
      if (!isObject(entry) || typeof entry.command !== "string") {
        nextEntries.push(entry);
        continue;
      }
      if (seen.has(entry.command)) {
        continue;
      }
      seen.add(entry.command);
      nextEntries.push(entry);
    }

    hooks[eventName] = nextEntries;
  }

  merged.hooks = hooks;
  return merged;
}

function mergeGeminiPreserve(existing: unknown, generated: unknown): unknown {
  if (!isObject(existing) || !isObject(generated)) {
    return generated;
  }

  const merged: Record<string, unknown> = { ...existing, ...generated };
  const existingHooks = isObject(existing.hooks) ? (existing.hooks as Record<string, unknown[]>) : {};
  const generatedHooks = isObject(generated.hooks) ? (generated.hooks as Record<string, unknown[]>) : {};

  const hooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [eventName, generatedEntries] of Object.entries(generatedHooks)) {
    const oldEntries = Array.isArray(existingHooks[eventName]) ? (existingHooks[eventName] as unknown[]) : [];
    const managedNames = new Set(
      (generatedEntries ?? [])
        .filter((entry) => isObject(entry) && typeof entry.name === "string")
        .map((entry) => (entry as { name: string }).name)
    );

    const preserved = oldEntries.filter((entry) => {
      if (!isObject(entry) || typeof entry.name !== "string") {
        return true;
      }
      return !managedNames.has(entry.name);
    });

    hooks[eventName] = [...preserved, ...(generatedEntries ?? [])];
  }

  merged.hooks = hooks;
  return merged;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutPreviousManaged(existing: unknown[], previous: unknown[]): unknown[] {
  const remaining = [...existing];
  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (sameJson(remaining[index], previous[previousIndex])) {
        remaining.splice(index, 1);
        break;
      }
    }
  }
  return remaining;
}

function mergeCodexPreserve(existing: unknown, generated: unknown, previousGenerated: unknown): unknown {
  if (!isObject(existing) || !isObject(generated)) return generated;

  const existingHooks = isObject(existing.hooks) ? existing.hooks as Record<string, unknown[]> : {};
  const generatedHooks = isObject(generated.hooks) ? generated.hooks as Record<string, unknown[]> : {};
  const previousHooks = isObject(previousGenerated) && isObject(previousGenerated.hooks)
    ? previousGenerated.hooks as Record<string, unknown[]>
    : {};
  const hooks: Record<string, unknown[]> = {};
  const events = new Set([...Object.keys(existingHooks), ...Object.keys(previousHooks), ...Object.keys(generatedHooks)]);

  for (const event of events) {
    const existingEntries = Array.isArray(existingHooks[event]) ? existingHooks[event] : [];
    const oldManaged = Array.isArray(previousHooks[event]) ? previousHooks[event] : [];
    const nextManaged = Array.isArray(generatedHooks[event]) ? generatedHooks[event] : [];
    const merged = [...withoutPreviousManaged(existingEntries, oldManaged), ...nextManaged];
    if (merged.length > 0 || event in existingHooks) hooks[event] = merged;
  }

  return { ...generated, ...existing, hooks };
}

function mergePreserve(existing: unknown, generated: unknown, filepath: string, previousGenerated?: unknown): unknown {
  if (filepath.endsWith(".claude/settings.json")) {
    return mergeClaudePreserve(existing, generated);
  }
  if (filepath.endsWith(".cursor/hooks.json")) {
    return mergeCursorPreserve(existing, generated);
  }
  if (filepath.endsWith(".gemini/settings.json")) {
    return mergeGeminiPreserve(existing, generated);
  }
  if (filepath.endsWith(".codex/hooks.json")) {
    return mergeCodexPreserve(existing, generated, previousGenerated);
  }
  return generated;
}

interface OwnershipRecord {
  version: 1;
  platform: string;
  target: string;
  generatedAt: string;
  content: unknown;
}

async function readJsonIfPresent(cwd: string, filepath: string): Promise<unknown | undefined> {
  await assertSafeTarget(cwd, filepath);
  const file = Bun.file(filepath);
  if (!(await file.exists())) return undefined;
  return JSON.parse(await file.text()) as unknown;
}

export async function rebuildFromLockfile(lockfile: UhrLockfile, cwd: string, options?: RebuildOptions): Promise<RebuildResult> {
  const adapters = builtInAdapters().filter((adapter) => lockfile.platforms.includes(adapter.id));
  const outputs = adapters.map((adapter) => ({
    adapterId: adapter.id,
    ...adapter.generate(lockfile, cwd),
  }));

  for (const output of outputs) {
    await assertSafeTarget(cwd, output.filepath);
    if (output.adapterId === "codex") {
      await assertSafeTarget(cwd, ownershipPathForPlatform(cwd, "codex"));
    }
  }

  // Backup existing config files before writing
  await createBackup(cwd, outputs.flatMap((output) => output.adapterId === "codex"
    ? [output.filepath, ownershipPathForPlatform(cwd, "codex")]
    : [output.filepath]), options?.trigger ?? "rebuild");

  const writtenFiles: string[] = [];
  const warnings: AdapterWarning[] = [];

  for (const output of outputs) {
    let contentToWrite: unknown = output.content;
    let previousGenerated: unknown | undefined;

    if (output.adapterId === "codex") {
      const ownership = await readJsonIfPresent(cwd, ownershipPathForPlatform(cwd, "codex")) as OwnershipRecord | undefined;
      if (ownership?.version === 1 && ownership.platform === "codex" && ownership.target === path.relative(cwd, output.filepath)) {
        previousGenerated = ownership.content;
      }
    }

    if (lockfile.mergeMode === "preserve") {
      const existing = await readJsonIfPresent(cwd, output.filepath);
      if (existing !== undefined) {
        try {
          contentToWrite = mergePreserve(existing, output.content, output.filepath, previousGenerated);
        } catch {
          warnings.push({ hookId: `merge:${output.adapterId}`, message: `Preserve merge skipped due to invalid JSON in ${output.filepath}` });
        }
      }
    }

    await atomicWriteFile(cwd, output.filepath, JSON.stringify(contentToWrite, null, 2) + "\n");
    if (output.adapterId === "codex") {
      const ownership: OwnershipRecord = {
        version: 1,
        platform: "codex",
        target: path.relative(cwd, output.filepath),
        generatedAt: lockfile.generatedAt,
        content: output.content
      };
      await atomicWriteFile(cwd, ownershipPathForPlatform(cwd, "codex"), JSON.stringify(ownership, null, 2) + "\n");
    }
    writtenFiles.push(output.filepath);
    warnings.push(...output.warnings);
  }

  return { writtenFiles, warnings };
}
