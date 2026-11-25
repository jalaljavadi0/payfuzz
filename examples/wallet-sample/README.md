# wallet-sample

A minimal wallet that PayFuzz is meant to flag. The float drift is intentional.

```ts
const bonus = 0.1 + 0.2; // 0.30000000000000004
wallet.balance = wallet.balance + bonus;
```

Money stored in an IEEE-754 double cannot represent most decimal amounts, so the bonus is a fraction
of a cent off. Add a few deposits and the wallet balance no longer reconciles with the ledger.

## Run PayFuzz on it

From this directory, with PayFuzz installed (`npx payfuzz`), or from the PayFuzz repository root
after a build:

```bash
node ../../dist/cli.js examples/wallet-sample
```

Expected findings:

| Rule           | Severity | Why                                                                        |
| -------------- | -------- | -------------------------------------------------------------------------- |
| `PF-FLOAT-001` | high     | decimal literal arithmetic: `0.1 + 0.2` evaluates to `0.30000000000000004` |
| `PF-FLOAT-002` | medium   | balance arithmetic on a floating point number                              |
| `PF-RACE-001`  | medium   | read-modify-write on the shared `balance` field                            |

The fix is to keep the balance in integer minor units (`balanceCents`) and format only at the edge:
`(balanceCents / 100).toFixed(2)`.
