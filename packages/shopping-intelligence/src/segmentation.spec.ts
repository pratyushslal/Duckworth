import coreSource from '../../../catalog/source/semantic/core.json';
import countrySource from '../../../catalog/source/semantic/IN.json';
import localeSource from '../../../catalog/source/semantic/en-IN.json';
import type { ValidatedSemanticLayer } from './semantic-runtime.js';

describe('source-preserving segmentation', () => {
  it('segments clear clauses exactly once without splitting protected titles or numeric identities', async () => {
    const { compileSemanticRuntime, segmentCapture } = await import('./index.js');
    const runtime = compileSemanticRuntime([
      coreSource,
      localeSource,
      countrySource,
    ] as unknown as ValidatedSemanticLayer[]);
    const text = 'Add Apple iPhone and 4 milk pouches of 1 litre each';

    expect(segmentCapture(text, runtime)).toEqual([
      { text: 'Apple iPhone', start: 4, end: 16 },
      { text: '4 milk pouches of 1 litre each', start: 21, end: text.length },
    ]);
    expect(segmentCapture('Of Mice and Men', runtime)).toEqual([
      { text: 'Of Mice and Men', start: 0, end: 15 },
    ]);
    expect(segmentCapture('Formula 1', runtime)).toEqual([
      { text: 'Formula 1', start: 0, end: 9 },
    ]);
  });
});
