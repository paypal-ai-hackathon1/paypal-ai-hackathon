# Payouts spike

The product idea depends on sending money out in batches with PayPal Payouts. Before building on it, `scripts/check-payouts.mjs` checks on the real sandbox that this app can do that, and to which wallets.

## What it answers

| Question | How the script checks it |
| --- | --- |
| Is Payouts enabled for this sandbox app? | Looks for the `https://uri.paypal.com/payments/payouts` scope in the OAuth token, then sends a batch |
| Does a payout reach a PayPal account? | `--email`: $1.00 to a sandbox personal account, expects item status `SUCCESS` |
| Does a payout reach Venmo on the sandbox? | `--venmo`: $1.00 with `recipient_wallet: VENMO`, expects `SUCCESS` |
| What happens when the receiver has no account? | `--unclaimed`: $1.00 to a fresh `@example.com` address, expects `UNCLAIMED` |

Each case is its own one-item batch, so a rejected Venmo item does not hide the result of the PayPal one.

## Run it

1. In the [developer dashboard](https://developer.paypal.com/dashboard/accounts), open **Sandbox accounts** and copy the email of the default **personal** account. The app's own **business** account is the sender and needs a sandbox balance.
2. Make sure `.env.local` has `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` for a sandbox app.
3. Run:

```bash
npm run check:payouts -- --email <personal sandbox email> --unclaimed
# optional Venmo try; --venmo-type is PHONE (default), EMAIL or USER_HANDLE
npm run check:payouts -- --venmo <US phone or handle> --venmo-type PHONE
# re-check batches that were still pending
npm run check:payouts -- --batch <payout_batch_id>
```

Options: `--amount` (default `1.00`, USD), `--wait` seconds to poll before giving up (default `60`).

Exit code is 1 when a batch is rejected or an item ends in a status other than the expected one. Items still `PENDING` when the wait runs out are printed as `WAIT` with the command to re-check them.

## What the docs say

When the script was written, PayPal's developer docs were not reachable, so the points below came from search summaries. They were checked against the docs and the sandbox on Nov 10, 2026:

- **Venmo is US only:** confirmed on [Countries and supported features](https://developer.paypal.com/payouts/supported-features). The note requirement and the Venmo recipient type (`PHONE`, `EMAIL` or `USER_HANDLE`) were not checked, because this project does not use Venmo.
- **`UNCLAIMED` items return after 30 days:** confirmed by the sandbox run below and by the [PayPal Payouts terms](https://www.paypal.com/vn/legalhub/paypal/paypal-payouts-agreement?locale.x=en_VN). The cancel endpoint `POST /v1/payments/payouts-item/{payout_item_id}/cancel` is listed in the [Payouts v1 API reference](https://developer.paypal.com/api/payments.payouts-batch/v1).

## Results

| Date | Case | Result | Notes |
| --- | --- | --- | --- |
| 2026-11-10 | scope | OK | The OAuth token includes the `payouts` scope, so Payouts is enabled for this sandbox app |
| 2026-11-10 | paypal | OK | Batch `B5A26FAJKG288` sent $1.00 to a sandbox personal account and went from `PENDING` to `SUCCESS` within 120 s. The item ended `SUCCESS` |
| 2026-11-10 | unclaimed | OK | Batch `W7ZHXM7557ASA` went from `PENDING` to `SUCCESS` within 90 s. The item ended `UNCLAIMED` with error `RECEIVER_UNREGISTERED`, and PayPal said the funds return after 30 days |
| | venmo | not run | Not needed for this project |

## Can partners in Vietnam receive Payouts?

**Short answer:** PayPal's own pages say a PayPal account registered in Vietnam can receive and withdraw Payouts, in USD rather than VND. We have not tested this with a real Vietnamese account, because everything in this project runs on the sandbox.

Checked on Nov 10, 2026:

| Finding | Source |
| --- | --- |
| Vietnam (`VN`) is eligible for Payouts with the feature set "Send, receive, and withdraw", meaning account holders "can receive and withdraw money". It is not in the tiers that add local currency. | [Countries and supported features](https://developer.paypal.com/payouts/supported-features), last updated Sep 10, 2026 |
| VND is not a PayPal REST API currency, so payouts to Vietnam must be sent in a supported currency such as USD. | [Currency codes](https://developer.paypal.com/api/codes/currency), last updated Aug 17, 2026 |
| A personal account can withdraw to a local Vietnamese bank account. The fee is 60,000 VND when no currency conversion is involved, and conversion fees may apply. | [PayPal fees for customers (VN)](https://www.paypal.com/vn/digital-wallet/paypal-consumer-fees?locale.x=en_VN) |
| Vietnam is not on the country list of the Receive Funds and Automatic Transfer Agreement, which imposes a 30-day hold and forced withdrawal to a US bank account or Visa card. | [Receive Funds and Automatic Transfer Agreement](https://www.paypal.com/vn/legalhub/paypal/recpymt-full?locale.x=en_VN), last updated Sep 22, 2026 |
| A recipient's account must be in an eligible jurisdiction, able to receive payments, verified (confirmed email, and a mobile number where required) and in good standing. | [PayPal Payouts terms (VN)](https://www.paypal.com/vn/legalhub/paypal/paypal-payouts-agreement?locale.x=en_VN), last updated Feb 8, 2024 |
| The sender needs a business account and PayPal's permission to use Payouts. Payouts "may not be used for payroll, selling products, sending money to family and friends", among other uses. | Same page |
| In some countries, receiving money requires linking the account to a licensed local partner. The page does not say which countries. | [How do I receive money through PayPal? (VN)](https://www.paypal.com/vn/cshelp/article/how-do-i-receive-money-through-paypal-help667?locale.x=en_VN) |

### What this means for the product

- Payouts go to partner organisations, not to households. That matches what Payouts is for (business payments to many recipients), and it keeps clear of the family-and-friends restriction.
- Amounts are sent in USD. A partner holds USD and converts it when withdrawing to a Vietnamese bank, so it pays a withdrawal fee and a conversion fee.
- Each partner needs a verified PayPal account in good standing before the season starts.

### Not confirmed

- Nothing here was tested with a real Vietnam-registered account.
- Fees for business accounts in Vietnam: the merchant fees page was not checked.
- The exact fee and exchange rate when a USD balance is withdrawn as VND.
- Whether Vietnam is one of the countries where receiving requires a licensed local partner.
- Whether PayPal would approve relief disbursements to NGOs as a Payouts use case. Live use needs PayPal's approval in any case.
