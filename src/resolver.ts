import type { InstalledService, OrderingConstraint, UhrLockfile } from "./types";

interface HookNode {
  ref: string;
  serviceName: string;
  hookId: string;
  event: string;
  installedAt: string;
}

function normalizeRef(serviceName: string, rawRef: string): string {
  if (rawRef.includes("/")) {
    return rawRef;
  }
  return `${serviceName}/${rawRef}`;
}

function buildNodeMap(services: Record<string, InstalledService>): Map<string, HookNode> {
  const map = new Map<string, HookNode>();

  for (const [serviceName, service] of Object.entries(services)) {
    for (const hook of service.hooks) {
      const ref = `${serviceName}/${hook.id}`;
      map.set(ref, {
        ref,
        serviceName,
        hookId: hook.id,
        event: hook.on,
        installedAt: service.installedAt
      });
    }
  }

  return map;
}

function sortQueue(queue: string[], nodes: Map<string, HookNode>): void {
  queue.sort((a, b) => {
    const nodeA = nodes.get(a);
    const nodeB = nodes.get(b);

    const timeA = nodeA ? new Date(nodeA.installedAt).getTime() : 0;
    const timeB = nodeB ? new Date(nodeB.installedAt).getTime() : 0;

    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.localeCompare(b);
  });
}

function applyConstraintEdges(
  serviceName: string,
  hookRef: string,
  hookEvent: string,
  constraints: OrderingConstraint | undefined,
  allNodes: Map<string, HookNode>,
  edges: Map<string, Set<string>>,
  indegree: Map<string, number>
): void {
  if (!constraints) {
    return;
  }

  const sameEventRefs = Array.from(allNodes.values())
    .filter((node) => node.event === hookEvent)
    .map((node) => node.ref);

  const runAfter = constraints.runAfter ?? [];
  for (const rawRef of runAfter) {
    const refs = rawRef === "*" ? sameEventRefs : [normalizeRef(serviceName, rawRef)];
    for (const ref of refs) {
      if (ref === hookRef || !allNodes.has(ref)) {
        continue;
      }
      if (allNodes.get(ref)?.event !== hookEvent) {
        continue;
      }
      if (!edges.get(ref)?.has(hookRef)) {
        edges.get(ref)?.add(hookRef);
        indegree.set(hookRef, (indegree.get(hookRef) ?? 0) + 1);
      }
    }
  }

  const runBefore = constraints.runBefore ?? [];
  for (const rawRef of runBefore) {
    const refs = rawRef === "*" ? sameEventRefs : [normalizeRef(serviceName, rawRef)];
    for (const ref of refs) {
      if (ref === hookRef || !allNodes.has(ref)) {
        continue;
      }
      if (allNodes.get(ref)?.event !== hookEvent) {
        continue;
      }
      if (!edges.get(hookRef)?.has(ref)) {
        edges.get(hookRef)?.add(ref);
        indegree.set(ref, (indegree.get(ref) ?? 0) + 1);
      }
    }
  }
}

function resolveEventOrder(event: string, services: Record<string, InstalledService>, allNodes: Map<string, HookNode>): string[] {
  const eventNodes = Array.from(allNodes.values()).filter((node) => node.event === event);
  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const node of eventNodes) {
    edges.set(node.ref, new Set<string>());
    indegree.set(node.ref, 0);
  }

  for (const node of eventNodes) {
    const service = services[node.serviceName];
    const constraints = service.ordering?.[node.hookId];
    applyConstraintEdges(node.serviceName, node.ref, node.event, constraints, allNodes, edges, indegree);
  }

  const queue = Array.from(indegree.entries())
    .filter(([, value]) => value === 0)
    .map(([ref]) => ref);
  sortQueue(queue, allNodes);

  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    ordered.push(current);

    for (const next of edges.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }

    sortQueue(queue, allNodes);
  }

  if (ordered.length !== eventNodes.length) {
    throw new Error(`Circular ordering detected for event: ${event}`);
  }

  return ordered;
}

export function resolveFromInstalled(services: Record<string, InstalledService>): Record<string, string[]> {
  const allNodes = buildNodeMap(services);
  const events = new Set(Array.from(allNodes.values()).map((node) => node.event));

  const resolvedOrder: Record<string, string[]> = {};
  for (const event of events) {
    resolvedOrder[event] = resolveEventOrder(event, services, allNodes);
  }

  return resolvedOrder;
}

export function applyResolvedOrder(lockfile: UhrLockfile): UhrLockfile {
  return {
    ...lockfile,
    resolvedOrder: resolveFromInstalled(lockfile.installed),
    generatedAt: new Date().toISOString()
  };
}
