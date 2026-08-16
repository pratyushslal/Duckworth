import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InvalidCaptureError } from '@duckworth/item-capture';
import {
  decideConversationLifecycle,
  compileLearningOverlay,
  compileTypedLearningOverlay,
  compileSemanticRuntime,
  enrichItemIntent,
  identifyBrand,
  ItemCorrectionConflictError,
  InvalidItemTransitionError,
  reconcileItemCorrection,
  resolveFollowUp,
  runShoppingBrain,
  validateBrainCaptureEnvelope,
  validateSemanticCorrectionCommand,
  type BrainCaptureEnvelope,
  type BrainOperation,
  type BrainOutputFacts,
  type BrainResult,
  type CaptureSource,
  type SemanticRuntime,
  type ValidatedSemanticLayer,
} from '@duckworth/shopping-intelligence';
import { HouseholdEventHub } from './event-hub.js';
import { registerLanguagePackRoutes } from './language-packs.js';
import { registerOpenApi } from './openapi.js';
import { RegionalProductCatalog } from './regional-product-packs.js';
import {
  ConversationContextAccessError,
  ConversationContextHandoffAlreadyClaimedError,
  ConversationContextHandoffExpiredError,
  ConversationContextHandoffNotFoundError,
  ConversationContextNotFoundError,
  ConversationContextRepository,
} from './conversation-contexts.js';
import {
  DuplicateShoppingItemError,
  EmptyShoppingListArchiveError,
  ItemVersionConflictError,
  ShoppingListArchiveNotFoundError,
  ShoppingListNotFoundError,
  ShoppingItemEventAlreadyUndoneError,
  ShoppingItemEventNotFoundError,
  ShoppingItemEventNotUndoableError,
  ShoppingItemRepository,
  SemanticCorrectionIdempotencyConflictError,
  type ShoppingItemStatus,
} from './shopping-items.js';
import { loadSemanticRuntimeSelection } from './semantic-runtime-loader.js';
import type { SemanticRuntimeRegistry } from './semantic-runtime-registry.js';
import { BrainCaptureStore, type StoredBrainCapture } from './brain-captures.js';
import { interpretLegacyConversation, interpretLegacyItem } from './legacy-brain-compat.js';
import type { RuntimeIdentity } from './config.js';
import { prepareSchema } from './schema-migrations.js';
import { CloudAssistClient, CloudAssistProviderError } from './cloud-assist.js';
import { OnlineLookupRegistry, type OnlineLookupProvider } from './online-lookup.js';

export interface BuildAppOptions {
  databasePath?: string;
  runtimeIdentity?: RuntimeIdentity;
  authorization?: { householdId: string; accessToken: string; pairingCode?: string; pairingExpiresAt?: string };
  eventHub?: HouseholdEventHub;
  clock?: () => Date;
  languagePacksPath?: string;
  semanticRuntime?: SemanticRuntime;
  semanticRuntimeRegistry?: SemanticRuntimeRegistry;
  locale?: string;
  countryCode?: string;
  semanticRuntimeLayers?: readonly ValidatedSemanticLayer[];
  captureRetentionDays?: number;
  /** Optional server-side operator secret for entitlement administration. Never sent to browsers. */
  premiumAdminToken?: string;
  cloudAssist?: CloudAssistClient;
  onlineLookup?: OnlineLookupRegistry;
  testControl?: { secret: string; leaseTtlMs?: number };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const cloudAssist = options.cloudAssist ?? new CloudAssistClient({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
  });
  const onlineLookup = options.onlineLookup ?? new OnlineLookupRegistry([{
    id: 'openrouter',
    get available() { return cloudAssist.available; },
    lookup: (request, signal) => cloudAssist.suggest(request.phrase, signal),
  } satisfies OnlineLookupProvider]);
  await registerOpenApi(app);
  const configuredDatabasePath = options.databasePath ?? process.env.SQLITE_PATH;
  if (process.env.NODE_ENV === 'test' && !configuredDatabasePath) {
    throw new Error('Test mode requires an explicit in-memory or temporary database path');
  }
  const databasePath = configuredDatabasePath ?? './data/duckworth.sqlite';
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  const clock = options.clock ?? (() => new Date());
  const schemaVersion = ensureSchemaLedger(database, clock);
  if (options.runtimeIdentity) {
    try {
      ensureRuntimeIdentity(database, options.runtimeIdentity, clock);
    } catch (error) {
      database.close();
      throw error;
    }
  }
  if (options.runtimeIdentity?.lane === 'api-test' && options.testControl) {
    const launchSecret = options.testControl.secret.trim();
    if (!launchSecret) {
      database.close();
      throw new Error('api-test control secret must not be empty');
    }
    const leaseTtlMs = options.testControl.leaseTtlMs ?? 15 * 60 * 1000;
    if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1) {
      database.close();
      throw new Error('api-test lease TTL must be a positive integer');
    }
    let activeLeaseHash: Buffer | undefined;
    let activeLeaseExpiresAt = 0;
    app.addHook('preHandler', async (request, reply) => {
      if (request.url === '/health' || request.url === '/api/v1/test/session') return;
      const lease = singleHeader(request.headers['x-duckworth-test-lease']);
      const valid = lease !== undefined
        && activeLeaseHash !== undefined
        && clock().getTime() < activeLeaseExpiresAt
        && safeSecretEquals(hashSecret(lease), activeLeaseHash);
      if (!valid) return reply.code(403).send({ message: 'A valid api-test lease is required' });
    });
    app.post('/api/v1/test/session', {
      schema: {
        tags: ['health'],
        response: {
          201: {
            type: 'object',
            properties: {
              lane: { type: 'string', const: 'api-test' },
              instanceId: { type: 'string' },
              lease: { type: 'string' },
              expiresAt: { type: 'string' },
            },
            required: ['lane', 'instanceId', 'lease', 'expiresAt'],
          },
          403: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      },
    }, async (request, reply) => {
      const suppliedSecret = singleHeader(request.headers['x-duckworth-test-secret']);
      if (!suppliedSecret || !safeSecretEquals(hashSecret(suppliedSecret), hashSecret(launchSecret))) {
        return reply.code(403).send({ message: 'Invalid api-test launch secret' });
      }
      const lease = randomUUID();
      activeLeaseHash = hashSecret(lease);
      activeLeaseExpiresAt = clock().getTime() + leaseTtlMs;
      return reply.code(201).send({
        lane: 'api-test',
        instanceId: options.runtimeIdentity!.instanceId,
        lease,
        expiresAt: new Date(activeLeaseExpiresAt).toISOString(),
      });
    });
  }
  if (options.authorization) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS duckworth_pairing_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        consumed_at TEXT NOT NULL,
        session_token_hash TEXT
      ) STRICT;
    `);
    app.addHook('preHandler', async (request, reply) => {
      const householdId = (request.params as { householdId?: unknown }).householdId;
      if (typeof householdId !== 'string') return;
      if (householdId !== options.authorization!.householdId) {
        return reply.code(403).send({ error: 'household_access_denied' });
      }
      const cookieToken = parseCookie(request.headers.cookie, 'duckworth_session');
      const presented = request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7)
        : cookieToken;
      if (!presented || !validSessionToken(database, presented, options.authorization!.accessToken)) {
        return reply.code(401).send({ error: 'authentication_required' });
      }
    });
  }
  const languagePacksPath = options.languagePacksPath ?? './language-packs';
  const semanticPacksPath = existsSync(resolve(languagePacksPath, 'semantic'))
    ? languagePacksPath
    : './language-packs';
  const loadedSelection = options.semanticRuntime
    ? {
        runtime: options.semanticRuntime,
        resolvedLocale: options.locale ?? process.env.DUCKWORTH_LOCALE ?? 'und',
        resolvedCountryCode: options.countryCode ?? process.env.DUCKWORTH_COUNTRY_CODE ?? 'ZZ',
        layers: options.semanticRuntimeLayers,
      }
    : options.semanticRuntimeRegistry && options.locale && options.countryCode
      ? options.semanticRuntimeRegistry.resolve(options.locale, options.countryCode)
      : await loadSemanticRuntimeSelection(semanticPacksPath, options.locale, options.countryCode);
  const semanticRuntime = loadedSelection.runtime;
  const locale = loadedSelection.resolvedLocale;
  const countryCode = loadedSelection.resolvedCountryCode;
  prepareSchema(database, semanticRuntime, clock);
  const items = new ShoppingItemRepository(database, semanticRuntime, clock, { manageSchema: false });
  const brainCaptures = new BrainCaptureStore(database, clock, {
    manageSchema: false,
    retentionDays: options.captureRetentionDays ?? 90,
  });
  const contexts = new ConversationContextRepository(database, clock, { manageSchema: false });
  if (schemaVersion === 0) recordSchemaVersion(database, clock);
  const eventHub = options.eventHub ?? new HouseholdEventHub();
  const compiledHouseholdRuntimeCache = new Map<string, SemanticRuntime>();
  const regionalProducts = new RegionalProductCatalog(languagePacksPath);
  items.backfillBrandNames(regionalProducts.listBrandHints(countryCode));
  registerLanguagePackRoutes(app, languagePacksPath);

  app.post<{
    Params: { householdId: string; itemId: string };
    Body: unknown;
  }>(
    '/api/v2/households/:householdId/items/:itemId/semantic-corrections',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      let command: ReturnType<typeof validateSemanticCorrectionCommand>;
      try {
        command = validateSemanticCorrectionCommand(request.body);
      } catch (error) {
        return reply.code(400).send({ error: 'invalid_semantic_correction', message: error instanceof Error ? error.message : 'invalid command' });
      }
      if (command.itemId !== request.params.itemId) {
        return reply.code(400).send({ error: 'correction_item_mismatch' });
      }
      try {
        const result = items.applySemanticCorrection(request.params.householdId, command);
        const response = {
          item: result.item,
          correction: {
            schemaVersion: 1,
            idempotencyKey: command.idempotencyKey,
            replayed: result.replayed,
            eventId: result.eventId,
            learningMode: command.learn.mode,
          },
          overlayRevision: result.overlayRevision,
          learningEntries: result.learningEntries ?? [],
          proposals: [],
        };
        if (!result.replayed) eventHub.publish(request.params.householdId, { action: 'updated', item: result.item });
        return reply.send(response);
      } catch (error) {
        if (error instanceof ItemVersionConflictError) {
          return reply.code(409).send({ error: 'item_version_conflict', currentItem: error.currentItem });
        }
        if (error instanceof DuplicateShoppingItemError) {
          return reply.code(409).send({ error: 'duplicate_item', existingItemId: error.existingItemId });
        }
        if (error instanceof SemanticCorrectionIdempotencyConflictError) {
          return reply.code(409).send({ error: 'correction_idempotency_conflict' });
        }
        if (error instanceof Error && error.message === 'semantic correction item not found') {
          return reply.code(404).send({ error: 'item_not_found' });
        }
        if (error instanceof Error && error.message === 'invalid correction source') {
          return reply.code(400).send({ error: 'invalid_correction_source' });
        }
        if (error instanceof Error && (
          error.message === 'invalid semantic reference'
          || error.message === 'invalid semantic unit'
          || error.message === 'invalid package container unit'
          || error.message === 'invalid package measurement unit'
          || error.message === 'invalid descriptor attribute'
          || error.message === 'descriptor attribute is not allowed for category'
          || error.message === 'invalid descriptor value'
        )) {
          return reply.code(400).send({ error: 'invalid_semantic_correction', message: error.message });
        }
        throw error;
      }
    },
  );

  app.put<{
    Params: { householdId: string };
    Body: { locale: string; countryCode: string };
  }>(
    '/api/v2/households/:householdId/brain/runtime-settings',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['locale', 'countryCode'],
          properties: {
            locale: { type: 'string', minLength: 1 },
            countryCode: { type: 'string', pattern: '^[A-Z]{2}$' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['locale', 'countryCode'],
            properties: { locale: { type: 'string' }, countryCode: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(brainCaptures.setRuntimeSettings(
          request.params.householdId,
          request.body?.locale ?? '',
          request.body?.countryCode ?? '',
        ));
      } catch (error) {
        return reply.code(400).send({ error: 'invalid_runtime_settings', message: (error as Error).message });
      }
    },
  );

  app.post<{
    Params: { householdId: string };
    Body: BrainCaptureEnvelope;
    Headers: { 'x-conversation-context-token'?: string };
  }>(
    '/api/v2/households/:householdId/brain/captures',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion', 'inputId', 'householdId', 'contextId', 'shoppingListId',
            'source', 'text', 'locale', 'countryCode', 'occurredAt', 'idempotencyKey',
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 2 },
            inputId: { type: 'string', minLength: 1 },
            householdId: { type: 'string', minLength: 1 },
            contextId: { type: 'string', minLength: 1 },
            shoppingListId: { type: 'string', minLength: 1 },
            source: {
              type: 'object',
              additionalProperties: false,
              required: ['kind'],
              properties: {
                kind: { type: 'string', minLength: 1 },
                deviceId: { type: 'string', minLength: 1 },
                speakerId: { type: 'string', minLength: 1 },
              },
            },
            text: { type: 'string', minLength: 1 },
            alternatives: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text'],
                properties: {
                  text: { type: 'string', minLength: 1 },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
            locale: { type: 'string', minLength: 1 },
            countryCode: { type: 'string', pattern: '^[A-Z]{2}$' },
            occurredAt: { type: 'string', format: 'date-time' },
            idempotencyKey: { type: 'string', minLength: 1 },
            acceptedSuggestion: {
              type: 'object', additionalProperties: false,
              required: ['reference', 'originalText', 'replacement'],
              properties: {
                reference: { type: 'string', minLength: 1 },
                originalText: { type: 'string', minLength: 1 },
                replacement: {
                  type: 'object', additionalProperties: false,
                  required: ['start', 'end', 'replacementText'],
                  properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, replacementText: { type: 'string' } },
                },
                productId: { type: 'string', minLength: 1 }, conceptId: { type: 'string', minLength: 1 }, brandId: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      let envelope: BrainCaptureEnvelope;
      try {
        envelope = validateBrainCaptureEnvelope(request.body);
      } catch (error) {
        return reply.code(400).send({ error: 'invalid_brain_capture', message: (error as Error).message });
      }
      if (envelope.householdId !== request.params.householdId) {
        return reply.code(400).send({ error: 'household_mismatch' });
      }
      let processingEnvelope = envelope;
      if (envelope.acceptedSuggestion) {
        const candidate = envelope.acceptedSuggestion;
        const replacement = candidate.replacement;
        if (candidate.originalText !== envelope.text
          || !candidate.reference.startsWith('local:')
          || !candidate.reference.endsWith(`:${encodeURIComponent(candidate.originalText)}`)) {
          return reply.code(409).send({ error: 'suggestion_stale' });
        }
        const appliedText = envelope.text.slice(0, replacement.start)
          + replacement.replacementText
          + envelope.text.slice(replacement.end);
        if (!appliedText.trim()) return reply.code(409).send({ error: 'suggestion_invalid' });
        processingEnvelope = {
          ...envelope,
          text: appliedText,
          rawText: envelope.text,
          acceptedSuggestion: { ...candidate, originalText: appliedText },
        };
      }
      try {
        contexts.authorize(
          envelope.householdId,
          envelope.contextId,
          request.headers['x-conversation-context-token'] ?? '',
        );
      } catch (error) {
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
      const householdRuntimeSettings = brainCaptures.getRuntimeSettings(envelope.householdId);
      const requestedLocale = householdRuntimeSettings?.locale ?? envelope.locale;
      const requestedCountryCode = householdRuntimeSettings?.countryCode ?? envelope.countryCode;
      let requestSelection = loadedSelection;
      if (options.semanticRuntimeRegistry) {
        try {
          requestSelection = options.semanticRuntimeRegistry.resolve(requestedLocale, requestedCountryCode);
        } catch {
          return reply.code(422).send({ error: 'runtime_not_available' });
        }
      } else if (requestedLocale !== locale || requestedCountryCode !== countryCode) {
        return reply.code(422).send({ error: 'runtime_not_available' });
      }
      const replay = brainCaptures.findByIdempotencyKey(envelope.contextId, envelope.idempotencyKey);
      if (replay) {
        return reply.send(brainResponse(
          replay.envelope,
          replay.result,
          brainCaptures.getFacts(replay.envelope.inputId) ?? undefined,
        ));
      }

      const shoppingList = items.getDefaultShoppingList(envelope.householdId);
      if (shoppingList.id !== envelope.shoppingListId) {
        return reply.code(404).send({ error: 'shopping_list_not_found' });
      }
      const learnedEntries = items.listLearnedSemanticEntries(envelope.householdId);
      const overlayRevision = items.getHouseholdOverlayRevision(envelope.householdId);
      const typedLearning = compileTypedLearningOverlay(
        envelope.householdId,
        overlayRevision,
        items.listTypedLearningEffects(envelope.householdId),
      );
      const runtimeVersionKey = Object.entries(requestSelection.runtime.versions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([layer, version]) => `${layer}=${version}`)
        .join('|');
      const runtimeCacheKey = `${envelope.householdId}:${overlayRevision}:${requestedLocale}:${requestedCountryCode}:${runtimeVersionKey}`;
      const requestRuntime = requestSelection.layers
        ? (() => {
            const cached = compiledHouseholdRuntimeCache.get(runtimeCacheKey);
            if (cached) return cached;
            const compiled = compileSemanticRuntime([
              ...requestSelection.layers,
              compileLearningOverlay(envelope.householdId, learnedEntries),
              {
                schemaVersion: 2,
                kind: 'household',
                id: `household:${envelope.householdId}:canonical-learning`,
                version: String(overlayRevision),
                householdId: envelope.householdId,
                conceptAliases: [],
                brandAliases: [],
                quantityPreferences: [],
                canonicalAliases: items.listCanonicalLearningAliases(envelope.householdId),
                unitPreferences: [...typedLearning.unitDefaults].map(([identityKey, unitId]) => ({ identityKey, unitId })),
                packagePreferences: [...typedLearning.packageDefaults].map(([identityKey, { size, unitId }]) => ({ identityKey, size, unitId })),
                descriptorPreferences: [...typedLearning.descriptorDefaults].map(([identityKey, attributes]) => ({ identityKey, attributes })),
                commercialRolePreferences: [...typedLearning.commercialRoleDefaults].map(([identityKey, roles]) => ({ identityKey, roles })),
              },
            ]);
            compiledHouseholdRuntimeCache.set(runtimeCacheKey, compiled);
            return compiled;
          })()
        : requestSelection.runtime;
      const result = runShoppingBrain(
        processingEnvelope,
        requestRuntime,
        brainCaptures.getDiscourseContext(envelope.contextId, envelope.shoppingListId),
      );
      if (envelope.acceptedSuggestion) {
        const semanticCandidates = result.operations
          .filter((operation): operation is Extract<BrainOperation, { kind: 'create' | 'merge' | 'correct' }> => operation.kind !== 'draft')
          .map((operation) => operation.item);
        const accepted = envelope.acceptedSuggestion;
        if (accepted.productId && !semanticCandidates.some((item) => item.productId?.value === accepted.productId)
          || accepted.conceptId && !semanticCandidates.some((item) => item.conceptId.value === accepted.conceptId)
          || accepted.brandId && !semanticCandidates.some((item) => item.brandId.value === accepted.brandId)) {
          return reply.code(409).send({ error: 'suggestion_stale' });
        }
      }
      database.exec('BEGIN IMMEDIATE');
      try {
        const applied = items.applyBrainResult(processingEnvelope, result);
        brainCaptures.persistFacts(processingEnvelope, applied.facts);
        brainCaptures.commitWithinTransaction(
          processingEnvelope,
          result,
          applied.committedEventIds,
          applied.facts,
        );
        database.exec('COMMIT');
        return reply.code(201).send({ result, facts: applied.facts, provenance: { envelope } });
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  );
  app.get<{
    Params: { householdId: string };
    Querystring: { limit?: string };
  }>(
    '/api/v2/households/:householdId/brain/captures',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return reply.code(400).send({ error: 'invalid_capture_export_limit' });
      }
      return reply.send({
        retention: brainCaptures.retentionPolicy(),
        captures: brainCaptures.list(request.params.householdId, limit).map((stored) => ({
          envelope: stored.envelope,
          result: stored.result,
          committedEventIds: stored.committedEventIds,
          createdAt: stored.createdAt,
          expiresAt: stored.expiresAt,
          facts: brainCaptures.getFacts(stored.envelope.inputId),
        })),
      });
    },
  );
  app.get<{
    Params: { householdId: string; inputId: string };
  }>(
    '/api/v2/households/:householdId/brain/captures/:inputId',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const stored = brainCaptures.get(request.params.inputId);
      if (!stored || stored.envelope.householdId !== request.params.householdId) {
        return reply.code(404).send({ error: 'brain_capture_not_found' });
      }
      return reply.send({
        envelope: stored.envelope,
        result: stored.result,
        committedEventIds: stored.committedEventIds,
        facts: brainCaptures.getFacts(stored.envelope.inputId),
        createdAt: stored.createdAt,
        expiresAt: stored.expiresAt,
      });
    },
  );
  app.delete<{
    Params: { householdId: string };
  }>(
    '/api/v2/households/:householdId/brain/captures',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => reply.send({ deleted: brainCaptures.deleteHousehold(request.params.householdId) }),
  );
  app.delete<{
    Params: { householdId: string; inputId: string };
  }>(
    '/api/v2/households/:householdId/brain/captures/:inputId',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      if (!brainCaptures.delete(request.params.householdId, request.params.inputId)) {
        return reply.code(404).send({ error: 'brain_capture_not_found' });
      }
      return reply.code(204).send();
    },
  );

  const executeConversationCapture = (
    householdId: string,
    body: {
      text: string;
      source?: 'text' | 'voice' | 'api' | 'assistant';
      sessionId?: string;
      contextId?: string;
      accessToken?: string;
      idempotencyKey?: string;
      shoppingListId?: string;
      acceptedSuggestion?: BrainCaptureEnvelope['acceptedSuggestion'];
    },
  ) => {
    const effectiveText = body.acceptedSuggestion
      ? body.acceptedSuggestion.originalText.slice(0, body.acceptedSuggestion.replacement.start)
        + body.acceptedSuggestion.replacement.replacementText
        + body.acceptedSuggestion.originalText.slice(body.acceptedSuggestion.replacement.end)
      : body.text;
    if (body.acceptedSuggestion) {
      const candidate = body.acceptedSuggestion;
      if (!candidate.reference.startsWith('local:') || candidate.originalText !== body.text) {
        throw new AcceptedSuggestionStaleError();
      }
      const validationEnvelope: BrainCaptureEnvelope = {
        schemaVersion: 2,
        inputId: `legacy-validation:${randomUUID()}`,
        householdId,
        contextId: body.contextId ?? `legacy:${householdId}`,
        shoppingListId: body.shoppingListId ?? `default:${householdId}`,
        source: { kind: body.source === 'voice' ? 'voice-transcript' : body.source ?? 'text', deviceId: 'legacy-adapter' },
        text: body.text,
        locale,
        countryCode,
        occurredAt: clock().toISOString(),
        idempotencyKey: `legacy-validation:${randomUUID()}`,
        acceptedSuggestion: candidate,
      };
      validateBrainCaptureEnvelope(validationEnvelope);
      const processingEnvelope: BrainCaptureEnvelope = {
        ...validationEnvelope,
        text: effectiveText,
        rawText: body.text,
        acceptedSuggestion: { ...candidate, originalText: effectiveText },
      };
      const validation = runShoppingBrain(processingEnvelope, semanticRuntime, {
        contextId: processingEnvelope.contextId,
        shoppingListId: processingEnvelope.shoppingListId,
        recentEntities: [],
        openDrafts: [],
      });
      const semanticCandidates = validation.operations
        .filter((operation): operation is Extract<BrainOperation, { kind: 'create' | 'merge' | 'correct' }> => operation.kind !== 'draft')
        .map((operation) => operation.item);
      if (candidate.productId && !semanticCandidates.some((item) => item.productId?.value === candidate.productId)
        || candidate.conceptId && !semanticCandidates.some((item) => item.conceptId.value === candidate.conceptId)
        || candidate.brandId && !semanticCandidates.some((item) => item.brandId.value === candidate.brandId)) {
        throw new AcceptedSuggestionStaleError();
      }
    }
    const context = body.contextId
      ? contexts.authorize(householdId, body.contextId, body.accessToken ?? '')
      : undefined;
    const shoppingList = items.resolveShoppingList(householdId, body.shoppingListId);
    const currentSession = context
      ? items.getActiveConversationSessionForScope(householdId, shoppingList.id, context.id)
      : undefined;
    const currentPending = currentSession
      ? items.getPendingConversationActionForSession(householdId, currentSession.id)
      : undefined;
    const lifecycleState = currentSession
      ? {
        status: currentSession.status,
        pendingActionId: currentPending?.id ?? null,
        pendingOrigin: currentPending?.origin ?? null,
        pendingPreviousStatus: currentPending?.previousStatus ?? null,
      }
      : {
        status: 'active' as const,
        pendingActionId: null,
        pendingOrigin: null,
        pendingPreviousStatus: null,
      };
    const lifecycleDecision = decideConversationLifecycle({
      text: effectiveText,
      occurredAt: clock().toISOString(),
    }, lifecycleState);
    if (lifecycleDecision.kind === 'request_close' && currentSession) {
      const pendingClose = items.requestConversationClose(
        householdId,
        shoppingList.id,
        context!.id,
        lifecycleDecision.origin,
      );
      if (pendingClose) {
        return {
          session: pendingClose.session,
          pendingAction: pendingClose.pendingAction,
          saved: [],
          merged: [],
          drafts: [],
          undo: [],
        };
      }
    }
    if (lifecycleDecision.kind === 'confirm_close' && currentPending && context) {
      const confirmed = items.confirmConversationClose(
        householdId,
        currentPending.id,
        shoppingList.id,
        context.id,
      );
      if (confirmed) {
        return {
          session: confirmed.session,
          pendingAction: confirmed.pendingAction,
          saved: [],
          merged: [],
          drafts: [],
          undo: [],
        };
      }
    }
    if (lifecycleDecision.kind === 'cancel_close' && currentSession && context) {
      items.cancelConversationClose(householdId, currentSession.id, shoppingList.id, context.id);
      if (/^(?:no|n|cancel|keep\s+adding|not\s+yet)$/iu.test(body.text.trim())) {
        const cancelled = items.getConversationSession(householdId, currentSession.id)!;
        return {
          session: cancelled,
          pendingAction: null,
          saved: [],
          merged: [],
          drafts: [],
          undo: [],
        };
      }
    }
      const interpretation = interpretLegacyConversation({
      householdId,
      sessionId: body.sessionId,
      text: effectiveText,
      locale,
      countryCode,
      source: body.source ?? 'text',
      brandHints: regionalProducts.listBrandHints(countryCode),
      occurredAt: clock().toISOString(),
      runtime: semanticRuntime,
    });
    const conversationCandidates = items.listConversationCandidates(householdId);
    const decisions = interpretation.items.map((item) => {
      const decision = resolveFollowUp(item.captureText, conversationCandidates, semanticRuntime);
      return decision.kind === 'create' ? { kind: 'create' as const, item } : decision;
    });
    const result = items.captureConversation(
      householdId,
      interpretation,
      decisions,
      context?.id,
      body.idempotencyKey,
      shoppingList.id,
    );
    let captureAudit: LegacyCaptureAudit | undefined;
    try {
      const auditInputId = body.idempotencyKey?.trim()
        ? `legacy:${body.idempotencyKey.trim()}`
        : `legacy:${randomUUID()}`;
      const auditContextId = body.contextId ?? `legacy:${householdId}`;
      const auditEnvelope: BrainCaptureEnvelope = {
        schemaVersion: 2,
        inputId: auditInputId,
        householdId,
        contextId: auditContextId,
        shoppingListId: shoppingList.id,
        source: {
          kind: body.source ?? 'text',
          ...(context?.deviceId ? { deviceId: context.deviceId } : {}),
          ...(context?.speakerId ? { speakerId: context.speakerId } : {}),
        },
        text: effectiveText,
        locale,
        countryCode,
        occurredAt: clock().toISOString(),
        idempotencyKey: body.idempotencyKey?.trim() || auditInputId,
      };
      const auditResult = runShoppingBrain(
        auditEnvelope,
        semanticRuntime,
        brainCaptures.getDiscourseContext(auditContextId, shoppingList.id),
      );
      captureAudit = summarizeLegacyCapture(brainCaptures.commit(auditEnvelope, auditResult));
    } catch {
      // Auditing must never prevent the requested list mutation from succeeding.
    }
    for (const item of result.saved) {
      eventHub.publish(householdId, { action: 'created', item });
    }
    for (const item of result.merged) {
      eventHub.publish(householdId, { action: 'updated', item });
    }
    return captureAudit ? { ...result, captureAudit } : result;
  };
  app.addSchema({
    $id: 'ShoppingItem',
    type: 'object',
    properties: {
      id: { type: 'string' }, householdId: { type: 'string' }, shoppingListId: { type: 'string' }, captureText: { type: 'string' },
      name: { type: 'string' },
      quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      packageSize: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      packageUnit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      categoryId: { type: 'string' },
      categoryConfidence: { type: 'string', enum: ['confirmed', 'inferred', 'unknown'] },
      attributes: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
      brandName: { type: 'string' },
      brandId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      productId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      conceptId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      shopTypes: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' } } } },
      quantitySource: { anyOf: [{ type: 'string', enum: ['explicit', 'history', 'catalog_default', 'policy_default'] }, { type: 'null' }] },
      unitSource: { anyOf: [{ type: 'string', enum: ['explicit', 'history', 'catalog_default', 'policy_default'] }, { type: 'null' }] },
      unitConfirmedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      attentionReasons: { type: 'array', items: { type: 'string', enum: ['missing_quantity', 'unconfirmed_historical_unit'] } },
      status: { type: 'string', enum: ['active', 'purchased', 'removed'] },
      removedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      createdAt: { type: 'string' }, updatedAt: { type: 'string' }, version: { type: 'integer' },
    },
    required: ['id', 'householdId', 'shoppingListId', 'captureText', 'name', 'quantity', 'unit', 'packageSize', 'packageUnit', 'categoryId', 'categoryConfidence', 'attributes',
      'brandId', 'productId', 'conceptId', 'unitSource',
      'unitConfirmedAt', 'attentionReasons', 'status', 'removedAt', 'createdAt', 'updatedAt', 'version'],
  });

  app.get('/health', {
    schema: {
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', const: 'ok' },
            lane: { type: 'string', enum: ['live', 'sandbox', 'api-test'] },
            instanceId: { type: 'string' },
            buildId: { type: 'string' },
          },
          required: ['status'],
        },
      },
    },
  }, async () => ({
    status: 'ok' as const,
    ...(options.runtimeIdentity ? {
      lane: options.runtimeIdentity.lane,
      instanceId: options.runtimeIdentity.instanceId,
      ...(options.runtimeIdentity.buildId ? { buildId: options.runtimeIdentity.buildId } : {}),
    } : {}),
  }));

  app.post<{ Body: { pairingCode?: string } }>(
    '/api/v1/session/pair',
    {
      schema: {
        tags: ['health'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['pairingCode'],
          properties: { pairingCode: { type: 'string', minLength: 1, maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      if (!options.authorization || !options.authorization.pairingCode
        || request.body?.pairingCode !== options.authorization.pairingCode
        || (options.authorization.pairingExpiresAt !== undefined
          && Date.parse(options.authorization.pairingExpiresAt) <= Date.now())) {
        return reply.code(401).send({ error: 'invalid_pairing_code' });
      }
      database.prepare(`
        INSERT INTO duckworth_pairing_state (id, consumed_at, session_token_hash) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET consumed_at = excluded.consumed_at,
          session_token_hash = excluded.session_token_hash
      `).run(new Date().toISOString(), hashToken(options.authorization.accessToken));
      reply.header(
        'set-cookie',
        `duckworth_session=${encodeURIComponent(options.authorization.accessToken)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=15552000`,
      );
      return reply.send({
        lane: options.runtimeIdentity?.lane ?? 'sandbox',
        householdId: options.authorization.householdId,
      });
    },
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/shopping-lists',
    { schema: { tags: ['shopping'] } },
    async (request) => {
      items.getDefaultShoppingList(request.params.householdId);
      return items.listShoppingLists(request.params.householdId);
    },
  );

  app.post<{
    Params: { householdId: string };
    Body: { deviceId: string; speakerId?: string; label?: string };
  }>(
    '/api/v1/households/:householdId/conversation-contexts',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          required: ['deviceId'],
          additionalProperties: false,
          properties: {
            deviceId: { type: 'string', minLength: 1 },
            speakerId: { type: 'string', minLength: 1 },
            label: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = contexts.register(
        request.params.householdId,
        request.body.deviceId,
        request.body.speakerId ?? null,
        request.body.label,
      );
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );

  app.post<{
    Params: { householdId: string; actionId: string };
    Body: { contextId?: string; accessToken?: string; shoppingListId?: string; idempotencyKey?: string };
  }>(
    '/api/v1/households/:householdId/conversation-pending-actions/:actionId/confirm',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const body = request.body ?? {};
      const pending = items.getPendingConversationAction(request.params.householdId, request.params.actionId);
      if (!pending) return reply.code(404).send({ error: 'conversation_pending_action_not_found' });
      if (!body.contextId || !body.accessToken || body.contextId !== pending.contextId) {
        return reply.code(403).send({ error: 'conversation_context_forbidden' });
      }
      try {
        contexts.authorize(request.params.householdId, body.contextId, body.accessToken);
      } catch (error) {
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
      if (body.shoppingListId && body.shoppingListId !== pending.shoppingListId) {
        return reply.code(403).send({ error: 'shopping_list_forbidden' });
      }
      const result = items.confirmConversationClose(
        request.params.householdId,
        pending.id,
        pending.shoppingListId,
        pending.contextId,
      );
      if (!result) return reply.code(409).send({ error: 'conversation_pending_action_stale' });
      return reply.send(result);
    },
  );

  app.post<{
    Params: { householdId: string; actionId: string };
    Body: { contextId?: string; accessToken?: string; shoppingListId?: string };
  }>(
    '/api/v1/households/:householdId/conversation-pending-actions/:actionId/cancel',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const body = request.body ?? {};
      const pending = items.getPendingConversationAction(request.params.householdId, request.params.actionId);
      if (!pending) return reply.code(404).send({ error: 'conversation_pending_action_not_found' });
      if (!body.contextId || !body.accessToken || body.contextId !== pending.contextId) {
        return reply.code(403).send({ error: 'conversation_context_forbidden' });
      }
      try {
        contexts.authorize(request.params.householdId, body.contextId, body.accessToken);
      } catch (error) {
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
      if (body.shoppingListId && body.shoppingListId !== pending.shoppingListId) {
        return reply.code(403).send({ error: 'shopping_list_forbidden' });
      }
      const session = items.cancelConversationCloseAction(
        request.params.householdId,
        pending.id,
        pending.shoppingListId,
        pending.contextId,
      );
      if (!session) return reply.code(409).send({ error: 'conversation_pending_action_stale' });
      return reply.send({ session, pendingAction: items.getPendingConversationAction(request.params.householdId, pending.id) ?? null });
    },
  );

  app.post<{
    Params: { householdId: string; contextId: string };
    Body: { accessToken: string; targetDeviceId: string; targetSpeakerId?: string };
  }>(
    '/api/v1/households/:householdId/conversation-contexts/:contextId/handoff',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          required: ['accessToken', 'targetDeviceId'],
          additionalProperties: false,
          properties: {
            accessToken: { type: 'string', minLength: 1 },
            targetDeviceId: { type: 'string', minLength: 1 },
            targetSpeakerId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(contexts.createHandoff(
          request.params.householdId,
          request.params.contextId,
          request.body.accessToken,
          request.body.targetDeviceId,
          request.body.targetSpeakerId ?? null,
        ));
      } catch (error) {
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { householdId: string };
    Body: { handoffToken: string; deviceId: string; speakerId?: string };
  }>(
    '/api/v1/households/:householdId/conversation-contexts/claim',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          required: ['handoffToken', 'deviceId'],
          additionalProperties: false,
          properties: {
            handoffToken: { type: 'string', minLength: 1 },
            deviceId: { type: 'string', minLength: 1 },
            speakerId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(contexts.claimHandoff(
          request.params.householdId,
          request.body.handoffToken,
          request.body.deviceId,
          request.body.speakerId ?? null,
        ));
      } catch (error) {
        if (error instanceof ConversationContextHandoffNotFoundError
          || error instanceof ConversationContextHandoffExpiredError) {
          return reply.code(404).send({ error: 'conversation_handoff_not_found' });
        }
        if (error instanceof ConversationContextHandoffAlreadyClaimedError) {
          return reply.code(409).send({ error: 'conversation_handoff_claimed' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_handoff_forbidden' });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/conversation-contexts',
    { schema: { tags: ['shopping'] } },
    async (request) => contexts.list(request.params.householdId),
  );

  app.post<{
    Params: { householdId: string; contextId: string };
    Body: { accessToken: string };
  }>(
    '/api/v1/households/:householdId/conversation-contexts/:contextId/close',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          required: ['accessToken'],
          additionalProperties: false,
          properties: { accessToken: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(contexts.close(
          request.params.householdId,
          request.params.contextId,
          request.body.accessToken,
        ));
      } catch (error) {
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { householdId: string }; Querystring: { includePurchased?: boolean; includeRemoved?: boolean } }>(
    '/api/v1/households/:householdId/items',
    { schema: { tags: ['shopping'], querystring: { type: 'object', properties: { includePurchased: { type: 'boolean' }, includeRemoved: { type: 'boolean' } } }, response: { 200: { type: 'array', items: { $ref: 'ShoppingItem#' } } } } },
    async (request) => items.listActive(
      request.params.householdId,
      request.query.includePurchased === true,
      request.query.includeRemoved === true,
    ),
  );

  app.get<{ Params: { householdId: string }; Querystring: { shopTypeId?: string } }>(
    '/api/v1/households/:householdId/items/view',
    {
      schema: {
        tags: ['shopping'],
        querystring: { type: 'object', properties: { shopTypeId: { type: 'string', minLength: 1 } } },
      },
    },
    async (request) => items.getShoppingItemView(request.params.householdId, request.query.shopTypeId),
  );

  app.post<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/shopping-list-archives',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      try {
        return reply.code(201).send(items.archiveActiveList(request.params.householdId));
      } catch (error) {
        if (error instanceof EmptyShoppingListArchiveError) {
          return reply.code(409).send({ error: 'active_list_empty' });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/shopping-list-archives',
    { schema: { tags: ['shopping'] } },
    async (request) => items.listShoppingListArchives(request.params.householdId),
  );

  app.get<{ Params: { householdId: string; archiveId: string } }>(
    '/api/v1/households/:householdId/shopping-list-archives/:archiveId',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const archive = items.getShoppingListArchive(request.params.householdId, request.params.archiveId);
      if (!archive) return reply.code(404).send({ error: 'shopping_list_archive_not_found' });
      return reply.send(archive);
    },
  );

  app.post<{ Params: { householdId: string; archiveId: string } }>(
    '/api/v1/households/:householdId/shopping-list-archives/:archiveId/reopen',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      try {
        return reply.send(items.reopenShoppingListArchive(
          request.params.householdId,
          request.params.archiveId,
        ));
      } catch (error) {
        if (error instanceof ShoppingListArchiveNotFoundError) {
          return reply.code(404).send({ error: 'shopping_list_archive_not_found' });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { householdId: string; archiveId: string } }>(
    '/api/v1/households/:householdId/shopping-list-archives/:archiveId/copy',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      try {
        const result = items.copyShoppingListArchive(
          request.params.householdId,
          request.params.archiveId,
        );
        for (const item of result.items) {
          eventHub.publish(request.params.householdId, { action: 'created', item });
        }
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof ShoppingListArchiveNotFoundError) {
          return reply.code(404).send({ error: 'shopping_list_archive_not_found' });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { householdId: string };
    Body: {
      text: string;
      source?: 'text' | 'voice' | 'api' | 'assistant';
      sessionId?: string;
      contextId?: string;
      accessToken?: string;
      idempotencyKey?: string;
      shoppingListId?: string;
      acceptedSuggestion?: BrainCaptureEnvelope['acceptedSuggestion'];
    };
  }>(
    '/api/v1/households/:householdId/conversation-captures',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1 },
            source: { type: 'string', enum: ['text', 'voice', 'api', 'assistant'] },
            sessionId: { type: 'string', minLength: 1 },
            contextId: { type: 'string', minLength: 1 },
            accessToken: { type: 'string', minLength: 1 },
            idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
            shoppingListId: { type: 'string', minLength: 1 },
            acceptedSuggestion: {
              type: 'object', additionalProperties: false,
              required: ['reference', 'originalText', 'replacement'],
              properties: {
                reference: { type: 'string', minLength: 1 },
                originalText: { type: 'string', minLength: 1 },
                replacement: {
                  type: 'object', additionalProperties: false,
                  required: ['start', 'end', 'replacementText'],
                  properties: {
                    start: { type: 'integer', minimum: 0 },
                    end: { type: 'integer', minimum: 0 },
                    replacementText: { type: 'string', minLength: 1 },
                  },
                },
                productId: { type: 'string', minLength: 1 },
                conceptId: { type: 'string', minLength: 1 },
                brandId: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = executeConversationCapture(
          request.params.householdId,
          request.body,
        );
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof AcceptedSuggestionStaleError) {
          return reply.code(409).send({ error: 'suggestion_stale' });
        }
        if (error instanceof InvalidCaptureError) {
          return reply.code(400).send({ error: 'invalid_capture' });
        }
        if (error instanceof ShoppingListNotFoundError) {
          return reply.code(404).send({ error: 'shopping_list_not_found' });
        }
        if (error instanceof DuplicateShoppingItemError) {
          return reply.code(409).send({ error: 'duplicate_item', existingItemId: error.existingItemId });
        }
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/conversation-sessions/active',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const session = items.getActiveConversationSession(request.params.householdId);
      if (!session) return reply.code(404).send({ error: 'active_session_not_found' });
      return reply.send(session);
    },
  );

  app.get<{
    Params: { householdId: string };
    Querystring: { shoppingListId?: string; contextId?: string; accessToken?: string };
  }>(
    '/api/v1/households/:householdId/conversation-state',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const { shoppingListId, contextId, accessToken } = request.query;
      if (!shoppingListId || !contextId || !accessToken) {
        return reply.code(400).send({ error: 'conversation_state_scope_required' });
      }
      try {
        contexts.authorize(request.params.householdId, contextId, accessToken);
        const list = items.resolveShoppingList(request.params.householdId, shoppingListId);
        return reply.send(items.getConversationStateForScope(
          request.params.householdId,
          list,
          contextId,
        ));
      } catch (error) {
        if (error instanceof ShoppingListNotFoundError) {
          return reply.code(404).send({ error: 'shopping_list_not_found' });
        }
        if (error instanceof ConversationContextNotFoundError) {
          return reply.code(404).send({ error: 'conversation_context_not_found' });
        }
        if (error instanceof ConversationContextAccessError) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { householdId: string };
    Body: { shoppingListId: string; contextId: string; accessToken: string };
  }>(
    '/api/v1/households/:householdId/conversation-lifecycle/evaluate',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      try {
        contexts.authorize(request.params.householdId, request.body.contextId, request.body.accessToken);
        const list = items.resolveShoppingList(request.params.householdId, request.body.shoppingListId);
        const result = items.evaluateAutomaticConversationClose(
          request.params.householdId,
          list.id,
          request.body.contextId,
        );
        return reply.send(result ?? { session: null, pendingAction: null });
      } catch (error) {
        if (error instanceof ShoppingListNotFoundError) return reply.code(404).send({ error: 'shopping_list_not_found' });
        if (error instanceof ConversationContextNotFoundError) return reply.code(404).send({ error: 'conversation_context_not_found' });
        if (error instanceof ConversationContextAccessError) return reply.code(403).send({ error: 'conversation_context_forbidden' });
        throw error;
      }
    },
  );

  app.post<{
    Params: { householdId: string; sessionId: string };
    Body: { contextId?: string; accessToken?: string; shoppingListId?: string; idempotencyKey?: string };
  }>(
    '/api/v1/households/:householdId/conversation-sessions/:sessionId/close',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const body = request.body ?? {};
      const current = items.getConversationSession(
        request.params.householdId,
        request.params.sessionId,
      );
      if (!current) return reply.code(404).send({ error: 'active_session_not_found' });
      if (current.contextId) {
        if (!body.contextId || !body.accessToken
          || body.contextId !== current.contextId) {
          return reply.code(403).send({ error: 'conversation_context_forbidden' });
        }
        try {
          contexts.authorize(
            request.params.householdId,
            body.contextId,
            body.accessToken,
          );
        } catch (error) {
          if (error instanceof ConversationContextNotFoundError) {
            return reply.code(404).send({ error: 'conversation_context_not_found' });
          }
          if (error instanceof ConversationContextAccessError) {
            return reply.code(403).send({ error: 'conversation_context_forbidden' });
          }
          throw error;
        }
      } else if (body.contextId || body.accessToken) {
        return reply.code(403).send({ error: 'conversation_context_forbidden' });
      }
      const session = items.closeConversationSession(
        request.params.householdId,
        request.params.sessionId,
        body.contextId,
      );
      if (!session) return reply.code(404).send({ error: 'active_session_not_found' });
      return reply.send(session);
    },
  );

  app.get<{ Params: { householdId: string; sessionId: string } }>(
    '/api/v1/households/:householdId/conversation-sessions/:sessionId/drafts',
    { schema: { tags: ['shopping'] } },
    async (request) => items.listConversationDrafts(
      request.params.householdId,
      request.params.sessionId,
    ),
  );

  app.post<{
    Params: { householdId: string; draftId: string };
    Body: { text: string; source?: 'text' | 'voice' | 'api' | 'assistant' };
  }>(
    '/api/v1/households/:householdId/conversation-drafts/:draftId/resolve',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1 },
            source: { type: 'string', enum: ['text', 'voice', 'api', 'assistant'] },
          },
        },
      },
    },
    async (request, reply) => {
      const draft = items.getConversationDraft(request.params.householdId, request.params.draftId);
      if (!draft) return reply.code(404).send({ error: 'draft_not_found' });
      if (draft.status !== 'open') return reply.code(409).send({ error: 'draft_not_open' });
      try {
        const result = executeConversationCapture(request.params.householdId, request.body);
        if (result.saved.length === 0 && result.merged.length === 0) {
          return reply.code(422).send({ error: 'draft_still_unresolved', result });
        }
        const resolved = items.setConversationDraftStatus(
          request.params.householdId,
          request.params.draftId,
          'resolved',
        );
        return reply.send({ draft: resolved, result });
      } catch (error) {
        if (error instanceof InvalidCaptureError) {
          return reply.code(400).send({ error: 'invalid_capture' });
        }
        if (error instanceof DuplicateShoppingItemError) {
          return reply.code(409).send({ error: 'duplicate_item', existingItemId: error.existingItemId });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { householdId: string; draftId: string } }>(
    '/api/v1/households/:householdId/conversation-drafts/:draftId/dismiss',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      const dismissed = items.setConversationDraftStatus(
        request.params.householdId,
        request.params.draftId,
        'dismissed',
      );
      if (!dismissed) return reply.code(404).send({ error: 'open_draft_not_found' });
      return reply.send(dismissed);
    },
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/capture-settings',
    { schema: { tags: ['shopping'] } },
    async (request) => items.getHouseholdCaptureSettings(request.params.householdId),
  );

  app.patch<{
    Params: { householdId: string; itemId: string };
    Body: { expectedVersion?: number; shopTypeDecisions?: Array<{ tagId?: string; decision?: string }> };
  }>('/api/v1/households/:householdId/items/:itemId/classification', {
    schema: {
      tags: ['shopping'],
      body: {
        type: 'object', additionalProperties: false, required: ['expectedVersion', 'shopTypeDecisions'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          shopTypeDecisions: {
            type: 'array', maxItems: 64,
            items: {
              type: 'object', additionalProperties: false, required: ['tagId', 'decision'],
              properties: { tagId: { type: 'string', minLength: 1 }, decision: { type: 'string', enum: ['include', 'exclude', 'clear'] } },
            },
          },
        },
      },
      response: { 200: { $ref: 'ShoppingItem#' } },
    },
  }, async (request, reply) => {
    const body = request.body ?? {};
    if (!Number.isInteger(body.expectedVersion) || body.expectedVersion! < 1 || !Array.isArray(body.shopTypeDecisions)) {
      return reply.code(400).send({ error: 'invalid_classification_patch' });
    }
    const decisions = body.shopTypeDecisions.map((entry) => ({ tagId: entry.tagId ?? '', decision: entry.decision ?? '' }));
    if (decisions.some((entry) => !entry.tagId || (entry.decision !== 'include' && entry.decision !== 'exclude' && entry.decision !== 'clear'))
      || new Set(decisions.map((entry) => entry.tagId)).size !== decisions.length) {
      return reply.code(400).send({ error: 'invalid_classification_patch' });
    }
    try {
      const item = items.updateClassification(
        request.params.householdId,
        request.params.itemId,
        decisions as Array<{ tagId: string; decision: 'include' | 'exclude' | 'clear' }>,
        body.expectedVersion!,
      );
      if (!item) return reply.code(404).send({ error: 'item_not_found' });
      eventHub.publish(request.params.householdId, { action: 'updated', item });
      return reply.send(item);
    } catch (error) {
      if ((error as Error).message === 'invalid_shop_type') return reply.code(400).send({ error: 'invalid_shop_type' });
      if (error instanceof ItemVersionConflictError) {
        return reply.code(409).send({ error: 'item_version_conflict', currentItem: error.currentItem });
      }
      throw error;
    }
  });

  app.post<{
    Params: { householdId: string };
    Body: { text?: string; trigger?: 'save' | 'typing' | 'manual' | 'on_idle'; captureRevision?: number };
  }>('/api/v1/households/:householdId/cloud-assist', {
    schema: {
      tags: ['shopping'],
      body: {
        type: 'object', additionalProperties: false, required: ['text', 'trigger'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 512 },
          trigger: { type: 'string', enum: ['save', 'typing', 'manual', 'on_idle'] },
          captureRevision: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const settings = items.getHouseholdCaptureSettings(request.params.householdId);
    const trigger = request.body.trigger === 'typing' || request.body.trigger === 'on_idle' ? 'on_idle' : 'manual';
    const allowed = settings.entitlement === 'premium'
      && settings.onlineLookupConsent === true
      && (trigger === 'manual' ? settings.cloudAssistOnSave : settings.cloudAssistWhileTyping)
      && (trigger !== 'on_idle' || settings.onlineLookupTrigger === 'on_idle');
    if (!allowed) return reply.code(403).send({ error: 'cloud_assist_not_enabled' });
    try {
      const phrase = normalizeOnlineLookupPhrase(request.body.text!);
      const locale = options.locale ?? 'en-IN';
      const countryCode = options.countryCode ?? 'IN';
      const cached = items.getOnlineLookupCandidate(request.params.householdId, countryCode, locale, phrase, semanticRuntime.versions);
      const result = cached ?? await onlineLookup.lookup({ phrase, locale, countryCode, trigger });
      if (!result) return reply.send({ suggestion: null, requiresUserConfirmation: true });
      if (!cached) {
        items.recordOnlineLookupCandidate(
          request.params.householdId,
          countryCode,
          locale,
          phrase,
          result.providerId,
          result.candidate,
          semanticRuntime.versions,
        );
      }
      const receipt = items.recordOnlineLookupReceipt(request.params.householdId, phrase, result.providerId, result.candidate, semanticRuntime.versions);
      return reply.send({ suggestion: result.candidate, source: result.providerId, acceptanceToken: receipt.token, expiresAt: receipt.expiresAt, requiresUserConfirmation: true });
    } catch (error) {
      if (error instanceof CloudAssistProviderError) return reply.code(502).send({ error: 'cloud_assist_provider_error' });
      throw error;
    }
  });

  app.post<{
    Params: { householdId: string; token: string };
    Body: { text?: string };
  }>('/api/v1/households/:householdId/cloud-assist/:token/accept', {
    schema: { tags: ['shopping'], body: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 512 } } } },
  }, async (request, reply) => {
    const settings = items.getHouseholdCaptureSettings(request.params.householdId);
    if (settings.entitlement !== 'premium' || settings.onlineLookupConsent !== true) {
      return reply.code(403).send({ error: 'cloud_assist_not_enabled' });
    }
    const accepted = items.acceptOnlineLookupReceipt(
      request.params.householdId,
      request.params.token,
      request.body.text!,
      semanticRuntime.versions,
    );
    return accepted ? reply.send({ suggestion: accepted.candidate, source: accepted.providerId, expiresAt: accepted.expiresAt })
      : reply.code(409).send({ error: 'suggestion_stale' });
  });

  app.patch<{
    Params: { householdId: string };
    Body: {
      automaticConversationClose: 'off' | 'after_idle';
      idleThresholdSeconds: number;
      gracePeriodSeconds: number;
      warningPolicy: 'silent' | 'prompt';
      cloudDraftAssist: 'disabled' | 'ask_before_each_use';
      cloudAssistOnSave: boolean;
      cloudAssistWhileTyping: boolean;
      onlineLookupConsent?: boolean;
      onlineLookupTrigger?: 'manual' | 'on_idle';
      suggestions: 'enabled' | 'disabled';
    };
  }>(
    '/api/v1/households/:householdId/capture-settings',
    {
      schema: {
        tags: ['shopping'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'automaticConversationClose', 'idleThresholdSeconds', 'gracePeriodSeconds',
            'warningPolicy', 'cloudDraftAssist', 'cloudAssistOnSave', 'cloudAssistWhileTyping', 'suggestions',
          ],
          properties: {
            automaticConversationClose: { type: 'string', enum: ['off', 'after_idle'] },
            idleThresholdSeconds: { type: 'integer', minimum: 60, maximum: 604800 },
            gracePeriodSeconds: { type: 'integer', minimum: 30, maximum: 3600 },
            warningPolicy: { type: 'string', enum: ['silent', 'prompt'] },
            cloudDraftAssist: { type: 'string', enum: ['disabled', 'ask_before_each_use'] },
            cloudAssistOnSave: { type: 'boolean' },
            cloudAssistWhileTyping: { type: 'boolean' },
            onlineLookupConsent: { type: 'boolean' },
            onlineLookupTrigger: { type: 'string', enum: ['manual', 'on_idle'] },
            suggestions: { type: 'string', enum: ['enabled', 'disabled'] },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return items.setHouseholdCaptureSettings(request.params.householdId, request.body);
      } catch (error) {
        if ((error as Error).message === 'premium_entitlement_required') {
          return reply.code(403).send({ error: 'premium_entitlement_required' });
        }
        throw error;
      }
    },
  );

  app.put<{
    Params: { householdId: string };
    Body: { plan?: 'free' | 'premium' };
  }>('/api/v1/admin/households/:householdId/entitlement', {
    schema: {
      tags: ['shopping'],
      body: {
        type: 'object', additionalProperties: false, required: ['plan'],
        properties: { plan: { type: 'string', enum: ['free', 'premium'] } },
      },
    },
  }, async (request, reply) => {
    const configuredToken = options.premiumAdminToken?.trim() ?? process.env.DUCKWORTH_PREMIUM_ADMIN_TOKEN?.trim();
    const presented = singleHeader(request.headers['x-duckworth-admin-token']);
    if (!configuredToken || !presented || !safeSecretEquals(hashSecret(presented), hashSecret(configuredToken))) {
      return reply.code(403).send({ error: 'admin_authorization_required' });
    }
    return { plan: items.setHouseholdEntitlement(request.params.householdId, request.body.plan!) };
  });

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/suggestions',
    { schema: { tags: ['shopping'] } },
    async (request) => items.listHouseholdSuggestions(request.params.householdId),
  );

  for (const action of ['accept', 'dismiss'] as const) {
    app.post<{ Params: { householdId: string; identityKey: string } }>(
      `/api/v1/households/:householdId/suggestions/:identityKey/${action}`,
      { schema: { tags: ['shopping'] } },
      async (request) => items.setSuggestionFeedback(
        request.params.householdId,
        request.params.identityKey,
        action === 'accept' ? 'accepted' : 'dismissed',
      ),
    );
  }

  app.post<{ Params: { householdId: string; identityKey: string } }>(
    '/api/v1/households/:householdId/suggestions/:identityKey/restore',
    { schema: { tags: ['shopping'] } },
    async (request) => items.restoreSuggestion(
      request.params.householdId,
      request.params.identityKey,
    ),
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v1/households/:householdId/learning',
    { schema: { tags: ['shopping'] } },
    async (request) => items.listLearnedSemanticEntries(request.params.householdId, true),
  );
  app.patch<{ Params: { householdId: string; learningId: string }; Body: { status: 'active' | 'suppressed' | 'cleared' } }>(
    '/api/v1/households/:householdId/learning/:learningId',
    { schema: { tags: ['shopping'], body: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['active', 'suppressed', 'cleared'] } } } } },
    async (request, reply) => {
      const entry = items.setLearnedSemanticEntryStatus(request.params.householdId, request.params.learningId, request.body.status);
      return entry ? reply.send(entry) : reply.code(404).send({ error: 'learning_entry_not_found' });
    },
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v2/households/:householdId/learning-control',
    { schema: { tags: ['shopping'] } },
    async (request) => items.getLearningControl(request.params.householdId),
  );

  app.get<{ Params: { householdId: string } }>(
    '/api/v2/households/:householdId/diagnostics/quality',
    { schema: { tags: ['diagnostics'] } },
    async (request) => items.getHouseholdQualityMetrics(request.params.householdId),
  );

  app.post<{ Params: { householdId: string; eventId: string } }>(
    '/api/v2/households/:householdId/semantic-corrections/:eventId/undo',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      try {
        const result = items.undoSemanticCorrection(request.params.householdId, request.params.eventId);
        eventHub.publish(request.params.householdId, { action: 'updated', item: result.item });
        return reply.send(result);
      } catch (error) {
        if (error instanceof Error && error.message === 'semantic correction event not found') {
          return reply.code(404).send({ error: 'semantic_correction_event_not_found' });
        }
        if (error instanceof Error && error.message === 'semantic correction event already undone') {
          return reply.code(409).send({ error: 'semantic_correction_event_already_undone' });
        }
        if (error instanceof ItemVersionConflictError) {
          return reply.code(409).send({ error: 'item_version_conflict', currentItem: error.currentItem });
        }
        throw error;
      }
    },
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

  app.post<{ Params: { householdId: string }; Body: { input?: string; name?: string; confirmedUnit?: string; productId?: string; source?: CaptureSource } }>(
    '/api/v1/households/:householdId/items',
    { schema: { tags: ['shopping'], body: { type: 'object', properties: { input: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, confirmedUnit: { type: 'string', minLength: 1, maxLength: 32 }, productId: { type: 'string', minLength: 1, maxLength: 128 }, source: { type: 'string', enum: ['text', 'voice', 'api'] } }, oneOf: [{ required: ['input'], not: { required: ['name'] } }, { required: ['name'], not: { required: ['input'] } }] }, response: { 201: { $ref: 'ShoppingItem#' } } } },
    async (request, reply) => {
      const { input, name, confirmedUnit, productId, source } = request.body ?? {};
      if ((input === undefined) === (name === undefined)) {
        return reply.code(400).send({ error: 'invalid_item_name' });
      }
      if (confirmedUnit !== undefined
        && (typeof confirmedUnit !== 'string' || confirmedUnit.trim().length === 0 || confirmedUnit.trim().length > 32)) {
        return reply.code(400).send({ error: 'invalid_item_unit' });
      }

      try {
        const intent = enrichItemIntent(interpretLegacyItem({
          text: input ?? name ?? '',
          locale,
          countryCode,
          source: source ?? (input === undefined ? 'api' : 'text'),
          brandHints: regionalProducts.listBrandHints(countryCode),
          ...(productId ? { acceptedProductId: productId } : {}),
          runtime: semanticRuntime,
        }), semanticRuntime);
        const product = productId ? regionalProducts.resolve(countryCode, productId, intent.itemName) : undefined;
        if (productId && !product) return reply.code(400).send({ error: 'invalid_product_reference' });
        const item = items.create(request.params.householdId, intent, confirmedUnit, product ?? undefined);
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
      captureText?: string;
      name?: string;
      status?: ShoppingItemStatus;
      quantity?: number | null;
      confirmedUnit?: string | null;
      packageSize?: number | null;
      packageUnit?: string | null;
      expectedVersion?: number;
    };
  }>('/api/v1/households/:householdId/items/:itemId', { schema: { tags: ['shopping'], body: { type: 'object', required: ['expectedVersion'], properties: { captureText: { type: 'string', minLength: 1 }, name: { type: 'string' }, status: { type: 'string', enum: ['active', 'purchased', 'removed'] }, quantity: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'null' }] }, confirmedUnit: { anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }] }, packageSize: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'null' }] }, packageUnit: { anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }] }, expectedVersion: { type: 'integer', minimum: 1 } } }, response: { 200: { $ref: 'ShoppingItem#' } } } }, async (request, reply) => {
    const body = request.body ?? {};
    const { captureText, name, status, quantity, confirmedUnit, packageSize, packageUnit, expectedVersion } = body;
    const hasCaptureText = Object.prototype.hasOwnProperty.call(body, 'captureText');
    const hasQuantity = Object.prototype.hasOwnProperty.call(body, 'quantity');
    const hasConfirmedUnit = Object.prototype.hasOwnProperty.call(body, 'confirmedUnit');
    const hasPackageSize = Object.prototype.hasOwnProperty.call(body, 'packageSize');
    const hasPackageUnit = Object.prototype.hasOwnProperty.call(body, 'packageUnit');
    if ((name === undefined && status === undefined && !hasQuantity && !hasConfirmedUnit && !hasCaptureText)
      || (name !== undefined && (typeof name !== 'string' || name.trim().length === 0))) {
      return reply.code(400).send({ error: 'invalid_item_update' });
    }
    if (hasCaptureText && (typeof captureText !== 'string' || captureText.trim().length === 0
      || name === undefined || !hasQuantity || !hasConfirmedUnit || !hasPackageSize || !hasPackageUnit)) {
      return reply.code(400).send({ error: 'complete_item_correction_required' });
    }
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return reply.code(400).send({ error: 'expected_version_required' });
    }
    const version = expectedVersion as number;
    if (status !== undefined && status !== 'active' && status !== 'purchased' && status !== 'removed') {
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
    if (hasPackageSize && packageSize !== null
      && (typeof packageSize !== 'number' || !Number.isFinite(packageSize) || packageSize <= 0)) {
      return reply.code(400).send({ error: 'invalid_package_size' });
    }
    if (hasPackageUnit && packageUnit !== null
      && (typeof packageUnit !== 'string' || packageUnit.trim().length === 0 || packageUnit.trim().length > 32)) {
      return reply.code(400).send({ error: 'invalid_package_unit' });
    }
    if (hasCaptureText && ((packageSize === null) !== (packageUnit === null))) {
      return reply.code(400).send({ error: 'invalid_package_details' });
    }
    try {
      const patch: {
        captureText?: string;
        name?: string;
        status?: ShoppingItemStatus;
        quantity?: number | null;
        confirmedUnit?: string | null;
        packageSize?: number | null;
        packageUnit?: string | null;
        brandName?: string | null;
      } = { name, status };
      if (hasCaptureText && captureText && name !== undefined) {
        const corrected = reconcileItemCorrection({
          captureText,
          itemName: name,
          quantity: quantity ?? null,
          unit: confirmedUnit?.trim() || null,
          packageSize: packageSize ?? null,
          packageUnit: packageUnit?.trim() || null,
          locale,
          countryCode,
          source: 'api',
          runtime: semanticRuntime,
        });
        patch.captureText = corrected.captureText;
        patch.name = corrected.itemName;
        patch.quantity = corrected.quantity;
        patch.confirmedUnit = corrected.unit;
        patch.packageSize = corrected.packageSize;
        patch.packageUnit = corrected.packageUnit;
        patch.brandName = identifyBrand(corrected.itemName, regionalProducts.listBrandHints(countryCode));
      } else {
        if (name !== undefined) patch.brandName = identifyBrand(name, regionalProducts.listBrandHints(countryCode));
        if (hasQuantity) patch.quantity = quantity ?? null;
        if (hasConfirmedUnit) patch.confirmedUnit = confirmedUnit ?? null;
      }
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
      if (error instanceof ItemCorrectionConflictError) {
        return reply.code(400).send({ error: 'item_details_conflict' });
      }
      if (error instanceof InvalidItemTransitionError) {
        return reply.code(400).send({ error: 'invalid_item_transition' });
      }
      throw error;
    }
  });

  app.post<{ Params: { householdId: string; eventId: string } }>(
    '/api/v1/households/:householdId/shopping-item-events/:eventId/undo',
    { schema: { tags: ['shopping'] } },
    async (request, reply) => {
      try {
        const result = items.undoShoppingItemEvent(
          request.params.householdId,
          request.params.eventId,
        );
        eventHub.publish(request.params.householdId, { action: 'updated', item: result.item });
        return reply.send(result);
      } catch (error) {
        if (error instanceof ShoppingItemEventAlreadyUndoneError) {
          return reply.code(409).send({ error: 'event_already_undone' });
        }
        if (error instanceof ShoppingItemEventNotUndoableError) {
          return reply.code(400).send({ error: 'event_not_undoable' });
        }
        if (error instanceof ShoppingItemEventNotFoundError) {
          return reply.code(404).send({ error: 'event_not_found' });
        }
        throw error;
      }
    },
  );

  app.addHook('onClose', async () => items.close());

  return app;
}

class AcceptedSuggestionStaleError extends Error {
  constructor() {
    super('Accepted suggestion is stale or does not match the active runtime');
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

function safeSecretEquals(candidate: Buffer, expected: Buffer): boolean {
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function validSessionToken(database: DatabaseSync, presented: string, configured: string): boolean {
  const presentedHash = Buffer.from(hashToken(presented), 'utf8');
  const configuredHash = Buffer.from(hashToken(configured), 'utf8');
  if (presentedHash.length === configuredHash.length && timingSafeEqual(presentedHash, configuredHash)) return true;
  const stored = database.prepare('SELECT session_token_hash FROM duckworth_pairing_state WHERE id = 1').get() as { session_token_hash: string | null } | undefined;
  if (!stored?.session_token_hash) return false;
  const candidate = Buffer.from(hashToken(presented), 'utf8');
  const expected = Buffer.from(stored.session_token_hash, 'utf8');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const SUPPORTED_SCHEMA_VERSION = 1;

function ensureSchemaLedger(database: DatabaseSync, clock: () => Date): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  const version = row.version ?? 0;
  if (version > SUPPORTED_SCHEMA_VERSION) {
    database.close();
    throw new Error(
      `database schema version ${version} is newer than supported version ${SUPPORTED_SCHEMA_VERSION}`,
    );
  }
  return version;
}

function recordSchemaVersion(database: DatabaseSync, clock: () => Date): void {
  database.prepare(`
    INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)
  `).run(SUPPORTED_SCHEMA_VERSION, clock().toISOString());
}

function ensureRuntimeIdentity(
  database: DatabaseSync,
  identity: RuntimeIdentity,
  clock: () => Date,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS duckworth_runtime_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lane TEXT NOT NULL CHECK (lane IN ('live', 'sandbox', 'api-test')),
      instance_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `);
  const existing = database.prepare(`
    SELECT lane, instance_id FROM duckworth_runtime_identity WHERE id = 1
  `).get() as { lane: RuntimeIdentity['lane']; instance_id: string } | undefined;
  if (existing && (existing.lane !== identity.lane || existing.instance_id !== identity.instanceId)) {
    throw new Error('database runtime identity does not match configured lane');
  }
  if (!existing) {
    database.prepare(`
      INSERT INTO duckworth_runtime_identity (id, lane, instance_id, created_at)
      VALUES (1, ?, ?, ?)
    `).run(identity.lane, identity.instanceId, clock().toISOString());
  }
}

function factsForResult(envelope: BrainCaptureEnvelope, result: BrainResult): BrainOutputFacts {
  const saved = result.operations.flatMap((operation, index) => operation.kind === 'create'
    ? [{ itemId: `brain:${envelope.inputId}:${index}`, item: operation.item }]
    : []);
  const merged = result.operations.flatMap((operation) => (
    operation.kind === 'merge' || operation.kind === 'correct'
      ? [{ itemId: operation.targetItemId, item: operation.item }]
      : []
  ));
  const drafts = result.operations.flatMap((operation, index) => operation.kind === 'draft'
    ? [{ ...operation.draft, draftId: `brain:${envelope.inputId}:draft:${index}` }]
    : []);
  return { saved, merged, drafts, undo: [], warnings: result.warnings };
}

interface LegacyCaptureAuditOperation {
  kind: BrainOperation['kind'];
  itemName?: string;
  quantity?: number | null;
  unit?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  targetItemId?: string;
  draftText?: string;
  reasonCode?: string;
}

interface LegacyCaptureAudit {
  inputId: string;
  text: string;
  engineVersion: string;
  runtimeVersions: Readonly<Record<string, string>>;
  operations: readonly LegacyCaptureAuditOperation[];
  warnings: readonly BrainResult['warnings'][number][];
}

function summarizeLegacyCapture(stored: StoredBrainCapture): LegacyCaptureAudit {
  return {
    inputId: stored.envelope.inputId,
    text: stored.envelope.text,
    engineVersion: stored.result.engineVersion,
    runtimeVersions: stored.result.runtimeVersions,
    operations: stored.result.operations.map((operation) => {
      if ('item' in operation) {
        return {
          kind: operation.kind,
          itemName: operation.item.itemName.value,
          quantity: operation.item.requestedCount.value,
          unit: operation.item.requestedUnitId.value,
          packageSize: operation.item.packageMeasure.value?.value ?? null,
          packageUnit: operation.item.packageMeasure.value?.unitId ?? null,
          categoryId: operation.item.categoryId.value,
          brandId: operation.item.brandId.value,
          ...(operation.kind === 'merge' || operation.kind === 'correct'
            ? { targetItemId: operation.targetItemId }
            : {}),
        };
      }
      return {
        kind: operation.kind,
        draftText: operation.draft.text,
        reasonCode: operation.draft.reasonCode,
      };
    }),
    warnings: stored.result.warnings,
  };
}

function brainResponse(envelope: BrainCaptureEnvelope, result: BrainResult, facts?: BrainOutputFacts): {
  result: BrainResult;
  facts: BrainOutputFacts;
  provenance: { envelope: BrainCaptureEnvelope };
} {
  return { result, facts: facts ?? factsForResult(envelope, result), provenance: { envelope } };
}

function normalizeOnlineLookupPhrase(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-IN');
}
