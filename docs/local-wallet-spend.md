# Local wallet fees and recovery

New Token matches spend each participant's own approved principal. A normal finish
captures that fee; cancellation or an invalid game releases the original hold.
Wins use scores or match-local chips. Game cannot credit a winner, transfer another
participant's funds, choose a recipient, or create Token income. New Token income
comes only from the existing trusted Host Codex usage path. Game holds no wallet
bearer and makes no wallet HTTP calls.

## Deployment identity

Provision `SPEND_SERVICE_ORIGIN` as the actual canonical HTTPS service origin and
`SPEND_SERVICE_PRIVATE_KEY` as a persistent Ed25519 PKCS8 PEM secret. Supply both
or neither. Keep the private key in deployment secret storage, outside source and
D1. Preserve that secret, D1 server ID, and origin across Worker redeploys. The
public pin in D1 rejects automatic key/origin replacement. Request Host/Forwarded
headers never choose the signing origin. Loopback HTTP is allowed only for local
operator development, not a hosted service.

Apply every ordered Workers migration before enabling this configuration. Missing
configuration explicitly disables new Token games. Public `GET /v1/spend/identity`
returns only `contract: economy.spend-service/v1` plus the configured origin,
server ID, and public key. Host independently checks this actual HTTPS endpoint
and obtains native source approval; a renderer-provided key is insufficient.

## Logged-in participant flow

1. Authenticate to Game. `POST /v1/wallet-bindings/challenge` returns a signed
   account-specific nonce challenge with a three-minute lifetime. Public
   `ctx.walletSpend.bindGameAccount` confirms it natively and returns the original
   wallet's signed binding. Submit that envelope to `POST /v1/wallet-bindings`.
   Game verifies the exact stored challenge, login identity and wallet signature.
   A saved wallet/key cannot be silently replaced. `GET /v1/wallet-bindings` reads
   the immutable saved proof.
2. Starting a ready Token room atomically saves its signed immutable terms and
   stable per-participant request IDs. `GET /v1/rooms/:id/spend` is participant-only.
   Terms disclose source/key/server/match, exact package version/digest/review,
   participants and each participant's own fee. One account's seats aggregate.
3. The client verifies the terms and amount, then uses public Host `lookup` before
   `reserve` with that durable request ID. Native confirmation authorizes the
   original local authority, not an arbitrary signer or renderer approval flag.
   Submit the signed original-wallet receipt to
   `POST /v1/rooms/:id/spend-receipts`. Game verifies every binding and signature;
   play opens only after every participant's receipt is durably accepted.
4. Game commits its final signed capture/refund decision together with room state,
   event, command acknowledgement and any Agent budget update. The client delivers
   it with public Host `applyDecision`, verifies settlement receipts, and reads
   the original wallet again. Game's settled status means its durable decision;
   it does not prove every disconnected wallet has received that decision.

`POST /v1/rooms/:id/spend-cancel` cancels funding for a participant. Leaving during
funding follows that same atomic cancellation. Admission closes after ten minutes;
request-driven timeout recovery signs a global refund. This deadline never directly
refunds a local hold. A global refund also releases valid local holds whose receipts
had not reached Game. Late receipts cannot change the frozen decision envelope.

`GET /v1/me/spend-transactions` reads only that logged-in participant's indexed
transactions, including previous hands. `GET /v1/spend/transactions/:matchId` reads
an owned transaction independently of the room's current hand. These routes contain
wallet proofs and are not public lobby/spectator data. Public cards expose only
costs and preparation phase, never signed terms, receipts, request IDs or wallet
identity.

## Interrupted operations and old protocol

After reconnecting the source, a lost wallet acknowledgement retries the same persisted request ID through lookup;
a lost Game acknowledgement resubmits the same signed receipt. A service restart
retains the original terms, request IDs, receipts, nonce bindings and final envelope.
Decision identity is stable across retries; the complete signed bytes, including
signature and action, remain immutable. Cancel versus final admission and concurrent
commands have one atomic outcome. No disconnect, admission deadline, local clock
or client teardown invents a refund. Missing Host/authority capability shows
unavailable. Conflicting decisions remain a dispute/pending recovery condition.

The retired agreement/payout protocol performs no new writes or automatic refunds.
`POST /v1/economy/link` returns 410. Participant-authenticated
`GET /v1/rooms/:id/legacy-recovery` returns the exact original historical journal;
room mutation and timers cannot change it. Do not recreate a missing receipt,
credit a migration, or replay an old financial operation as a new spend.

Game's own tests use fresh temporary databases and explicit trusted server fixtures.
They verify signatures, own-principal bounds, admission, global refund, original-wallet
sharing, retry, atomic rollback and complete shipped games. Such tests establish
implementation behavior; Native consent, original live-ledger preservation and hosted
service acceptance require separate integrated verification. A user-controlled device
or compromised wallet signing key is not a global usage proof or anti-double-spend
service.

## Operator online smoke

After deploying, the integrating operator can run this portable check with the
actual HTTPS origin and frozen package JSON files, in Gomoku/Holdem order:

```sh
node scripts/online-wallet-spend-smoke.mjs HTTPS_ORIGIN GOMOKU_JSON HOLDEM_JSON
```

It creates random test Game accounts and temporary local SQLite wallets, then
checks signed source identity, binding, exact terms/request IDs, both complete
fee matches, same-principal capture, decreasing supply, immutable decisions,
private cards and indexed recovery. Finally it revokes those test sessions.
It never uses the original wallet or native approval, and cannot establish
Native/actual-usage acceptance. Failed checks do not invent refunds. Remote
test accounts and match records remain as deployment smoke evidence.

`npm run test:online-wallet-fixture` verifies that exact script against a newly
allocated loopback Game service. Its explicit `--allow-loopback` flag is only
for this isolated test; no live Site is accessed by that verification.
