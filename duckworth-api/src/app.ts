import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DuplicateShoppingItemError,
  ShoppingItemRepository,
  type ShoppingItemStatus,
} from './shopping-items.js';

export interface BuildAppOptions {
  databasePath?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const databasePath = options.databasePath ?? process.env.SQLITE_PATH ?? './data/duckworth.sqlite';
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  const items = new ShoppingItemRepository(database);

  app.get('/health', async () => ({ status: 'ok' }));

  app.get<{ Params: { householdId: string } }>(
    '/api/households/:householdId/items',
    async (request) => items.listActive(request.params.householdId),
  );

  app.post<{ Params: { householdId: string }; Body: { name?: string } }>(
    '/api/households/:householdId/items',
    async (request, reply) => {
      const name = request.body?.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({ error: 'invalid_item_name' });
      }

      try {
        return reply.code(201).send(items.create(request.params.householdId, name));
      } catch (error) {
        if (error instanceof DuplicateShoppingItemError) {
          return reply.code(409).send({ error: 'duplicate_item', existingItemId: error.existingItemId });
        }
        throw error;
      }
    },
  );

  app.patch<{
    Params: { householdId: string; itemId: string };
    Body: { status?: ShoppingItemStatus };
  }>('/api/households/:householdId/items/:itemId', async (request, reply) => {
    const status = request.body?.status;
    if (status !== 'active' && status !== 'purchased') {
      return reply.code(400).send({ error: 'invalid_item_status' });
    }
    const item = items.updateStatus(request.params.householdId, request.params.itemId, status);
    if (!item) return reply.code(404).send({ error: 'item_not_found' });
    return reply.send(item);
  });

  app.addHook('onClose', async () => items.close());

  return app;
}
