import { describe, expect, test } from 'vitest';
import { secondsToSrtTime } from '../utils/srt';

describe('secondsToSrtTime', () => {
  test('formats decimals correctly', () => {
    expect(secondsToSrtTime(65.349)).toBe('00:01:05,349');
  });

  test('floors negative values to zero', () => {
    expect(secondsToSrtTime(-1)).toBe('00:00:00,000');
  });
});
