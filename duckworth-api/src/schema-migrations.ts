import type { DatabaseSync } from 'node:sqlite';
import type { SemanticRuntime } from '@duckworth/shopping-intelligence';
import { BrainCaptureStore } from './brain-captures.js';
import { ConversationContextRepository } from './conversation-contexts.js';
import { ShoppingItemRepository } from './shopping-items.js';

/**
 * Applies the repository schema migrations in one explicitly ordered step.
 * Runtime repositories are subsequently constructed with manageSchema:false,
 * so request handling cannot mutate the schema as a side effect of startup.
 */
export function prepareSchema(
  database: DatabaseSync,
  semanticRuntime: SemanticRuntime,
  clock: () => Date = () => new Date(),
): void {
  new ShoppingItemRepository(database, semanticRuntime, clock);
  new BrainCaptureStore(database, clock);
  new ConversationContextRepository(database, clock);
}
