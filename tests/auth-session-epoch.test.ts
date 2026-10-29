import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createSessionToken, verifySessionToken, type SessionUser } from '../src/lib/auth.ts'

test('signed sessions carry the per-user epoch and reject tampering', () => {
  const previous = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = 'test-only-session-epoch-secret-value-32-chars'
  try {
    const user: SessionUser = {
      id: 'ci-session-user',
      username: 'ci-session',
      name: 'CI Session',
      role: 'admin',
    }
    const token = createSessionToken(user, 'epoch-one')
    const decoded = verifySessionToken(token)
    assert.equal(decoded?.sessionEpoch, 'epoch-one')
    assert.equal(decoded?.id, user.id)

    const [body, signature] = token.split('.')
    assert.ok(body && signature)
    const forgedBody = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
      sessionEpoch: 'epoch-two',
    })).toString('base64url')
    assert.equal(verifySessionToken(`${forgedBody}.${signature}`), null)
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previous
  }
})

test('tokens missing a session epoch are rejected to invalidate legacy cookies', () => {
  const previous = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = 'test-only-session-epoch-secret-value-32-chars'
  try {
    const user: SessionUser = {
      id: 'ci-legacy-session',
      username: 'ci-legacy',
      name: 'Legacy Session',
      role: 'cashier',
    }
    const token = createSessionToken(user, '0')
    const [body] = token.split('.')
    assert.ok(body)
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    delete payload.sessionEpoch
    const legacyBody = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', process.env.AUTH_SECRET).update(legacyBody).digest('base64url')
    assert.equal(verifySessionToken(`${legacyBody}.${signature}`), null)
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previous
  }
})
