export function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }

  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export type CommunityPartition = {
  temporaryId: string;
  nodeIds: string[];
};

export type StabilizedCommunity = {
  id: string;
  nodeIds: string[];
  isNew: boolean;
};

/**
 * Match new Louvain partitions to previous stable community IDs via
 * Jaccard overlap so colors/positions do not randomly reshuffle.
 */
export function stabilizeCommunities(
  previous: Array<{ id: string; nodeIds: string[] }>,
  nextPartitions: CommunityPartition[],
  matchThreshold: number,
  createId: () => string,
): {
  communities: StabilizedCommunity[];
  retiredIds: string[];
} {
  const previousSets = previous.map((community) => ({
    id: community.id,
    set: new Set(community.nodeIds),
  }));

  const nextSets = nextPartitions.map((partition) => ({
    temporaryId: partition.temporaryId,
    nodeIds: partition.nodeIds,
    set: new Set(partition.nodeIds),
  }));

  const pairs: Array<{
    prevIndex: number;
    nextIndex: number;
    score: number;
  }> = [];

  for (let prevIndex = 0; prevIndex < previousSets.length; prevIndex += 1) {
    for (let nextIndex = 0; nextIndex < nextSets.length; nextIndex += 1) {
      const score = jaccard(
        previousSets[prevIndex]!.set,
        nextSets[nextIndex]!.set,
      );
      if (score >= matchThreshold) {
        pairs.push({ prevIndex, nextIndex, score });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);

  const usedPrev = new Set<number>();
  const usedNext = new Set<number>();
  const matched = new Map<number, string>();

  for (const pair of pairs) {
    if (usedPrev.has(pair.prevIndex) || usedNext.has(pair.nextIndex)) {
      continue;
    }
    usedPrev.add(pair.prevIndex);
    usedNext.add(pair.nextIndex);
    matched.set(pair.nextIndex, previousSets[pair.prevIndex]!.id);
  }

  const communities: StabilizedCommunity[] = nextSets.map((partition, index) => {
    const existingId = matched.get(index);
    if (existingId) {
      return {
        id: existingId,
        nodeIds: partition.nodeIds,
        isNew: false,
      };
    }

    return {
      id: createId(),
      nodeIds: partition.nodeIds,
      isNew: true,
    };
  });

  const retiredIds = previous
    .filter((_, index) => !usedPrev.has(index))
    .map((community) => community.id);

  return { communities, retiredIds };
}
