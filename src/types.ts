export type PlatformId = "claude-code" | "cursor" | "gemini-cli";

export type UniversalEvent =
  | "sessionStart"
  | "sessionEnd"
  | "beforeToolExecution"
  | "afterToolExecution"
  | "beforePromptSubmit"
  | "afterModelResponse"
  | "beforeFileRead"
  | "beforeMcpExecution"
  | "permissionRequest"
  | "notification"
  | "stop"
  | "subagentStop"
  | "beforeCompact"
  | "beforeToolSelection";

export interface HookDeclaration {
  id: string;
  on: UniversalEvent;
  command: string;
  tools?: string[];
  blocking?: boolean;
  timeout?: number;
  background?: boolean;
  platforms?: PlatformId[];
}

export interface OrderingConstraint {
  runAfter?: string[];
  runBefore?: string[];
}

export interface ServiceManifest {
  $schema?: string;
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  hooks: HookDeclaration[];
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  ordering?: Record<string, OrderingConstraint>;
  requires?: string[];
  conflicts?: string[];
  meta?: {
    minUhrVersion?: string;
    license?: string;
  };
}

export interface InstalledService {
  version: string;
  installedAt: string;
  integrity: string;
  source: string;
  hooks: HookDeclaration[];
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  ordering?: Record<string, OrderingConstraint>;
  requires?: string[];
  conflicts?: string[];
}

export interface UhrLockfile {
  lockfileVersion: 1;
  generatedAt: string;
  generatedBy: string;
  platforms: PlatformId[];
  installed: Record<string, InstalledService>;
  resolvedOrder: Record<string, string[]>;
}

export interface Conflict {
  type:
    | "explicit"
    | "missing_requirement"
    | "permission_contradiction"
    | "duplicate_hook"
    | "shared_slot"
    | "circular_ordering"
    | "platform_gap";
  severity: "error" | "warning" | "info";
  message: string;
}
