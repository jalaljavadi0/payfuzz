import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_replace_me', {
  apiVersion: '2024-06-20',
});

interface Account {
  id: string;
  balance: number;
}

/**
 * BUG (PF-RACE-002, check-then-act): the balance is checked before the charge is awaited, so two
 * concurrent checkouts can both pass the guard, both charge the card, and both write a balance
 * computed from the same starting value.
 */
export async function checkout(account: Account, amountCents: number) {
  if (account.balance >= amountCents) {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      metadata: { account: account.id },
    });

    await accounts.update({
      id: account.id,
      balance: account.balance - amountCents,
    });

    return paymentIntent;
  }

  throw new Error('insufficient funds');
}
