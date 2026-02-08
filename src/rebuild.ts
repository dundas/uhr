import { mkdir } from "node:fs/promises";
import path from "node:path";
import { builtInAdapters } from "./adapters";
import type { AdapterWarning } from "./adapters/types";
import type { UhrLockfile } from "./types";

export interface RebuildResult {
  writtenFiles: string[];
  warnings: AdapterWarning[];
}

export async function rebuildFromLockfile(lockfile: UhrLockfile, cwd: string): Promise<RebuildResult> {
  const adapters = builtInAdapters().filter((adapter) => lockfile.platforms.includes(adapter.id));

  const writtenFiles: string[] = [];
  const warnings: AdapterWarning[] = [];

  for (const adapter of adapters) {
    const output = adapter.generate(lockfile, cwd);
    await mkdir(path.dirname(output.filepath), { recursive: true });
    await Bun.write(output.filepath, JSON.stringify(output.content, null, 2) + "\n");
    writtenFiles.push(output.filepath);
    warnings.push(...output.warnings);
  }

  return { writtenFiles, warnings };
}
