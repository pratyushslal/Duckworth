import type { SemanticItem } from './contracts.js';

export const SEMANTIC_SNAPSHOT_VERSION = 4 as const;

/** Purely derives the current semantic projection; the persisted source snapshot is untouched. */
export function upcastSemanticItem(input: SemanticItem): SemanticItem {
  if (input.semanticVersion === SEMANTIC_SNAPSHOT_VERSION) return input;
  return {
    ...input,
    semanticVersion: SEMANTIC_SNAPSHOT_VERSION,
    descriptorMentions: input.descriptorMentions ?? [],
    measures: input.measures ?? [],
    packaging: input.packaging ?? [],
  };
}
