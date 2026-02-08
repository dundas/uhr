import { mkdir } from "node:fs/promises";
import path from "node:path";
import { builtInAdapters } from "./adapters";
import type { AdapterWarning } from "./adapters/types";
import { createBackup } from "./backup";
import type { UhrLockfile } from "./types";

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

function mergePreserve(existing: unknown, generated: unknown, filepath: string): unknown {
  if (filepath.endsWith(".claude/settings.json")) {
    return mergeClaudePreserve(existing, generated);
  }
  if (filepath.endsWith(".cursor/hooks.json")) {
    return mergeCursorPreserve(existing, generated);
  }
  if (filepath.endsWith(".gemini/settings.json")) {
    return mergeGeminiPreserve(existing, generated);
  }
  return generated;
}

export async function rebuildFromLockfile(lockfile: UhrLockfile, cwd: string, options?: RebuildOptions): Promise<RebuildResult> {
  const adapters = builtInAdapters().filter((adapter) => lockfile.platforms.includes(adapter.id));
  const outputs = adapters.map((adapter) => ({
    adapterId: adapter.id,
    ...adapter.generate(lockfile, cwd),
  }));

  // Backup existing config files before writing
  await createBackup(cwd, outputs.map((o) => o.filepath), options?.trigger ?? "rebuild");

  const writtenFiles: string[] = [];
  const warnings: AdapterWarning[] = [];

  for (const output of outputs) {
    await mkdir(path.dirname(output.filepath), { recursive: true });

    let contentToWrite: unknown = output.content;

    if (lockfile.mergeMode === "preserve") {
      const existingFile = Bun.file(output.filepath);
      if (await existingFile.exists()) {
        try {
          const existingParsed = JSON.parse(await existingFile.text()) as unknown;
          contentToWrite = mergePreserve(existingParsed, output.content, output.filepath);
        } catch {
          warnings.push({ hookId: `merge:${output.adapterId}`, message: `Preserve merge skipped due to invalid JSON in ${output.filepath}` });
        }
      }
    }

    await Bun.write(output.filepath, JSON.stringify(contentToWrite, null, 2) + "\n");
    writtenFiles.push(output.filepath);
    warnings.push(...output.warnings);
  }

  return { writtenFiles, warnings };
}
