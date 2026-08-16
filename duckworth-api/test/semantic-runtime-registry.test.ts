import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ValidatedSemanticLayer } from '@duckworth/shopping-intelligence';
import { SemanticRuntimeRegistry, type SemanticRuntimeArtifact } from '../src/semantic-runtime-registry.js';

function layers(): ValidatedSemanticLayer[] {
  const root = resolve(import.meta.dirname, '../../catalog/source/semantic');
  return ['core.json', 'en-IN.json', 'IN.json'].map((name) => (
    JSON.parse(readFileSync(join(root, name), 'utf8')) as ValidatedSemanticLayer
  ));
}

function artifact(overrides: Partial<SemanticRuntimeArtifact> = {}): SemanticRuntimeArtifact {
  const unsigned = {
    schemaVersion: 2 as const,
    locale: 'en-IN',
    countryCode: 'IN',
    fallbackLocales: ['en'],
    publisher: 'duckworth-bundled',
    layers: layers(),
    ...overrides,
  };
  const checksum = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  return { ...unsigned, checksum };
}

describe('semantic runtime registry', () => {
  it('activates atomically, resolves fallback, survives restart, and rolls back rejected bundles', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-runtime-'));
    const bundledRoot = join(directory, 'bundled');
    const statePath = join(directory, 'active-runtime.json');
    const bundledPath = join(bundledRoot, 'runtime.json');
    const badPath = join(directory, 'bad.json');
    const untrustedPath = join(directory, 'untrusted.json');
    try {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(bundledRoot, { recursive: true }));
      writeFileSync(bundledPath, JSON.stringify(artifact()), 'utf8');
      const registry = await SemanticRuntimeRegistry.open({ bundledRoot, statePath });

      await registry.activate(bundledPath);
      expect(registry.resolve('en-IN', 'IN')).toMatchObject({ resolvedLocale: 'en-IN', resolvedCountryCode: 'IN', fallbackChain: [] });
      expect(registry.resolve('en', 'IN')).toMatchObject({ resolvedLocale: 'en-IN', fallbackChain: ['en', 'en-IN'] });
      const activeVersions = registry.resolve('en-IN', 'IN').runtime.versions;

      writeFileSync(badPath, JSON.stringify({ ...artifact(), checksum: 'bad-checksum' }), 'utf8');
      await expect(registry.activate(badPath)).rejects.toThrow(/checksum/i);
      expect(registry.resolve('en-IN', 'IN').runtime.versions).toEqual(activeVersions);

      writeFileSync(untrustedPath, JSON.stringify(artifact({ publisher: 'unknown-publisher' })), 'utf8');
      await expect(registry.activate(untrustedPath)).rejects.toThrow(/publisher|signature/i);
      expect(registry.resolve('en-IN', 'IN').runtime.versions).toEqual(activeVersions);

      const restarted = await SemanticRuntimeRegistry.open({ bundledRoot, statePath });
      expect(restarted.resolve('en-IN', 'IN').runtime.versions).toEqual(activeVersions);
      expect(() => restarted.resolve('fr-FR', 'FR')).toThrow(/runtime/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects incompatible schemas, locale/country mismatches, and alias collisions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-runtime-invalid-'));
    const bundledRoot = join(directory, 'bundled');
    try {
      mkdirSync(bundledRoot, { recursive: true });
      const registry = await SemanticRuntimeRegistry.open({ bundledRoot });

      const schemaPath = join(bundledRoot, 'schema.json');
      writeFileSync(schemaPath, JSON.stringify({ ...artifact(), schemaVersion: 3 }), 'utf8');
      await expect(registry.activate(schemaPath)).rejects.toThrow(/schema/i);

      const mismatchPath = join(bundledRoot, 'mismatch.json');
      writeFileSync(mismatchPath, JSON.stringify(artifact({ countryCode: 'ZZ' })), 'utf8');
      await expect(registry.activate(mismatchPath)).rejects.toThrow(/metadata|compatible/i);

      const collidingLayers = layers();
      const localeLayer = collidingLayers.find((layer) => layer.kind === 'locale')!;
      if (localeLayer.kind !== 'locale') throw new Error('locale fixture missing');
      collidingLayers[1] = {
        ...localeLayer,
        conceptAliases: [
          ...localeLayer.conceptAliases,
          { alias: 'bread', conceptId: 'grocery.milk.dairy' },
        ],
      };
      const collisionPath = join(bundledRoot, 'collision.json');
      writeFileSync(collisionPath, JSON.stringify(artifact({ layers: collidingLayers })), 'utf8');
      await expect(registry.activate(collisionPath)).rejects.toThrow(/collision/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the last-known-good runtime when atomic persistence is interrupted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-runtime-interrupted-'));
    const bundledRoot = join(directory, 'bundled');
    const statePath = join(directory, 'active-runtime.json');
    const firstPath = join(bundledRoot, 'first.json');
    const secondPath = join(bundledRoot, 'second.json');
    try {
      mkdirSync(bundledRoot, { recursive: true });
      writeFileSync(firstPath, JSON.stringify(artifact()), 'utf8');
      const registry = await SemanticRuntimeRegistry.open({ bundledRoot, statePath });
      await registry.activate(firstPath);
      const originalVersions = registry.resolve('en-IN', 'IN').runtime.versions;

      const changedLayers = layers();
      changedLayers[0] = { ...changedLayers[0], version: '2026.08.12.interrupted' };
      writeFileSync(secondPath, JSON.stringify(artifact({ layers: changedLayers })), 'utf8');
      rmSync(statePath);
      mkdirSync(statePath);

      await expect(registry.activate(secondPath)).rejects.toThrow();
      expect(registry.resolve('en-IN', 'IN').runtime.versions).toEqual(originalVersions);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
