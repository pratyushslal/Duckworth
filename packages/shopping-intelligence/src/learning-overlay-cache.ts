import {
  compileTypedLearningOverlay,
  type CompiledTypedLearningOverlay,
  type TypedLearningEffect,
} from './learning-overlay.js';

export class LearningOverlayCache {
  readonly #entries = new Map<string, CompiledTypedLearningOverlay>();

  getOrCompile(
    householdId: string,
    revision: number,
    runtimeVersion: string,
    effects: readonly TypedLearningEffect[],
  ): CompiledTypedLearningOverlay {
    const key = `${householdId}:${revision}:${runtimeVersion}`;
    const cached = this.#entries.get(key);
    if (cached) return cached;
    const compiled = compileTypedLearningOverlay(householdId, revision, effects);
    this.#entries.set(key, compiled);
    return compiled;
  }

  invalidateHousehold(householdId: string): void {
    [...this.#entries.keys()]
      .filter((key) => key.startsWith(`${householdId}:`))
      .forEach((key) => this.#entries.delete(key));
  }

  clear(): void { this.#entries.clear(); }
}
