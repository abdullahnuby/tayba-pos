import { PrismaClient } from '@prisma/client'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { localAtomicAction } from './local-atomic'

/**
 * Tayba POS is a local-first application. The only operational datastore is
 * a SQLite file on this computer; network database URLs are deliberately
 * rejected so the shop cannot silently write business data to a remote host.
 */
export function getLocalDatabasePath(): string {
  const url = (process.env.DATABASE_URL || 'file:../data/tayba.db').trim()
  if (!url.startsWith('file:')) {
    throw new Error('Tayba POS يعمل محليًا فقط؛ DATABASE_URL يجب أن يشير إلى ملف SQLite محلي')
  }

  const relativePath = decodeURIComponent(url.slice('file:'.length).split('?')[0])
  // Prisma resolves relative SQLite URLs from prisma/schema.prisma.
  const filePath = isAbsolute(relativePath)
    ? relativePath
    : resolve(process.cwd(), 'prisma', relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  return filePath
}

function localDatabaseUrl(): string {
  getLocalDatabasePath()
  return (process.env.DATABASE_URL || 'file:../data/tayba.db').trim()
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: localDatabaseUrl() } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const db: any = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

// Legacy helpers use this non-model metadata to render stock thresholds.
Object.defineProperty(db.productVariant, 'fields', {
  value: { minQuantity: 'minQuantity', reorderQty: 'reorderQty' },
  enumerable: false,
  configurable: true,
})

export async function atomicAction<T = any>(
  action: string,
  payload: Record<string, any> = {},
): Promise<T> {
  return localAtomicAction<T>(db, action, payload)
}

export type DatabaseModelName = keyof PrismaClient
