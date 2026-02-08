import type { PlatformId, UhrLockfile } from "../types";

export interface AdapterWarning {
  hookId: string;
  message: string;
}

export interface AdapterOutput {
  filepath: string;
  content: unknown;
  warnings: AdapterWarning[];
}

export interface Adapter {
  id: PlatformId;
  name: string;
  detect(): boolean;
  generate(lockfile: UhrLockfile, cwd: string): AdapterOutput;
}
