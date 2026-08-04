import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InvalidCaptureError, interpretCapture } from '@duckworth/item-capture';
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
  clock?: () => Date;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerOpenApi(app);
  const databasePath = options.databasePath ?? process.env.SQLITE_PATH ?? './data/duckworth.sqlite';
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  const items = new ShoppingItemRepository(database, options.clock);
  const eventHub = options.eventHub ?? new HouseholdEventHub();
  app.addSchema({
    $id: 'ShoppingItem',
    type: 'object',
    properties: {
      id: { type: 'string' }, householdId: { type: 'string' }, captureText: { type: 'string' },
      name: { type: 'string' },
      quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      unitSource: { anyOf: [{ type: 'string', enum: ['explicit', 'history'] }, { type: 'null' }] },
      unitConfirmedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      attentionReasons: { type: 'array', items: { type: 'string', enum: ['missing_quantity', 'unconfirmed_historical_unit'] } },
      status: { type: 'string', enum: ['active', 'purchased'] },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' }, version: { type: 'integer' },
    },
    required: ['id', 'householdId', 'captureText', 'name', 'quantity', 'unit', 'unitSource',
      'unitConfirmedAt', 'attentionReasons', 'status', 'createdAt', 'updatedAt', 'version'],
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

  app.post<{ Params: { householdId: string }; Body: { input?: string; name?: string; confirmedUnit?: string } }>(
    '/api/v1/households/:householdId/items',
    { schema: { tags: ['shopping'], body: { type: 'object', properties: { input: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, confirmedUnit: { type: 'string', minLength: 1, maxLength: 32 } }, oneOf: [{ required: ['input'], not: { required: ['name'] } }, { required: ['name'], not: { required: ['input'] } }] }, response: { 201: { $ref: 'ShoppingItem#' } } } },
    async (request, reply) => {
      const { input, name, confirmedUnit } = request.body ?? {};
      if ((input === undefined) === (name === undefined)) {
        return reply.code(400).send({ error: 'invalid_item_name' });
      }
      if (confirmedUnit !== undefined
        && (typeof confirmedUnit !== 'string' || confirmedUnit.trim().length === 0 || confirmedUnit.trim().length > 32)) {
        return reply.code(400).send({ error: 'invalid_item_unit' });
      }

      try {
        const item = items.create(request.params.householdId, interpretCapture(input ?? name ?? ''), confirmedUnit);
        eventHub.publish(request.params.householdId, { action: 'created', item });
        return reply.code(201).send(item);
      } catch (error) {
        if (error instanceof InvalidCaptureError) {
          return reply.code(400).send({ error: 'invalid_item_name' });
        }
        if (error instanceof DuplicateShoppingItemError) {
          return reply.code(409).send({ error: 'duplicate_item', existingItemId: error.existingItemId });
        }
        throw error;
      }
    },
  );

  app.patch<{
    Params: { householdId: string; itemId: string };
    Body: {
      name?: string;
      status?: ShoppingItemStatus;
      quantity?: number | null;
      confirmedUnit?: string | null;
      expectedVersion?: number;
    };
  }>('/api/v1/households/:householdId/items/:itemId', { schema: { tags: ['shopping'], body: { type: 'object', required: ['expectedVersion'], properties: { name: { type: 'string' }, status: { type: 'string', enum: ['active', 'purchased'] }, quantity: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'null' }] }, confirmedUnit: { anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }] }, expectedVersion: { type: 'integer', minimum: 1 } } }, response: { 200: { $ref: 'ShoppingItem#' } } } }, async (request, reply) => {
    const body = request.body ?? {};
    const { name, status, quantity, confirmedUnit, expectedVersion } = body;
    const hasQuantity = Object.prototype.hasOwnProperty.call(body, 'quantity');
    const hasConfirmedUnit = Object.prototype.hasOwnProperty.call(body, 'confirmedUnit');
    if ((name === undefined && status === undefined && !hasQuantity && !hasConfirmedUnit)
      || (name !== undefined && (typeof name !== 'string' || name.trim().length === 0))) {
      return reply.code(400).send({ error: 'invalid_item_update' });
    }
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return reply.code(400).send({ error: 'expected_version_required' });
    }
    const version = expectedVersion as number;
    if (status !== undefined && status !== 'active' && status !== 'purchased') {
      return reply.code(400).send({ error: 'invalid_item_status' });
    }
    if (hasQuantity && quantity !== null
      && (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0)) {
      return reply.code(400).send({ error: 'invalid_item_quantity' });
    }
    if (hasConfirmedUnit && confirmedUnit !== null
      && (typeof confirmedUnit !== 'string' || confirmedUnit.trim().length === 0 || confirmedUnit.trim().length > 32)) {
      return reply.code(400).send({ error: 'invalid_item_unit' });
    }
    try {
      const patch: {
        name?: string;
        status?: ShoppingItemStatus;
        quantity?: number | null;
        confirmedUnit?: string | null;
      } = { name, status };
      if (hasQuantity) patch.quantity = quantity ?? null;
      if (hasConfirmedUnit) patch.confirmedUnit = confirmedUnit ?? null;
      const item = items.update(request.params.householdId, request.params.itemId, patch, version);
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
