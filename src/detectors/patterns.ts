/**
 * Everything PayFuzz uses to decide "this file touches money" and "this identifier holds money".
 *
 * Detection is heuristic on purpose: it must work on any codebase without configuration, and the
 * `.payfuzz.yml` `payment_paths` setting exists to correct it. Nothing here reads credentials.
 */

/** Extensions PayFuzz can parse today (Python parsing is a post-MVP phase). */
export const SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
];

/** Directories that never contain the user's own payment logic. */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  'venv',
  'virtualenv',
  '__pycache__',
  'tmp',
  'temp',
  'fixtures',
  'generated',
]);

const PAYMENT_NAME_PATTERN =
  /(payment|checkout|billing|invoice|wallet|ledger|transaction|transfer|refund|payout|stripe|subscription|order|cart|cashier|balance|credit|charge|dispute|reconcil|accounting|subscription)/i;

const PAYMENT_PATH_PATTERN =
  /(^|\/)(payments?|pay|billing|checkout|wallet|ledger|transactions?|invoices?|stripe|subscriptions?|payouts?|refunds?|orders?|accounting|finance)(\/|$)/i;

const MONEY_NAME_PATTERN =
  /(amount|price|cost|total|subtotal|balance|fee|tax|charge|refund|payout|revenue|payment|invoice|wallet|ledger|money|cash|credit|debit|discount|tip|deposit|withdraw|salary)/i;

/** Identifiers that are money *in integer minor units* carry no float risk. */
const INTEGER_MONEY_PATTERN =
  /(cents|minorunits?|minor|satoshis?|sats|wei|gwei|micros?|paisa|paise|kobo|halalas|basispoints)/i;

export interface ContentMarker {
  pattern: RegExp;
  reason: string;
}

/** One match is enough: these APIs only exist in payment code. */
export const STRONG_CONTENT_MARKERS: readonly ContentMarker[] = [
  {
    pattern: /from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)|new\s+Stripe\s*\(/,
    reason: 'uses the Stripe SDK',
  },
  {
    pattern: /\b(paymentIntent|payment_intent|setupIntent|setup_intent)\b/,
    reason: 'Stripe PaymentIntent API',
  },
  {
    pattern: /\.(charges|refunds|transfers|paymentIntents|payouts)\.(create|retrieve|capture|confirm)/,
    reason: 'payment provider API call',
  },
  {
    pattern: /\b(checkout|billing)\.sessions\.create\b/,
    reason: 'checkout session creation',
  },
  {
    pattern: /from\s+['"](razorpay|@paypal\/|@paddle\/|@lemonsqueezy\/|coinbase-commerce)/,
    reason: 'payment provider SDK',
  },
  {
    pattern: /\b(ethers|viem|web3|@solana\/web3\.js|bitcoinjs-lib)\b/,
    reason: 'blockchain client',
  },
];

/** Two matches needed: these words appear in plenty of non-payment code. */
export const WEAK_CONTENT_MARKERS: readonly ContentMarker[] = [
  { pattern: /\bamount\b/i, reason: 'amount handling' },
  { pattern: /\bcurrency\b/i, reason: 'currency handling' },
  { pattern: /\bbalance\b/i, reason: 'balance handling' },
  { pattern: /\bwebhook\b/i, reason: 'webhook handling' },
  { pattern: /\binvoice\b/i, reason: 'invoice handling' },
  { pattern: /\bsubscription\b/i, reason: 'subscription handling' },
  { pattern: /toFixed\(\s*2\s*\)/, reason: 'money formatting' },
  { pattern: /\bcharge\b/i, reason: 'charge handling' },
];

export function isSourcePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return SOURCE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Why a path looks like payment code, or an empty list when it does not. */
export function matchPaymentPath(relativePath: string): string[] {
  const posix = relativePath.replace(/\\/g, '/');
  const segments = posix.split('/');
  const baseName = segments[segments.length - 1] ?? posix;
  const stem = baseName.replace(/\.[^.]+$/, '');
  const directory = segments.slice(0, -1).join('/');

  const reasons: string[] = [];
  if (PAYMENT_NAME_PATTERN.test(stem)) reasons.push(`file name \`${baseName}\``);
  if (directory.length > 0 && PAYMENT_PATH_PATTERN.test(`/${directory}/`)) {
    reasons.push(`path \`${directory}/\``);
  }
  return reasons;
}

/**
 * Does this identifier hold a monetary value? Minor units count here: a balance in cents races and
 * overflows exactly like a balance in dollars.
 */
export function isMonetaryIdentifier(name: string): boolean {
  const normalized = name.replace(/[_$]/g, '');
  return normalized.length > 0 && MONEY_NAME_PATTERN.test(normalized);
}

/**
 * Does this identifier hold a monetary value *as a floating point number*? Integer minor units are
 * excluded because they are the recommended representation, so flagging them would punish the fix.
 */
export function isMoneyIdentifier(name: string): boolean {
  const normalized = name.replace(/[_$]/g, '');
  if (normalized.length === 0) return false;
  if (INTEGER_MONEY_PATTERN.test(normalized)) return false;
  return MONEY_NAME_PATTERN.test(normalized);
}
