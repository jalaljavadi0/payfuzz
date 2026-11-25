interface Wallet {
  balance: number;
}

/**
 * BUG (PF-FLOAT-001): `0.1 + 0.2` is `0.30000000000000004`, not `0.3`. The bonus is then stored in
 * the balance, so every later total inherits the drift.
 */
export function applySignupBonus(wallet: Wallet): number {
  const bonus = 0.1 + 0.2;
  wallet.balance = wallet.balance + bonus;
  return wallet.balance;
}

/**
 * BUG (PF-FLOAT-002): balance arithmetic on a floating point `number`. Repeated deposits compound
 * the rounding error until the ledger stops reconciling to the cent.
 */
export function deposit(wallet: Wallet, amount: number): number {
  wallet.balance += amount;
  return wallet.balance;
}
