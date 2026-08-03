import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HouseholdEventHub } from './event-hub.js';
import { registerOpenApi } from './openapi.js';
import {
  DuplicateShoppingItemError,
  ItemVersionConflictError,
  ShoppingItemRepository,
  type ShoppingItemStatus,
} from './shopping-items.js';

export interface BuildAppOptions {
  databasePath?: string;
  eventHub?: HouseholdEventHub;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerOpenApi(app);
  const databasePath = options.databasePath ?? process.env.SQLITE_PATH ?? './data/duckworth.sqlite';
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  const items = new ShoppingItemRepository(database);
  const eventHub = options.eventHub ?? new HouseholdEventHub();
  app.addSchema({
    $id: 'ShoppingItem',
    type: 'object',
    properties: {
      id: { type: 'string' }, householdId: { type: 'string' }, name: { type: 'string' },
      status: { type: 'string', enum: ['active', 'purchased'] },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' }, version: { type: 'integer' },
    },
    required: ['id', 'householdId', 'name', 'status', 'createdAt', 'updatedAt', 'version'],
  });

  app.get('/health', { schema: { tags: ['health'], response: { 200: { type: 'object', properties: { status: { type: 'string', const: 'ok' } }, required: ['status'] } } } }, async () => ({ status: 'ok' }));

  app.get<{ Params: { householdId: string }; Querystring: { includePurchased?: boolean } }>(
    '/api/v1/households/:householdId/items',
    { schema: { tags: ['shopping'], querystring: { type: 'object', properties: { includePurchased: { type: 'boolean' } } }, response: { 200: { type: 'array', items: { $ref: 'ShoppingItem#' } } } } },
    async (request) => items.listActive(request.params.householdId, request.query.includePurchased === true),
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/events',
    { schema: { tags: ['events'], response: { 200: { type: 'string' } } } },
    async (request, reply) => {
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      const unsubscribe = eventHub.subscribe(request.params.householdId, (event) => {
        response.write(`event: shopping-item.changed\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
      const cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
      };
      request.raw.once('close', cleanup);
    },
  );

  app.post<{ Params: { householdId: string }; Body: { name?: string } }>(
    '/api/v1/households/:householdId/items',
    { schema: { tags: ['shopping'], body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } }, response: { 201: { $ref: 'ShoppingItem#' } } } },
    async (request, reply) => {
      const name = request.body?.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({ error: 'invalid_item_name' });
      }

      try {
        const item = items.create(request.params.householdId, name);
        eventHub.publish(request.params.householdId, { action: 'created', item });
        return reply.code(201).send(item);
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
    Body: { name?: string; status?: ShoppingItemStatus; expectedVersion?: number };
  }>('/api/v1/households/:householdId/items/:itemId', { schema: { tags: ['shopping'], body: { type: 'object', required: ['expectedVersion'], properties: { name: { type: 'string' }, status: { type: 'string', enum: ['active', 'purchased'] }, expectedVersion: { type: 'integer', minimum: 1 } } }, response: { 200: { $ref: 'ShoppingItem#' } } } }, async (request, reply) => {
    const { name, status, expectedVersion } = request.body ?? {};
    if ((name === undefined && status === undefined) || (name !== undefined && (typeof name !== 'string' || name.trim().length === 0))) {
      return reply.code(400).send({ error: 'invalid_item_update' });
    }
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return reply.code(400).send({ error: 'expected_version_required' });
    }
    const version = expectedVersion as number;
    if (status !== undefined && status !== 'active' && status !== 'purchased') {
      return reply.code(400).send({ error: 'invalid_item_status' });
    }
    try {
      const item = items.update(request.params.householdId, request.params.itemId, { name, status }, version);
      if (!item) return reply.code(404).send({ error: 'item_not_found' });
      eventHub.publish(request.params.householdId, { action: 'updated', item });
      return reply.send(item);
    } catch (error) {
      if (error instanceof DuplicateShoppingItemError) {
        return reply.code(409).send({ error: 'duplicate_item', existingItemId: error.existingItemId });
      }
      if (error instanceof ItemVersionConflictError) {
        return reply.code(409).send({ error: 'item_version_conflict', currentItem: error.currentItem });
      }
      throw error;
    }
  });

  app.addHook('onClose', async () => items.close());

  return app;
}
