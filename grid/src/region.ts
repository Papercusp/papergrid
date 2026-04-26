/**
 * Client-side region formatter for use inside grid / ui libs that can't
 * import from apps/shop. Reads the <meta name="shop-region"> tag injected
 * by Astro's Layout.astro and formats `cents` as the region's currency.
 *
 * Safe on SSR (returns USD when no document) and on non-shop consumers
 * (admin Next.js app renders grids too — there's no meta tag, falls back
 * to USD).
 */

export type Region = 'US' | 'FR' | 'CA';

const CURRENCY: Record<Region, string> = { US: 'USD', FR: 'EUR', CA: 'CAD' };
const INTL_TAG: Record<Region, string> = { US: 'en-US', FR: 'fr-FR', CA: 'en-CA' };
const TAX_INCLUSIVE: Record<Region, boolean> = { US: false, FR: true, CA: true };
const TAX_RATE: Record<Region, number> = { US: 0, FR: 0.20, CA: 0.13 };

export function getClientRegion(): Region {
  if (typeof document === 'undefined') return 'US';
  const meta = document.querySelector('meta[name="shop-region"]');
  const value = meta?.getAttribute('content');
  if (value === 'FR' || value === 'CA' || value === 'US') return value;
  return 'US';
}

export function formatCentsForRegion(cents: number, region?: Region): string {
  const r = region ?? getClientRegion();
  const rate = TAX_INCLUSIVE[r] ? TAX_RATE[r] : 0;
  const display = Math.round(cents * (1 + rate));
  try {
    return new Intl.NumberFormat(INTL_TAG[r], {
      style: 'currency',
      currency: CURRENCY[r],
      maximumFractionDigits: 2,
    }).format(display / 100);
  } catch {
    return `$${(display / 100).toFixed(2)}`;
  }
}
