import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { db, getLocalDatabasePath } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export const runtime = 'nodejs'

const BACKUP_PREFIX = 'tayba-pos-'
const MAX_BACKUPS = 30

async function backupList(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const backups = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(BACKUP_PREFIX) && entry.name.endsWith('.db'))
      .map(async (entry) => {
        const fullPath = join(directory, entry.name)
        const details = await stat(fullPath)
        return {
          filename: entry.name,
          sizeBytes: details.size,
          createdAt: details.mtime.toISOString(),
        }
      }))
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

async function authorize() {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) }
  if (!['admin', 'manager'].includes(user.role)) {
    return { error: NextResponse.json({ error: 'النسخ الاحتياطي متاح للإدارة فقط' }, { status: 403 }) }
  }
  return { user }
}

/** Return local database and backup status only; no filesystem paths are exposed. */
export async function GET() {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  try {
    const databasePath = getLocalDatabasePath()
    const details = await stat(databasePath).catch(() => null)
    const backups = await backupList(join(process.cwd(), 'backups'))
    return NextResponse.json({
      ok: true,
      source: 'local-sqlite',
      databaseExists: Boolean(details?.isFile()),
      databaseSizeBytes: details?.size ?? 0,
      backups,
      maximumBackups: MAX_BACKUPS,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'تعذر قراءة حالة قاعدة البيانات المحلية' }, { status: 503 })
  }
}

/** Create a consistent SQLite snapshot, retain recent copies locally, and download it. */
export async function POST(_req: NextRequest) {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  const directory = join(process.cwd(), 'backups')
  const filename = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.db`
  const outputPath = join(directory, filename)

  try {
    await mkdir(directory, { recursive: true })
    const databasePath = getLocalDatabasePath()
    const database = await stat(databasePath).catch(() => null)
    if (!database?.isFile()) {
      return NextResponse.json({ error: 'قاعدة البيانات المحلية غير موجودة بعد. أعد تشغيل إعداد قاعدة البيانات أولاً.' }, { status: 409 })
    }

    // VACUUM INTO creates a transactionally consistent snapshot including data
    // that may still be in SQLite's WAL. The filename is generated server-side.
    const escapedPath = outputPath.replace(/'/g, "''")
    await db.$executeRawUnsafe(`VACUUM INTO '${escapedPath}'`)

    const details = await stat(outputPath)
    if (!details.isFile() || details.size === 0) throw new Error('ملف النسخة الاحتياطية فارغ')

    const backups = await backupList(directory)
    for (const old of backups.slice(MAX_BACKUPS)) {
      if (old.filename !== filename) {
        await unlink(join(directory, old.filename)).catch(() => undefined)
      }
    }

    await auditLog({
      user: auth.user,
      action: 'backup',
      entity: 'database',
      after: { filename, sizeBytes: details.size },
    }).catch(() => undefined)

    const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(outputPath))
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
        'X-Backup-Filename': filename,
      },
    })
  } catch (error: unknown) {
    await unlink(outputPath).catch(() => undefined)
    const message = error instanceof Error ? error.message : 'تعذر إنشاء النسخة الاحتياطية'
    return NextResponse.json({
      error: 'فشل إنشاء نسخة قاعدة البيانات المحلية. لم يتم حذف أو تغيير قاعدة البيانات الأصلية.',
      detail: process.env.NODE_ENV === 'development' ? message : undefined,
    }, { status: 500 })
  }
}
