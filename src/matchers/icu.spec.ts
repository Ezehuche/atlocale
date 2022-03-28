import { matchIcu } from './icu';
import { replaceInterpolations } from '.';

describe('ICU replacer', () => {
  it('should not error when no placeholders are present', () => {
    const { clean, replacements } = replaceInterpolations(
      'this is a test sentence',
      matchIcu,
    );
    expect(clean).toEqual('this is a test sentence');
    expect(replacements).toEqual([]);
  });

  it('should replace ICU syntax with placeholders', () => {
    const { clean, replacements } = replaceInterpolations(
      'this is a {test} sentence with {multiple} placeholders',
      matchIcu,
    );
    expect(clean).toEqual(
      'this is a <span translate="no">0</span> sentence with <span translate="no">1</span> placeholders',
    );
    expect(replacements).toEqual([
      { from: '{test}', to: '<span translate="no">0</span>' },
      { from: '{multiple}', to: '<span translate="no">1</span>' },
    ]);
  });

  it('should replace ICU syntax with placeholders at the end', () => {
    const { clean, replacements } = replaceInterpolations(
      'this is a {test} sentence with {placeholders}',
      matchIcu,
    );
    expect(clean).toEqual(
      'this is a <span translate="no">0</span> sentence with <span translate="no">1</span>',
    );
    expect(replacements).toEqual([
      { from: '{test}', to: '<span translate="no">0</span>' },
      { from: '{placeholders}', to: '<span translate="no">1</span>' },
    ]);
  });
});
