export interface OrderingGraph {
  [node: string]: string[];
}

export function topologicalSort(graph: OrderingGraph): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const [node, edges] of Object.entries(graph)) {
    if (!inDegree.has(node)) {
      inDegree.set(node, 0);
    }
    adjacency.set(node, edges);

    for (const to of edges) {
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
      if (!adjacency.has(to)) {
        adjacency.set(to, []);
      }
    }
  }

  const queue: string[] = [];
  for (const [node, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    result.push(node);

    for (const next of adjacency.get(node) ?? []) {
      const nextDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (result.length !== inDegree.size) {
    throw new Error("Circular ordering detected");
  }

  return result;
}
