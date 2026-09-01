import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

// Fetch live data from a published Google Sheet CSV URL (read-only)
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { searchParams } = new URL(req.url)
  let url = searchParams.get('url')

  if (!url) {
    const stored = await db.setting.findUnique({ where: { key: 'googleLiveCsvUrl' } })
    if (!stored?.value) {
      return NextResponse.json({ error: 'لم يتم ضبط رابط CSV مباشر' }, { status: 400 })
    }
    url = stored.value
  }

  try {
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) {
      return NextResponse.json({ error: `فشل في جلب البيانات: ${resp.status}` }, { status: 502 })
    }
    const text = await resp.text()
    // Parse CSV simply
    const lines = text.split(/\r?\n/).filter(Boolean)
    const headers = parseCsvLine(lines[0])
    const rows = lines.slice(1).map(parseCsvLine)
    return NextResponse.json({ headers, rows, count: rows.length, url })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في جلب البيانات' }, { status: 500 })
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
    } else {
      if (ch === ',') {
        result.push(cur)
        cur = ''
      } else if (ch === '"') {
        inQuote = true
      } else {
        cur += ch
      }
    }
  }
  result.push(cur)
  return result
}
