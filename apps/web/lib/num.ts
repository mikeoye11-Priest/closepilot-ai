// Hardened signed-value parsing for accounting figures.
//
// The previous per-module parser silently returned 0 for several real-world
// formats — trailing minus ("1234-"), unicode minus ("−1234") and CR/DR-suffixed
// balances ("1,234.00 CR") — which drops a genuine balance to zero and quietly
// breaks the accounting equation. This is the single, tested parser that handles
// the sign conventions accounting exports actually use.

// Parse a monetary/quantity string to a signed number. Handles:
//   - currency symbols (£ $ €), thousands separators, whitespace
//   - parentheses negatives           "(1,234)"      → -1234
//   - trailing minus                  "1234-"        → -1234
//   - unicode minus (U+2212)          "−1234"        → -1234
//   - CR/DR (credit/debit) markers    "1,234 CR"     → -1234, "1,234 DR" → 1234
// An unparseable or empty value returns 0.
export function signedNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const s = raw.replace(/−/g, "-"); // normalise unicode minus to ASCII
  const upper = s.toUpperCase();
  // CR/DR as a standalone token or adjacent to the digits ("196000CR", "1,234 CR").
  const isCredit = /(^|[^A-Z])CR([^A-Z]|$)/.test(upper) || /CREDIT/.test(upper);
  const isDebit = /(^|[^A-Z])DR([^A-Z]|$)/.test(upper) || /DEBIT/.test(upper);
  const parenNeg = /^\(.*\)$/.test(s);

  // Keep only digits, decimal point and minus signs — drops currency, commas,
  // spaces, and the CR/DR letters (their sign was captured above).
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  const trailingNeg = /-$/.test(cleaned);
  const leadingNeg = /^-/.test(cleaned);
  const magnitude = Number(cleaned.replace(/-/g, ""));
  if (!Number.isFinite(magnitude)) return 0;

  let negative = parenNeg || trailingNeg || leadingNeg;
  if (isCredit && !isDebit) negative = true; // credit balances are negative
  if (isDebit && !isCredit) negative = false; // debit balances are positive
  return negative ? -magnitude : magnitude;
}
