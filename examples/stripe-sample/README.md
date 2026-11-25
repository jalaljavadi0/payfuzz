# stripe-sample

A minimal Stripe checkout that PayFuzz is meant to flag. It contains one intentional race condition,
so the sample is a demonstration — never copy it.

```ts
if (account.balance >= amountCents) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
  });
  await accounts.update({ id: account.id, balance: account.balance - amountCents });
}
```

Two concurrent requests can both read the same balance, both pass the guard and both charge. The
second `accounts.update` also writes a balance computed from the stale value, so one payment
disappears from the ledger.

## Run PayFuzz on it

From this directory, with PayFuzz installed (`npx payfuzz`), or from the PayFuzz repository root
after a build:

```bash
node ../../dist/cli.js examples/stripe-sample
```

Expected findings:

| Rule              | Severity | Why                                                          |
| ----------------- | -------- | ------------------------------------------------------------ |
| `PF-RACE-002`     | high     | check-then-act: the guard is read before the awaited write   |
| `PF-OVERFLOW-001` | high     | `amountCents` reaches an awaited write without a range check |
| `PF-FLOAT-002`    | medium   | balance arithmetic on a floating point number                |

The fix is to let the database do the arithmetic atomically, for example
`UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1`, and to put an
idempotency key on the PaymentIntent.

No key is needed to scan this sample: PayFuzz never calls Stripe, and the placeholder above is a
test-mode string, not a credential.
