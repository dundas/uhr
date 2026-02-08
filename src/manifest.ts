import path from "node:path";
import { readFile } from "node:fs/promises";
import type { HookDeclaration, ServiceManifest, UniversalEvent } from "./types";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNIVERSAL_EVENTS: Set<UniversalEvent> = new Set([
  "sessionStart",
  "sessionEnd",
  "beforeToolExecution",
  "afterToolExecution",
  "beforePromptSubmit",
  "afterModelResponse",
  "beforeFileRead",
  "beforeMcpExecution",
  "permissionRequest",
  "notification",
  "stop",
  "subagentStop",
  "beforeCompact",
  "beforeToolSelection"
]);

export interface ManifestLoadResult {
  filepath: string;
  content: string;
  manifest: ServiceManifest;
}

function asObject(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function asString(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return input;
}

function asStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return input;
}

function validateHook(raw: unknown, index: number): HookDeclaration {
  const hook = asObject(raw, `hooks[${index}]`);

  const id = asString(hook.id, `hooks[${index}].id`);
  const on = asString(hook.on, `hooks[${index}].on`) as UniversalEvent;
  const command = asString(hook.command, `hooks[${index}].command`);

  if (!UNIVERSAL_EVENTS.has(on)) {
    throw new Error(`hooks[${index}].on has unsupported event: ${on}`);
  }

  const tools = hook.tools === undefined ? undefined : asStringArray(hook.tools, `hooks[${index}].tools`);
  const platforms =
    hook.platforms === undefined ? undefined : asStringArray(hook.platforms, `hooks[${index}].platforms`) as HookDeclaration["platforms"];

  const blocking = hook.blocking === undefined ? undefined : Boolean(hook.blocking);
  const background = hook.background === undefined ? undefined : Boolean(hook.background);
  const timeout = hook.timeout === undefined ? undefined : Number(hook.timeout);

  if (Number.isNaN(timeout ?? 0) || (timeout !== undefined && timeout <= 0)) {
    throw new Error(`hooks[${index}].timeout must be a positive number`);
  }

  if (blocking && background) {
    throw new Error(`hooks[${index}] cannot be both blocking and background`);
  }

  return {
    id,
    on,
    command,
    tools,
    blocking,
    timeout,
    background,
    platforms
  };
}

export function validateManifest(input: unknown): ServiceManifest {
  const root = asObject(input, "manifest");

  const name = asString(root.name, "name");
  if (!NAME_PATTERN.test(name)) {
    throw new Error("name must be lowercase and hyphen-separated");
  }

  const version = asString(root.version, "version");

  if (!Array.isArray(root.hooks)) {
    throw new Error("hooks must be an array");
  }

  const hooks = root.hooks.map((hook, index) => validateHook(hook, index));
  const hookIds = new Set<string>();
  for (const hook of hooks) {
    if (hookIds.has(hook.id)) {
      throw new Error(`duplicate hook id: ${hook.id}`);
    }
    hookIds.add(hook.id);
  }

  const manifest: ServiceManifest = {
    name,
    version,
    hooks
  };

  if (typeof root.$schema === "string") {
    manifest.$schema = root.$schema;
  }
  if (typeof root.description === "string") {
    manifest.description = root.description;
  }
  if (typeof root.homepage === "string") {
    manifest.homepage = root.homepage;
  }

  if (root.permissions !== undefined) {
    const permissions = asObject(root.permissions, "permissions");
    manifest.permissions = {
      allow: permissions.allow === undefined ? [] : asStringArray(permissions.allow, "permissions.allow"),
      deny: permissions.deny === undefined ? [] : asStringArray(permissions.deny, "permissions.deny")
    };
  }

  if (root.requires !== undefined) {
    manifest.requires = asStringArray(root.requires, "requires");
  }
  if (root.conflicts !== undefined) {
    manifest.conflicts = asStringArray(root.conflicts, "conflicts");
  }

  if (root.ordering !== undefined) {
    const orderingRoot = asObject(root.ordering, "ordering");
    const ordering: NonNullable<ServiceManifest["ordering"]> = {};

    for (const [hookId, rawConstraint] of Object.entries(orderingRoot)) {
      const constraintObj = asObject(rawConstraint, `ordering.${hookId}`);
      const runAfter =
        constraintObj.runAfter === undefined
          ? undefined
          : asStringArray(constraintObj.runAfter, `ordering.${hookId}.runAfter`);
      const runBefore =
        constraintObj.runBefore === undefined
          ? undefined
          : asStringArray(constraintObj.runBefore, `ordering.${hookId}.runBefore`);
      ordering[hookId] = { runAfter, runBefore };
    }

    manifest.ordering = ordering;
  }

  if (root.meta !== undefined) {
    const meta = asObject(root.meta, "meta");
    manifest.meta = {
      minUhrVersion: typeof meta.minUhrVersion === "string" ? meta.minUhrVersion : undefined,
      license: typeof meta.license === "string" ? meta.license : undefined
    };
  }

  return manifest;
}

export async function loadManifest(manifestPath: string, cwd: string): Promise<ManifestLoadResult> {
  const filepath = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(cwd, manifestPath);
  const content = await readFile(filepath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  const manifest = validateManifest(parsed);

  return { filepath, content, manifest };
}
