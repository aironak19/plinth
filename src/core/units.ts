/**
 * Units & formatting.
 *
 * The building model stores every length in millimetres. Nothing in the engine
 * assumes imperial or metric: display and input go through this module only.
 */

export type UnitSystem = 'imperial' | 'metric';
export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD';

export const MM_PER_FT = 304.8;
export const MM_PER_IN = 25.4;
export const MM2_PER_SQFT = MM_PER_FT * MM_PER_FT;
export const MM2_PER_M2 = 1_000_000;

export const ft = (feet: number, inches = 0) => feet * MM_PER_FT + inches * MM_PER_IN;
export const inch = (inches: number) => inches * MM_PER_IN;
export const m = (metres: number) => metres * 1000;

/** Format a length for display, e.g. 3810 → `12' 6"` or `3.81 m`. */
export function formatLength(mm: number, units: UnitSystem, opts: { precision?: number; compact?: boolean } = {}): string {
  if (!Number.isFinite(mm)) return '—';
  if (units === 'metric') {
    const metres = mm / 1000;
    const p = opts.precision ?? (Math.abs(metres) < 10 ? 2 : 1);
    return `${trimZeros(metres.toFixed(p))} m`;
  }
  const sign = mm < 0 ? '-' : '';
  const totalIn = Math.round(Math.abs(mm) / MM_PER_IN * 2) / 2; // nearest ½"
  let feet = Math.floor(totalIn / 12);
  let inches = totalIn - feet * 12;
  if (inches >= 12) { feet += 1; inches -= 12; }
  const inStr = Number.isInteger(inches) ? `${inches}` : `${Math.floor(inches)}½`;
  if (opts.compact && inches === 0) return `${sign}${feet}'`;
  if (feet === 0) return `${sign}${inStr}"`;
  return `${sign}${feet}' ${inStr}"`;
}

/** Wall thickness and other small dimensions read better in inches / mm. */
export function formatSmall(mm: number, units: UnitSystem): string {
  if (units === 'metric') return `${Math.round(mm)} mm`;
  const inches = Math.round(mm / MM_PER_IN * 2) / 2;
  return `${Number.isInteger(inches) ? inches : inches.toFixed(1)}"`;
}

export function formatArea(mm2: number, units: UnitSystem, opts: { precision?: number } = {}): string {
  if (!Number.isFinite(mm2)) return '—';
  if (units === 'metric') {
    const v = mm2 / MM2_PER_M2;
    return `${groupDigits(v, opts.precision ?? (v < 100 ? 1 : 0))} m²`;
  }
  const v = mm2 / MM2_PER_SQFT;
  return `${groupDigits(v, opts.precision ?? 0)} sq ft`;
}

export function areaValue(mm2: number, units: UnitSystem): number {
  return units === 'metric' ? mm2 / MM2_PER_M2 : mm2 / MM2_PER_SQFT;
}

export function areaUnitLabel(units: UnitSystem): string {
  return units === 'metric' ? 'm²' : 'sq ft';
}

export function lengthUnitLabel(units: UnitSystem): string {
  return units === 'metric' ? 'm' : 'ft';
}

export function formatVolume(mm3: number, units: UnitSystem): string {
  if (units === 'metric') return `${groupDigits(mm3 / 1e9, 1)} m³`;
  return `${groupDigits(mm3 / (MM_PER_FT ** 3), 0)} cu ft`;
}

/**
 * Parse a user-typed length into millimetres.
 * Accepts `12'6"`, `12' 6"`, `12ft 6in`, `12.5'`, `12.5 ft`, `9"`, `9 in`,
 * `3.8m`, `3800mm`, `380cm` and bare numbers (interpreted in the default unit).
 */
export function parseLength(input: string, units: UnitSystem): number | null {
  const s = input.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/,/g, '');
  if (!s) return null;

  const ftIn = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (ftIn) {
    const feet = parseFloat(ftIn[1]);
    const inches = ftIn[2] ? parseFloat(ftIn[2]) : 0;
    return Math.sign(feet || 1) * (Math.abs(feet) * MM_PER_FT + inches * MM_PER_IN);
  }
  const inOnly = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inOnly) return parseFloat(inOnly[1]) * MM_PER_IN;
  const metric = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|metre|meter|metres|meters)$/);
  if (metric) {
    const v = parseFloat(metric[1]);
    const u = metric[2];
    if (u === 'mm') return v;
    if (u === 'cm') return v * 10;
    return v * 1000;
  }
  const bare = s.match(/^-?\d+(?:\.\d+)?$/);
  if (bare) {
    const v = parseFloat(s);
    return units === 'metric' ? v * 1000 : v * MM_PER_FT;
  }
  return null;
}

const CURRENCY_LOCALE: Record<CurrencyCode, string> = {
  INR: 'en-IN', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', AED: 'en-AE', SGD: 'en-SG',
};
const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$',
};

/** Full currency amount, e.g. ₹14,82,000. */
export function formatMoney(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency], { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(value));
}

/** Compact amount that reads the way people in that market talk: ₹1.48 Cr, ₹4.2 lakh, $1.2M. */
export function formatMoneyCompact(value: number, currency: CurrencyCode): string {
  const sym = CURRENCY_SYMBOL[currency];
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  if (currency === 'INR') {
    if (v >= 1e7) return `${sign}${sym}${trimZeros((v / 1e7).toFixed(2))} Cr`;
    if (v >= 1e5) return `${sign}${sym}${trimZeros((v / 1e5).toFixed(1))} lakh`;
    return `${sign}${sym}${groupDigits(v, 0, 'en-IN')}`;
  }
  if (v >= 1e6) return `${sign}${sym}${trimZeros((v / 1e6).toFixed(2))}M`;
  if (v >= 1e3) return `${sign}${sym}${trimZeros((v / 1e3).toFixed(1))}k`;
  return `${sign}${sym}${Math.round(v)}`;
}

export function groupDigits(v: number, precision = 0, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: precision, minimumFractionDigits: 0 }).format(v);
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Round a millimetre value to a sensible drafting increment for the unit system. */
export function snapIncrement(units: UnitSystem): number {
  return units === 'metric' ? 50 : MM_PER_IN * 3; // 50 mm or 3"
}
