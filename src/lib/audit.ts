/**
 * Audit Log helper — log any mutation for accountability.
 */
import { db } from './db'
import type { SessionUser } from './auth'
import { getClientIp } from './auth'

export async function auditLog(params: {
  user?: SessionUser | null
  action: 'create' | 'update' | 'delete' | 'void' | 'return' | 'payment' | 'login' | 'logout' | 'stock_adjust' | 'register_open' | 'register_close' | 'manager_override' | 'password_change'
  entity: string
  entityId?: string
  before?: unknown
  after?: unknown
  ip?: string
}): Promise<void> {
  try {
    const ip = params.ip ?? (await getClientIp())
    await db.auditLog.create({
      data: {
        userId: params.user?.id ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        before: params.before ? JSON.stringify(params.before) : null,
        after: params.after ? JSON.stringify(params.after) : null,
        ip,
      },
    })
  } catch (e) {
    console.error('audit log failed:', e)
  }
}
