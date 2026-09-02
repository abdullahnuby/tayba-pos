import { PrismaClient } from '../generated/prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { d1AtomicAction, getD1Binding } from './d1-atomic'

/**
 * Prisma client for reads and normal CRUD operations.
 *
 * IMPORTANT:
 * Cloudflare D1 does not support Prisma interactive transactions.
 * Therefore all POS operations that require atomicity are routed
 * through d1AtomicAction(), which uses D1Database.batch() directly.
 */

type D1Database = ConstructorParameters<typeof PrismaD1>[0]
type CloudflareEnv = { DB?: D1Database }

function createPrismaClient(): PrismaClient {
  const d1 = getD1Binding()

  if (d1) {
    return new PrismaClient({
      adapter: new PrismaD1(d1),
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }

  const databaseUrl = process.env.DATABASE_URL || 'file:./db/tayba.db'
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

// Keep the direct env access here as a safety check so a missing binding
// cannot silently create an unconfigured production Prisma client.
void (cloudflareEnv as CloudflareEnv)

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

export const db: any = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

// Backwards-compatible aliases used by some existing UI/data helpers.
Object.defineProperty(db.productVariant, 'fields', {
  value: {
    minQuantity: 'minQuantity',
    reorderQty: 'reorderQty',
  },
  enumerable: false,
  configurable: true,
})

export async function atomicAction<T = any>(
  action: string,
  payload: Record<string, any> = {}
): Promise<T> {
  const input = payload.payload ?? payload
  const d1 = getD1Binding()

  if (!d1) {
    throw new Error('atomicAction requires a Cloudflare D1 binding')
  }

  return d1AtomicAction<T>(action, input, d1)
}

export type DatabaseModelName = keyof PrismaClient
