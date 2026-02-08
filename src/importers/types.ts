import type { HookDeclaration, PlatformId } from "../types";

export interface ImportedServiceDraft {
  name: string;
  sourcePath: string;
  sourcePlatform: PlatformId;
  hooks: HookDeclaration[];
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

export interface ImportSummary {
  platform: PlatformId;
  found: boolean;
  hooksImported: number;
  serviceName: string;
  sourcePath: string;
  warnings: string[];
}
