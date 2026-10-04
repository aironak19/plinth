import { describe, it, expect } from 'vitest';
import { formatLength, parseLength, formatArea, formatMoneyCompact, ft } from '@/core/units';

describe('units', () => {
  it('formats feet-inches', () => {
    expect(formatLength(ft(12, 6), 'imperial')).toBe(`12' 6"`);
    expect(formatLength(ft(14), 'imperial')).toBe(`14' 0"`);
    expect(formatLength(3810, 'metric')).toBe('3.81 m');
  });
  it('parses many notations', () => {
    expect(parseLength(`12'6"`, 'imperial')).toBeCloseTo(ft(12, 6));
    expect(parseLength('12 ft 6 in', 'imperial')).toBeCloseTo(ft(12, 6));
    expect(parseLength('9"', 'imperial')).toBeCloseTo(228.6);
    expect(parseLength('3.8m', 'imperial')).toBe(3800);
    expect(parseLength('450mm', 'metric')).toBe(450);
    expect(parseLength('14', 'imperial')).toBeCloseTo(ft(14));
    expect(parseLength('2.4', 'metric')).toBe(2400);
    expect(parseLength('abc', 'metric')).toBeNull();
  });
  it('formats area and Indian currency', () => {
    expect(formatArea(ft(18) * ft(15.5), 'imperial')).toBe('279 sq ft');
    expect(formatMoneyCompact(14_800_000, 'INR')).toBe('₹1.48 Cr');
    expect(formatMoneyCompact(420_000, 'INR')).toBe('₹4.2 lakh');
  });
});
