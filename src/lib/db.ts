/**
 * Google Sheets-backed data facade.
 *
 * Google Sheets is the sole persistent source of truth.
 * Cloudflare KV is a short-lived read cache only.
 *
 * Cloudflare Workers:
 * - Runtime variables and secrets are exposed through process.env
 *   because wrangler.jsonc enables:
 *   nodejs_compat
 *   nodejs_compat_populate_process_env
 */

import {
  cacheGet,
  cachePut,
  cacheDelete,
} from '@/lib/cloudflare/cache'

type AnyRecord = Record<string, any>
type QueryArgs = AnyRecord

type ModelApi = {
  findMany(args?: QueryArgs): Promise<any[]>
  findUnique(args: QueryArgs): Promise<any | null>
  findUniqueOrThrow(args: QueryArgs): Promise<any>
  findFirst(args?: QueryArgs): Promise<any | null>
  count(args?: QueryArgs): Promise<number>
  aggregate(args?: QueryArgs): Promise<any>
  create(args: QueryArgs): Promise<any>
  update(args: QueryArgs): Promise<any>
  upsert(args: QueryArgs): Promise<any>
  delete(args: QueryArgs): Promise<any>
  deleteMany(args?: QueryArgs): Promise<any>
  fields?: Record<string, string>
}

const MODEL_NAMES = [
  'user',
  'category',
  'brand',
  'product',
  'productVariant',
  'supplier',
  'customer',
  'purchase',
  'purchaseItem',
  'purchaseReturn',
  'purchaseReturnItem',
  'sale',
  'saleItem',
  'saleReturn',
  'saleReturnItem',
  'customerPayment',
  'supplierPayment',
  'setting',
  'registerSession',
  'stockAdjustment',
  'auditLog',
] as const

const DATE_FIELDS: Record<string, string[]> = {
  user: ['createdAt', 'updatedAt'],
  category: ['createdAt'],
  brand: [],
  product: ['createdAt', 'updatedAt'],
  productVariant: ['createdAt', 'updatedAt'],
  supplier: ['createdAt', 'updatedAt'],
  customer: ['createdAt', 'updatedAt'],

  purchase: ['date', 'createdAt'],
  purchaseItem: [],

  purchaseReturn: ['date', 'createdAt'],
  purchaseReturnItem: [],

  sale: ['date', 'createdAt'],
  saleItem: [],

  saleReturn: ['date', 'createdAt'],
  saleReturnItem: [],

  customerPayment: ['date', 'createdAt'],
  supplierPayment: ['date', 'createdAt'],

  setting: [],

  registerSession: ['openedAt', 'closedAt'],

  stockAdjustment: ['createdAt'],
  auditLog: ['createdAt'],
}

const READ_METHODS = new Set([
  'findMany',
  'findUnique',
  'findFirst',
  'count',
  'aggregate',
])

function reviveDates(model: string, value: any): any {
  if (!value || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((v) => reviveDates(model, v))
  }

  const out: any = { ...value }

  for (const field of DATE_FIELDS[model] || []) {
    if (
      out[field] &&
      typeof out[field] === 'string'
    ) {
      out[field] = new Date(out[field])
    }
  }

  return out
}

function keyPart(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) =>
      v instanceof Date
        ? v.toISOString()
        : v
  )
}

const CACHEABLE_MODELS = new Set([
  'category',
  'brand',
])

function cacheKey(
  model: string,
  method: string,
  args: QueryArgs
): string {
  return `tayba:db:v1:${model}:${method}:${keyPart(args)}`
}

function shouldCache(model: string, method: string): boolean {
  return READ_METHODS.has(method) && CACHEABLE_MODELS.has(model)
}

async function request(payload: AnyRecord) {
  const {
    model,
    method,
    args = {},
  } = payload as {
    model: string
    method: string
    args: QueryArgs
  }

  const key = cacheKey(
    model,
    method,
    args
  )

  if (shouldCache(model, method)) {
    const cached = await cacheGet<any>(key)

    if (cached !== null) {
      return cached
    }
  }

  /**
   * Cloudflare Workers exposes configured vars/secrets
   * through process.env when:
   *
   * nodejs_compat
   * nodejs_compat_populate_process_env
   *
   * are enabled in wrangler.jsonc.
   */
  const url = process.env.GOOGLE_APPS_SCRIPT_URL || ''
  const token = process.env.GOOGLE_APPS_SCRIPT_TOKEN || ''

  if (!url) {
    throw new Error(
      'Google Sheets backend is not configured: GOOGLE_APPS_SCRIPT_URL is missing'
    )
  }

  if (!token) {
    throw new Error(
      'Google Sheets backend is not configured: GOOGLE_APPS_SCRIPT_TOKEN is missing'
    )
  }

  const res = await fetch(url, {
    method: 'POST',

    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },

    body: JSON.stringify({
      action: 'query',
      token,
      ...serialize(payload),
    }),
  })

  const body =
    (await res.json().catch(() => ({}))) as AnyRecord

  if (!res.ok || !body.ok) {
    throw new Error(
      body.error ||
        `Sheets backend HTTP ${res.status}`
    )
  }

  const result = body.data

  if (shouldCache(model, method)) {
    await cachePut(
      key,
      result,
      20
    )
  }

  return result
}

export async function atomicAction<T = any>(
  action: string,
  payload: AnyRecord = {}
): Promise<T> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL || ''
  const token = process.env.GOOGLE_APPS_SCRIPT_TOKEN || ''

  if (!url) {
    throw new Error(
      'Google Sheets backend is not configured: GOOGLE_APPS_SCRIPT_URL is missing'
    )
  }

  if (!token) {
    throw new Error(
      'Google Sheets backend is not configured: GOOGLE_APPS_SCRIPT_TOKEN is missing'
    )
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({
      action,
      token,
      ...serialize(payload),
    }),
  })

  const body =
    (await res.json().catch(() => ({}))) as AnyRecord

  if (!res.ok || !body.ok) {
    throw new Error(
      body.error ||
        `Sheets backend HTTP ${res.status}`
    )
  }

  return body.data as T
}

function serialize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(serialize)
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value as AnyRecord
      ).map(([key, val]) => [
        key,
        serialize(val),
      ])
    )
  }

  return value
}

async function invalidateModel(
  model: string
) {
  if (!CACHEABLE_MODELS.has(model)) return
  await cacheDelete(`tayba:sheet:${model}`)
}

function modelApi(
  model: string
): ModelApi {
  if (
    !MODEL_NAMES.includes(
      model as any
    )
  ) {
    throw new Error(
      `Unsupported model: ${model}`
    )
  }

  return {
    findMany: async (
      args = {}
    ) =>
      reviveDates(
        model,
        await request({
          model,
          method: 'findMany',
          args,
        })
      ),

    findUnique: async (
      args
    ) =>
      reviveDates(
        model,
        await request({
          model,
          method: 'findUnique',
          args,
        })
      ),

    findUniqueOrThrow: async (
      args
    ) => {
      const row =
        reviveDates(
          model,
          await request({
            model,
            method: 'findUnique',
            args,
          })
        )

      if (!row) {
        throw Object.assign(
          new Error(
            `${model} not found`
          ),
          {
            code: 'P2025',
          }
        )
      }

      return row
    },

    findFirst: async (
      args = {}
    ) =>
      reviveDates(
        model,
        await request({
          model,
          method: 'findFirst',
          args,
        })
      ),

    count: async (
      args = {}
    ) =>
      Number(
        await request({
          model,
          method: 'count',
          args,
        })
      ),

    aggregate: async (
      args = {}
    ) =>
      request({
        model,
        method: 'aggregate',
        args,
      }),

    create: async (
      args
    ) => {
      const result =
        reviveDates(
          model,
          await request({
            model,
            method: 'create',
            args,
          })
        )

      await invalidateModel(
        model
      )

      return result
    },

    update: async (
      args
    ) => {
      const result =
        reviveDates(
          model,
          await request({
            model,
            method: 'update',
            args,
          })
        )

      await invalidateModel(
        model
      )

      return result
    },

    upsert: async (
      args
    ) => {
      const result =
        reviveDates(
          model,
          await request({
            model,
            method: 'upsert',
            args,
          })
        )

      await invalidateModel(
        model
      )

      return result
    },

    delete: async (
      args
    ) => {
      const result =
        reviveDates(
          model,
          await request({
            model,
            method: 'delete',
            args,
          })
        )

      await invalidateModel(
        model
      )

      return result
    },

    deleteMany: async (
      args = {}
    ) => {
      const result =
        await request({
          model,
          method: 'deleteMany',
          args,
        })

      await invalidateModel(
        model
      )

      return result
    },

    fields:
      model === 'productVariant'
        ? {
            minQuantity:
              'minQuantity',
            reorderQty:
              'reorderQty',
          }
        : {},
  }
}

const dbTarget: AnyRecord = {
  $transaction:
    async <T>(
      fn: (
        tx: any
      ) => Promise<T>
    ) => fn(db),

  $disconnect:
    async () => undefined,

  $connect:
    async () => undefined,
}

export const db: any =
  new Proxy(
    dbTarget,
    {
      get(
        target,
        prop
      ) {
        if (
          prop in target
        ) {
          return target[
            prop as any
          ]
        }

        if (
          typeof prop ===
          'string'
        ) {
          return modelApi(
            prop
          )
        }

        return undefined
      },
    }
  )
