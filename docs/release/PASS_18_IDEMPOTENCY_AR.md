# Pass 18 — Idempotency / Double Submit

- IdempotencyKeys sheet stores request fingerprints and successful responses.
- Replays with the same key/fingerprint return the original result without repeating the mutation.
- Reusing a key with a different payload is rejected.
- Failed actions remove the processing marker so a retry can proceed.
- POS keeps a stable key for the current sale attempt, including quick pay.
- Remaining release test: live retry after commit but before the client receives the response.
