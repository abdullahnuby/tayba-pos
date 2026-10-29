import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getClientIpFromHeaders } from '../src/lib/rate-limit.ts'

test('client cannot spoof rate-limit identity with forwarded headers by default', () => {
  const previous = process.env.TRUST_PROXY_HEADERS
  delete process.env.TRUST_PROXY_HEADERS
  try {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.99, 127.0.0.1',
      'x-real-ip': '203.0.113.99',
      'cf-connecting-ip': '203.0.113.99',
    })
    assert.equal(getClientIpFromHeaders(headers), 'local')
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS
    else process.env.TRUST_PROXY_HEADERS = previous
  }
})

test('forwarded client identity is used only with explicit trusted-proxy opt-in', () => {
  const previous = process.env.TRUST_PROXY_HEADERS
  process.env.TRUST_PROXY_HEADERS = 'true'
  try {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.99, 127.0.0.1' })
    assert.equal(getClientIpFromHeaders(headers), '203.0.113.99')
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS
    else process.env.TRUST_PROXY_HEADERS = previous
  }
})
