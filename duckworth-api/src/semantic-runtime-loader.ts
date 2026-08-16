import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compileSemanticRuntime,
  type SemanticRuntime,
  type ValidatedSemanticLayer,
} from '@duckworth/shopping-intelligence';

export async function loadSemanticRuntime(
  root: string,
  locale?: string,
  countryCode?: string,
): Promise<SemanticRuntime> {
  return (await loadSemanticRuntimeSelection(root, locale, countryCode)).runtime;
}

export async function loadSemanticRuntimeSelection(
  root: string,
  locale?: string,
  countryCode?: string,
): Promise<{
  runtime: SemanticRuntime;
  resolvedLocale: string;
  resolvedCountryCode: string;
  layers: readonly ValidatedSemanticLayer[];
}> {
  const resolvedLocale = locale ?? await firstDirectory(resolve(root, 'semantic', 'locales'));
  const resolvedCountryCode = countryCode ?? await firstDirectory(resolve(root, 'semantic', 'countries'));
  const layerPaths = await Promise.all([
    newestJson(resolve(root, 'semantic', 'core')),
    newestJson(resolve(root, 'semantic', 'locales', resolvedLocale)),
    newestJson(resolve(root, 'semantic', 'countries', resolvedCountryCode)),
  ]);
  const layers = await Promise.all(layerPaths.map(async (path) => (
    JSON.parse(await readFile(path, 'utf8')) as ValidatedSemanticLayer
  )));
  return {
    runtime: compileSemanticRuntime(layers),
    resolvedLocale,
    resolvedCountryCode,
    layers,
  };
}

async function newestJson(directory: string): Promise<string> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => right.localeCompare(left));
  if (!names[0]) throw new Error(`No semantic artifact exists in ${directory}`);
  return resolve(directory, names[0]);
}

async function firstDirectory(directory: string): Promise<string> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (!entries[0]) throw new Error(`No semantic pack directory exists in ${directory}`);
  return entries[0];
}
