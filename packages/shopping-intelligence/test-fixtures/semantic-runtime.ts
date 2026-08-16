import coreSource from '../../../catalog/source/semantic/core.json';
import countrySource from '../../../catalog/source/semantic/IN.json';
import localeSource from '../../../catalog/source/semantic/en-IN.json';
import {
  compileSemanticRuntime,
  type SemanticRuntime,
  type ValidatedSemanticLayer,
} from '../src/semantic-runtime.js';

export function semanticRuntimeFixture(
  transform?: (layers: ValidatedSemanticLayer[]) => void,
): SemanticRuntime {
  const layers = structuredClone([
    coreSource,
    localeSource,
    countrySource,
  ]) as unknown as ValidatedSemanticLayer[];
  transform?.(layers);
  return compileSemanticRuntime(layers);
}
