import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const testFilename = 'tayba-setup-test.db'
const databasePath = resolve(process.cwd(), 'data', testFilename)
const databaseUrl = 'file:../data/tayba-setup-test.db'
const backupDirectory = resolve(process.cwd(), 'backups')

if (process.env.ALLOW_TAYBA_SETUP_TEST !== '1') {
  throw new Error('Refusing database-setup integration test without ALLOW_TAYBA_SETUP_TEST=1')
}

async function listProtectionBackups() {
  try {
    return (await readdir(backupDirectory))
      .filter((name) => name.startsWith('tayba-pos-before-schema-') && name.endsWith('.db'))
  } catch {
    return []
  }
}

function runSafeSetup() {
  return spawnSync(process.execPath, ['scripts/safe-db-setup.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  })
}

test('safe schema setup snapshots an existing database and preserves rows through schema sync', async () => {
  await unlink(databasePath).catch(() => undefined)
  await unlink(`${databasePath}-journal`).catch(() => undefined)
  await unlink(`${databasePath}-wal`).catch(() => undefined)
  await unlink(`${databasePath}-shm`).catch(() => undefined)
  const backupsBefore = new Set(await listProtectionBackups())

  const created = runSafeSetup()
  assert.equal(created.error, undefined, created.error?.message)
  assert.equal(created.status, 0, `first safe setup failed:\n${created.stdout}\n${created.stderr}`)

  const db = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
  try {
    await db.setting.create({ data: { key: 'ci-safe-upgrade-preserve-row', value: 'must-survive' } })
  } finally {
    await db.$disconnect()
  }

  try {
    const upgraded = runSafeSetup()
    assert.equal(upgraded.error, undefined, upgraded.error?.message)
    assert.equal(upgraded.status, 0, `second safe setup failed:\n${upgraded.stdout}\n${upgraded.stderr}`)

    const backupsAfter = await listProtectionBackups()
    const createdBackups = backupsAfter.filter((name) => !backupsBefore.has(name))
    assert.ok(createdBackups.length > 0, 'second setup must create a pre-upgrade SQLite snapshot')

    const liveDb = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
    const snapshotName = createdBackups.sort().at(-1)
    assert.ok(snapshotName, 'pre-upgrade backup filename must exist')
    const snapshotPath = resolve(backupDirectory, snapshotName)
    const snapshotDb = new PrismaClient({ datasources: { db: { url: `file:${snapshotPath}` } } })
    try {
      const liveRow = await liveDb.setting.findUnique({ where: { key: 'ci-safe-upgrade-preserve-row' } })
      const backupRow = await snapshotDb.setting.findUnique({ where: { key: 'ci-safe-upgrade-preserve-row' } })
      assert.equal(liveRow?.value, 'must-survive', 'schema sync must preserve live rows')
      assert.equal(backupRow?.value, 'must-survive', 'pre-upgrade backup must contain the original rows')
      const integrity = await snapshotDb.$queryRawUnsafe('PRAGMA integrity_check')
      assert.equal(integrity?.[0]?.integrity_check, 'ok', 'snapshot must pass SQLite integrity_check')
      assert.ok((await stat(snapshotPath)).size > 0)
    } finally {
      await liveDb.$disconnect()
      await snapshotDb.$disconnect()
    }
  } finally {
    const newBackups = (await listProtectionBackups()).filter((name) => !backupsBefore.has(name))
    await Promise.all(newBackups.map((name) => unlink(resolve(backupDirectory, name)).catch(() => undefined)))
    await unlink(databasePath).catch(() => undefined)
    await unlink(`${databasePath}-journal`).catch(() => undefined)
    await unlink(`${databasePath}-wal`).catch(() => undefined)
    await unlink(`${databasePath}-shm`).catch(() => undefined)
  }
})
