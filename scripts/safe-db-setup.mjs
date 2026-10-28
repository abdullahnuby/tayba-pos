import { PrismaClient } from '@prisma/client'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

function resolveSqlitePath() {
  const url = (process.env.DATABASE_URL || 'file:../data/tayba.db').trim()
  if (!url.startsWith('file:')) {
    throw new Error('الوضع المحلي يتطلب DATABASE_URL يشير إلى ملف SQLite محلي.')
  }
  const rawPath = decodeURIComponent(url.slice('file:'.length).split('?')[0])
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), 'prisma', rawPath)
}

function escapeSqlString(value) {
  return value.replace(/'/g, "''")
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

const databasePath = resolveSqlitePath()
const databaseUrl = `file:${databasePath.split(sep).join('/')}`
const backupDir = resolve(process.cwd(), 'backups')
const schemaPath = resolve(process.cwd(), 'prisma', 'schema.prisma')

await mkdir(dirname(databasePath), { recursive: true })
await mkdir(backupDir, { recursive: true })

let backupPath = null
try {
  const info = await stat(databasePath).catch(() => null)
  if (info?.isFile() && info.size > 0) {
    // Raw SQLite operations can run even when the generated Prisma model differs
    // from the current schema, so we do not need to read business tables first.
    const snapshotClient = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: ['error'],
    })
    try {
      const integrity = await snapshotClient.$queryRawUnsafe('PRAGMA integrity_check')
      const integrityMessage = integrity?.[0]?.integrity_check
      if (integrityMessage !== 'ok') {
        throw new Error(`فشل فحص سلامة قاعدة البيانات: ${String(integrityMessage || 'نتيجة غير معروفة')}`)
      }
      await snapshotClient.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL)')
      backupPath = resolve(backupDir, `tayba-pos-before-schema-${timestamp()}.db`)
      await snapshotClient.$executeRawUnsafe(`VACUUM INTO '${escapeSqlString(backupPath)}'`)
      const backupInfo = await stat(backupPath)
      if (!backupInfo.isFile() || backupInfo.size <= 0) {
        throw new Error('ملف النسخة الاحتياطية قبل التحديث فارغ أو غير صالح')
      }
      console.log(`تم إنشاء نسخة حماية قبل تحديث المخطط (${backupInfo.size} بايت).`)
    } finally {
      await snapshotClient.$disconnect()
    }
  } else {
    console.log('لا توجد قاعدة بيانات سابقة؛ سيتم إعداد قاعدة جديدة.')
  }
} catch (error) {
  console.error('أوقفنا تحديث مخطط قاعدة البيانات لأن فحص/نسخ قاعدة البيانات السابقة لم يكتمل.')
  if (backupPath) console.error(`قد تكون نسخة الحماية قد أُنشئت هنا: ${backupPath}`)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(command, ['prisma', 'db', 'push', '--schema', schemaPath], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:../data/tayba.db' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error('تعذر تشغيل Prisma. قاعدة البيانات الأصلية لم يتم حذفها عمدًا.')
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  console.error('فشل تحديث مخطط SQLite. لم نستخدم --accept-data-loss.')
  if (backupPath) console.error('نسخة الحماية قبل التحديث موجودة داخل مجلد backups.')
  process.exit(result.status || 1)
}

console.log('اكتمل إعداد مخطط SQLite محليًا.')
if (backupPath) console.log('احتفظ بنسخة الحماية حتى يتم اختبار البرنامج على البيانات بعد التحديث.')
