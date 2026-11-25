/**
 * Test fixture: a wallet that mixes a shared balance with decimal arithmetic.
 *
 * Both defects are intentional. PayFuzz parses this file, it never runs it.
 */
export class Wallet {
  private balance = 0;

  deposit(amount: number): number {
    this.balance = this.balance + amount;
    return this.balance;
  }

  previewBonus(): number {
    return 0.1 + 0.2;
  }
}
