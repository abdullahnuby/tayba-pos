/**
 * Keep a stable idempotency key for a specific submission payload.
 *
 * If a request fails after the server committed it, submitting the unchanged
 * payload again reuses the same key. Editing the payload produces a new key.
 * The caller should clear the ref after success or when cancelling the form.
 */
export type StableSubmissionRef = {
  current: { fingerprint: string; key: string } | null
}

function createKey(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export function withIdempotencyKey<T extends Record<string, unknown>>(
  payload: T,
  ref: StableSubmissionRef,
): T & { idempotencyKey: string } {
  const fingerprintPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'idempotencyKey'),
  )
  const fingerprint = JSON.stringify(fingerprintPayload)
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: createKey() }
  }
  return { ...payload, idempotencyKey: ref.current.key }
}

export function clearIdempotencyKey(ref: StableSubmissionRef): void {
  ref.current = null
}
