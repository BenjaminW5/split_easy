/**
 * Money is integer cents everywhere (API and database) so that splitting a
 * bill never accumulates floating-point error. Convert to dollars only for
 * display, here.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
