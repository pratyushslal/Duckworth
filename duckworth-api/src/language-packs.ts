import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface CountryManifest {
  schemaVersion: number;
  checksum: string;
  countryCode: string;
  defaultLocale: string;
  bridgeLocales: string[];
  locales: Array<{
    locale: string;
    version: string;
    fallbacks: string[];
    artifactPath: string;
    checksum: string;
  }>;
  regionalProducts: Array<{
    countryCode: string;
    version: string;
    artifactPath: string;
    checksum: string;
  }>;
}

const checksumSchema = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } as const;
const problemSchema = {
  type: 'object',
  properties: { error: { type: 'string', const: 'language_pack_not_found' } },
  required: ['error'],
} as const;
const manifestLocaleSchema = {
  type: 'object',
  properties: {
    locale: { type: 'string' },
    version: { type: 'string' },
    fallbacks: { type: 'array', items: { type: 'string' } },
    artifactPath: { type: 'string' },
    checksum: checksumSchema,
  },
  required: ['locale', 'version', 'fallbacks', 'artifactPath', 'checksum'],
} as const;
const regionalProductDescriptorSchema = {
  type: 'object',
  properties: {
    countryCode: { type: 'string' },
    version: { type: 'string' },
    artifactPath: { type: 'string' },
    checksum: checksumSchema,
  },
  required: ['countryCode', 'version', 'artifactPath', 'checksum'],
} as const;
const manifestSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    checksum: checksumSchema,
    countryCode: { type: 'string' },
    defaultLocale: { type: 'string' },
    bridgeLocales: { type: 'array', items: { type: 'string' } },
    locales: { type: 'array', items: manifestLocaleSchema },
    regionalProducts: { type: 'array', items: regionalProductDescriptorSchema },
  },
  required: ['schemaVersion', 'checksum', 'countryCode', 'defaultLocale', 'bridgeLocales', 'locales', 'regionalProducts'],
} as const;
const unitSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    primary: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'primary', 'aliases'],
} as const;
const itemSchema = {
  type: 'object',
  properties: {
    ...unitSchema.properties,
    category: { type: 'string' },
    compatibleUnits: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'primary', 'aliases', 'category', 'compatibleUnits'],
} as const;
const artifactSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    checksum: checksumSchema,
    locale: { type: 'string' },
    version: { type: 'string' },
    fallbacks: { type: 'array', items: { type: 'string' } },
    ui: { type: 'object', additionalProperties: { type: 'string' } },
    items: { type: 'array', items: itemSchema },
    units: { type: 'array', items: unitSchema },
  },
  required: ['schemaVersion', 'checksum', 'locale', 'version', 'fallbacks', 'ui', 'items', 'units'],
} as const;
const regionalProductSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    primary: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    brandId: { type: 'string' },
    brandName: { type: 'string' },
    conceptId: { type: 'string' },
    compatibleContainerUnits: { type: 'array', items: { type: 'string' } },
    compatiblePackageUnits: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'primary', 'aliases', 'brandId', 'brandName', 'conceptId', 'compatibleContainerUnits', 'compatiblePackageUnits'],
} as const;
const regionalProductArtifactSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    checksum: checksumSchema,
    countryCode: { type: 'string' },
    version: { type: 'string' },
    products: { type: 'array', items: regionalProductSchema },
  },
  required: ['schemaVersion', 'checksum', 'countryCode', 'version', 'products'],
} as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isLocaleArtifact(value: unknown, locale: string, version: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  if (artifact.schemaVersion !== 1 || artifact.locale !== locale || artifact.version !== version
    || typeof artifact.checksum !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(artifact.checksum)
    || !isStringArray(artifact.fallbacks)
    || !artifact.ui || typeof artifact.ui !== 'object' || Array.isArray(artifact.ui)
    || !Object.values(artifact.ui).every((entry) => typeof entry === 'string')
    || !Array.isArray(artifact.items) || !Array.isArray(artifact.units)) return false;
  const validVocabulary = (entry: unknown, item: boolean) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return typeof record.id === 'string'
      && typeof record.primary === 'string'
      && isStringArray(record.aliases)
      && (!item || (typeof record.category === 'string' && isStringArray(record.compatibleUnits)));
  };
  return artifact.items.every((entry) => validVocabulary(entry, true))
    && artifact.units.every((entry) => validVocabulary(entry, false));
}

function isRegionalProductArtifact(value: unknown, countryCode: string, version: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  if (artifact.schemaVersion !== 1 || artifact.countryCode !== countryCode || artifact.version !== version
    || typeof artifact.checksum !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(artifact.checksum)
    || !Array.isArray(artifact.products)) return false;
  return artifact.products.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const product = entry as Record<string, unknown>;
    return typeof product.id === 'string' && typeof product.primary === 'string'
      && typeof product.brandId === 'string' && typeof product.conceptId === 'string'
      && isStringArray(product.aliases) && isStringArray(product.compatibleContainerUnits)
      && isStringArray(product.compatiblePackageUnits);
  });
}

export function registerLanguagePackRoutes(app: FastifyInstance, rootPath: string): void {
  app.get<{ Params: { countryCode: string } }>(
    '/api/v1/language-packs/countries/:countryCode/manifest',
    {
      schema: {
        tags: ['language-packs'],
        params: {
          type: 'object',
          properties: { countryCode: { type: 'string' } },
          required: ['countryCode'],
        },
        response: { 200: manifestSchema, 404: problemSchema },
      },
    },
    async (request, reply) => {
      if (!/^[A-Z]{2}$/u.test(request.params.countryCode)) {
        return reply.code(404).send({ error: 'language_pack_not_found' });
      }
      try {
        const content = readFileSync(
          join(rootPath, 'countries', request.params.countryCode, 'manifest.json'),
          'utf8',
        );
        const manifest = JSON.parse(content) as CountryManifest;
        reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        const etag = `"${manifest.checksum}"`;
        reply.header('ETag', etag);
        if (request.headers['if-none-match'] === etag) return reply.code(304).send();
        return reply.send(manifest);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: 'language_pack_not_found' });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { locale: string; version: string } }>(
    '/api/v1/language-packs/:locale/:version',
    {
      schema: {
        tags: ['language-packs'],
        params: {
          type: 'object',
          properties: {
            locale: { type: 'string' },
            version: { type: 'string' },
          },
          required: ['locale', 'version'],
        },
        response: { 200: artifactSchema, 404: problemSchema },
      },
    },
    async (request, reply) => {
      const { locale, version } = request.params;
      if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})+$/u.test(locale)
        || !/^\d{4}\.\d{2}\.\d{2}\.\d+$/u.test(version)) {
        return reply.code(404).send({ error: 'language_pack_not_found' });
      }
      try {
        const content = readFileSync(join(rootPath, 'packs', locale, `${version}.json`), 'utf8');
        if (!isLocaleArtifact(JSON.parse(content) as unknown, locale, version)) {
          throw new Error('Invalid language pack artifact');
        }
        const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;
        reply.header('Content-Type', 'application/json; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        const etag = `"${checksum}"`;
        reply.header('ETag', etag);
        if (request.headers['if-none-match'] === etag) return reply.code(304).send();
        return reply.send(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: 'language_pack_not_found' });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { countryCode: string; version: string } }>(
    '/api/v1/regional-product-packs/:countryCode/:version',
    {
      schema: {
        tags: ['language-packs'],
        params: {
          type: 'object',
          properties: { countryCode: { type: 'string' }, version: { type: 'string' } },
          required: ['countryCode', 'version'],
        },
        response: { 200: regionalProductArtifactSchema, 404: problemSchema },
      },
    },
    async (request, reply) => {
      const { countryCode, version } = request.params;
      if (!/^[A-Z]{2}$/u.test(countryCode) || !/^\d{4}\.\d{2}\.\d{2}\.\d+$/u.test(version)) {
        return reply.code(404).send({ error: 'language_pack_not_found' });
      }
      try {
        const content = readFileSync(join(rootPath, 'regional-products', countryCode, `${version}.json`), 'utf8');
        if (!isRegionalProductArtifact(JSON.parse(content) as unknown, countryCode, version)) {
          throw new Error('Invalid regional product artifact');
        }
        const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;
        reply.header('Content-Type', 'application/json; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        const etag = `"${checksum}"`;
        reply.header('ETag', etag);
        if (request.headers['if-none-match'] === etag) return reply.code(304).send();
        return reply.send(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: 'language_pack_not_found' });
        }
        throw error;
      }
    },
  );
}
