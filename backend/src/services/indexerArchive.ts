export interface ArchivedIndexerSkip {
  reason: string;
  engagementId: string;
  partyA: string;
  partyB: string;
  txHash: string | null;
  archivedAt: string;
}

export interface IndexerArchive {
  archive(entry: ArchivedIndexerSkip): void;
  list(): ArchivedIndexerSkip[];
}

export function createIndexerArchive(limit: number = 500): IndexerArchive {
  const entries: ArchivedIndexerSkip[] = [];
  return {
    archive(entry: ArchivedIndexerSkip): void {
      entries.push(entry);
      if (entries.length > limit) {
        entries.splice(0, entries.length - limit);
      }
    },
    list(): ArchivedIndexerSkip[] {
      return entries.slice();
    },
  };
}
