function parsePermissionPattern(input: string): { tool: string; body: string } | null {
  const start = input.indexOf("(");
  const end = input.lastIndexOf(")");
  if (start <= 0 || end <= start) {
    return null;
  }
  const tool = input.slice(0, start).trim();
  const body = input.slice(start + 1, end).trim();
  if (!tool || !body) {
    return null;
  }
  return { tool, body };
}

function normalizeBody(body: string): { prefix: string; wildcard: boolean } {
  if (body === "*") {
    return { prefix: "", wildcard: true };
  }
  if (body.endsWith("*")) {
    return { prefix: body.slice(0, -1).trim(), wildcard: true };
  }
  return { prefix: body, wildcard: false };
}

export function permissionPatternsOverlap(a: string, b: string): boolean {
  const parsedA = parsePermissionPattern(a);
  const parsedB = parsePermissionPattern(b);

  if (!parsedA || !parsedB) {
    return a === b;
  }

  if (parsedA.tool !== parsedB.tool) {
    return false;
  }

  const bodyA = normalizeBody(parsedA.body);
  const bodyB = normalizeBody(parsedB.body);

  if (bodyA.wildcard && bodyB.wildcard) {
    return bodyA.prefix.startsWith(bodyB.prefix) || bodyB.prefix.startsWith(bodyA.prefix);
  }
  if (bodyA.wildcard) {
    return bodyB.prefix.startsWith(bodyA.prefix);
  }
  if (bodyB.wildcard) {
    return bodyA.prefix.startsWith(bodyB.prefix);
  }
  return bodyA.prefix === bodyB.prefix;
}

export function toolsOverlap(a?: string[], b?: string[]): boolean {
  const left = a && a.length > 0 ? new Set(a) : new Set(["*"]);
  const right = b && b.length > 0 ? new Set(b) : new Set(["*"]);

  if (left.has("*") || right.has("*")) {
    return true;
  }

  for (const tool of left) {
    if (right.has(tool)) {
      return true;
    }
  }

  return false;
}
