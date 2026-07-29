import { describe, expect, it } from 'vitest';
import { assertRealPathContained, RuntimePathError } from './path-security';

describe('assertRealPathContained', () => {
  it('rejects a junction that resolves outside its lexical root', () => {
    const resolver = {
      realpath(candidate: string) {
        if (candidate === 'C:\\owned') return 'C:\\owned';
        if (candidate === 'C:\\owned\\junction\\file.txt') return 'D:\\outside\\file.txt';
        return candidate;
      },
    };
    expect(() =>
      assertRealPathContained(
        'upload',
        'C:\\owned\\junction\\file.txt',
        ['C:\\owned'],
        resolver,
      ),
    ).toThrow(RuntimePathError);
  });
});
