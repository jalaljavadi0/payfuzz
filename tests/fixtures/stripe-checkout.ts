/**
 * Test fixture: a Stripe checkout that checks a balance before charging.
 *
 * Both defects are intentional. PayFuzz parses this file, it never runs it.
 */
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2024-06-20',
});

export async function chargeCustomer(accountId: string, amount: number) {
  const account = await accounts.findById(accountId);

  if (account.balance >= amount) {
    await stripe.paymentIntents.create({ amount, currency: 'usd' });
  }

  return account;
}
