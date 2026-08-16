import { createHash, verify } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  compileSemanticRuntime,
  type SemanticRuntime,
  type ValidatedSemanticLayer,
} from '@duckworth/shopping-intelligence';

export interface SemanticRuntimeArtifact {
  schemaVersion: 2;
  locale: string;
  countryCode: string;
  fallbackLocales: readonly string[];
  publisher: string;
  layers: readonly ValidatedSemanticLayer[];
  checksum: string;
  signature?: string;
}

export interface RuntimeSelection {
  runtime: SemanticRuntime;
  resolvedLocale: string;
  resolvedCountryCode: string;
  fallbackChain: readonly string[];
  layers: readonly ValidatedSemanticLayer[];
}

export interface SemanticRuntimeRegistryOptions {
  bundledRoot: string;
  statePath?: string;
  trustedPublishers?: Readonly<Record<string, string>>;
}

interface ActiveRuntime {
  artifact: SemanticRuntimeArtifact;
  runtime: SemanticRuntime;
}

export class SemanticRuntimeRegistry {
  private active: ActiveRuntime | null = null;

  private constructor(private readonly options: SemanticRuntimeRegistryOptions) {}

  static async open(options: SemanticRuntimeRegistryOptions): Promise<SemanticRuntimeRegistry> {
    const registry = new SemanticRuntimeRegistry(options);
    if (options.statePath) {
      try {
        const artifact = JSON.parse(await readFile(options.statePath, 'utf8')) as SemanticRuntimeArtifact;
        registry.active = registry.compileVerified(artifact, options.statePath, true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return registry;
  }

  resolve(locale: string, countryCode: string): RuntimeSelection {
    const active = this.active;
    if (!active || active.artifact.countryCode !== countryCode) {
      throw new Error(`No active semantic runtime for ${locale}/${countryCode}`);
    }
    if (active.artifact.locale === locale) {
      return {
        runtime: active.runtime,
        resolvedLocale: locale,
        resolvedCountryCode: countryCode,
        fallbackChain: [],
        layers: active.artifact.layers,
      };
    }
    if (active.artifact.fallbackLocales.includes(locale)) {
      return {
        runtime: active.runtime,
        resolvedLocale: active.artifact.locale,
        resolvedCountryCode: countryCode,
        fallbackChain: [locale, active.artifact.locale],
        layers: active.artifact.layers,
      };
    }
    throw new Error(`No active semantic runtime for ${locale}/${countryCode}`);
  }

  async activate(artifactPath: string): Promise<void> {
    const absolutePath = resolve(artifactPath);
    const artifact = JSON.parse(await readFile(absolutePath, 'utf8')) as SemanticRuntimeArtifact;
    const candidate = this.compileVerified(artifact, absolutePath, false);
    if (this.options.statePath) await this.persistAtomically(artifact);
    this.active = candidate;
  }

  private compileVerified(
    artifact: SemanticRuntimeArtifact,
    artifactPath: string,
    isPersistedState: boolean,
  ): ActiveRuntime {
    if (artifact.schemaVersion !== 2) throw new Error('Incompatible semantic runtime artifact schema');
    if (!artifact.locale?.trim() || !artifact.countryCode?.trim() || !artifact.publisher?.trim()) {
      throw new Error('Semantic runtime artifact metadata is incomplete');
    }
    const content = canonicalArtifactContent(artifact);
    const checksum = createHash('sha256').update(content).digest('hex');
    if (checksum !== artifact.checksum) throw new Error('Semantic runtime artifact checksum mismatch');

    const isBundled = isWithin(this.options.bundledRoot, artifactPath);
    if (!isBundled && !isPersistedState) {
      const publicKey = this.options.trustedPublishers?.[artifact.publisher];
      if (!publicKey || !artifact.signature) throw new Error('Untrusted semantic runtime publisher or missing signature');
      if (!verify('sha256', Buffer.from(content), publicKey, Buffer.from(artifact.signature, 'base64'))) {
        throw new Error('Invalid semantic runtime publisher signature');
      }
    }
    const runtime = compileSemanticRuntime(artifact.layers);
    const localeLayer = artifact.layers.find((layer) => layer.kind === 'locale');
    const countryLayer = artifact.layers.find((layer) => layer.kind === 'country');
    if (localeLayer?.locale !== artifact.locale || countryLayer?.countryCode !== artifact.countryCode) {
      throw new Error('Semantic runtime locale/country metadata does not match its layers');
    }
    if (!countryLayer.locales.includes(artifact.locale)) {
      throw new Error('Semantic runtime locale is incompatible with its country');
    }
    validateAliasCollisions(artifact.layers);
    return { artifact: freezeArtifact(artifact), runtime };
  }

  private async persistAtomically(artifact: SemanticRuntimeArtifact): Promise<void> {
    const statePath = resolve(this.options.statePath!);
    const temporaryPath = `${statePath}.next`;
    await import('node:fs/promises').then(({ mkdir }) => mkdir(dirname(statePath), { recursive: true }));
    try {
      await writeFile(temporaryPath, JSON.stringify(artifact), 'utf8');
      await rename(temporaryPath, statePath);
    } catch (error) {
      await import('node:fs/promises').then(({ rm }) => rm(temporaryPath, { force: true }));
      throw error;
    }
  }
}

function validateAliasCollisions(layers: readonly ValidatedSemanticLayer[]): void {
  for (const layer of layers) {
    const groups: Array<readonly { alias: string; target: string }[]> = [];
    if (layer.kind === 'locale') {
      groups.push(layer.conceptAliases.map(({ alias, conceptId }) => ({ alias, target: conceptId })));
      groups.push(layer.unitAliases.map(({ alias, unitId }) => ({ alias, target: unitId })));
    }
    if (layer.kind === 'household') {
      groups.push(layer.conceptAliases.map(({ alias, conceptId }) => ({ alias, target: conceptId })));
      groups.push(layer.brandAliases.map(({ alias, brandId }) => ({ alias, target: brandId })));
    }
    for (const entries of groups) {
      const aliases = new Map<string, string>();
      for (const entry of entries) {
        const normalized = entry.alias.normalize('NFKC').trim().toLocaleLowerCase('und');
        const existing = aliases.get(normalized);
        if (existing && existing !== entry.target) {
          throw new Error(`Semantic runtime alias collision for ${entry.alias}`);
        }
        aliases.set(normalized, entry.target);
      }
    }
  }
}

function canonicalArtifactContent(artifact: SemanticRuntimeArtifact): string {
  const { checksum: _checksum, signature: _signature, ...unsigned } = artifact;
  return JSON.stringify(unsigned);
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

function freezeArtifact(artifact: SemanticRuntimeArtifact): SemanticRuntimeArtifact {
  artifact.layers.forEach((layer) => Object.freeze(layer));
  return Object.freeze({
    ...artifact,
    fallbackLocales: Object.freeze([...artifact.fallbackLocales]),
    layers: Object.freeze([...artifact.layers]),
  });
}
