import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUnsafeCrossOriginRequest } from '../src/lib/request-origin.ts'

function request(method: string, url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method, headers })
}

test('safe methods are not rejected even when an Origin header differs', () => {
  assert.equal(isUnsafeCrossOriginRequest(request('GET', 'http://127.0.0.1:3000/api/products', { origin: 'https://evil.example' })), false)
  assert.equal(isUnsafeCrossOriginRequest(request('HEAD', 'http://127.0.0.1:3000/api/products', { origin: 'https://evil.example' })), false)
})

test('same-origin browser writes are allowed', () => {
  assert.equal(isUnsafeCrossOriginRequest(request('POST', 'http://127.0.0.1:3000/api/sales', { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' })), false)
})

test('cross-origin writes are rejected', () => {
  assert.equal(isUnsafeCrossOriginRequest(request('POST', 'http://127.0.0.1:3000/api/sales', { origin: 'https://evil.example' })), true)
  assert.equal(isUnsafeCrossOriginRequest(request('PATCH', 'http://127.0.0.1:3000/api/settings', { 'sec-fetch-site': 'cross-site' })), true)
})

test('malformed Origin is rejected for writes', () => {
  assert.equal(isUnsafeCrossOriginRequest(request('DELETE', 'http://127.0.0.1:3000/api/products/1', { origin: 'not a URL' })), true)
})

test('origin-less writes fail closed unless same-origin browser metadata is present', () => {
  assert.equal(isUnsafeCrossOriginRequest(request('POST', 'http://127.0.0.1:3000/api/sales')), true)
  assert.equal(isUnsafeCrossOriginRequest(request('POST', 'http://127.0.0.1:3000/api/sales', { 'sec-fetch-site': 'same-origin' })), false)
})
