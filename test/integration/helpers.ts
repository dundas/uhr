import path from "node:path";

export function formatterManifest() {
  return {
    name: "test-formatter",
    version: "1.0.0",
    hooks: [{
      id: "format-on-write",
      on: "afterToolExecution",
      tools: ["write", "edit"],
      command: "prettier --write $UHR_FILE"
    }],
    permissions: { allow: ["Bash(prettier *)"] }
  };
}

export function linterManifest() {
  return {
    name: "test-linter",
    version: "1.0.0",
    hooks: [{
      id: "lint-check",
      on: "beforeToolExecution",
      tools: ["bash"],
      command: "eslint --check"
    }]
  };
}

export function securityManifest() {
  return {
    name: "test-security",
    version: "1.0.0",
    hooks: [{
      id: "security-scan",
      on: "beforeToolExecution",
      tools: ["bash"],
      command: "snyk test"
    }],
    ordering: {
      "security-scan": {
        runAfter: ["test-linter/lint-check"]
      }
    }
  };
}

export async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<string> {
  const filePath = path.join(dir, `${manifest.name}.json`);
  await Bun.write(filePath, JSON.stringify(manifest, null, 2));
  return filePath;
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const content = await Bun.file(filePath).text();
  return JSON.parse(content);
}
