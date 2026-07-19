export interface SemanticNeighbor {
  nodeId: string;
  similarity: number;
}

export interface SemanticIndex {
  updateNode(nodeId: string, embedding: Float32Array): void;
  removeNode(nodeId: string): void;
  getNearestNeighbors(nodeId: string): SemanticNeighbor[];
  clear(): void;
}

/**
 * All-pairs cosine similarity index. Acceptable for initial graph sizes;
 * replaceable via SemanticIndex without changing the graph model.
 */
export class AllPairsSemanticIndex implements SemanticIndex {
  private embeddings = new Map<string, Float32Array>();

  updateNode(nodeId: string, embedding: Float32Array): void {
    this.embeddings.set(nodeId, embedding);
  }

  removeNode(nodeId: string): void {
    this.embeddings.delete(nodeId);
  }

  getNearestNeighbors(nodeId: string): SemanticNeighbor[] {
    const source = this.embeddings.get(nodeId);
    if (!source) {
      return [];
    }

    const neighbors: SemanticNeighbor[] = [];

    for (const [otherId, otherEmbedding] of this.embeddings) {
      if (otherId === nodeId) {
        continue;
      }

      let similarity = 0;
      const length = Math.min(source.length, otherEmbedding.length);
      for (let i = 0; i < length; i += 1) {
        similarity += source[i]! * otherEmbedding[i]!;
      }

      neighbors.push({
        nodeId: otherId,
        similarity: Math.max(0, similarity),
      });
    }

    neighbors.sort((a, b) => b.similarity - a.similarity);
    return neighbors;
  }

  clear(): void {
    this.embeddings.clear();
  }
}

export function filterSemanticNeighbors(
  neighbors: SemanticNeighbor[],
  minimumSimilarity: number,
): SemanticNeighbor[] {
  return neighbors.filter(
    (neighbor) => neighbor.similarity >= minimumSimilarity,
  );
}
