/**
 * Authentication helpers — password hashing + verification.
 * Uses Node built-in crypto (no external deps).
 *
 * Local Node.js authentication:
 * - AUTH_SECRET is read lazily at runtime.
 * - No top-level environment access is required while importing the module.
 */

import * as crypto from 'crypto'
import { db } from './db'
import {
  cookies,
  headers,
} from 'next/headers'

export interface SessionUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'manager' | 'cashier'
  mustChangePassword?: boolean
}

export const SESSION_COOKIE_NAME =
  'pos_session'

export const SESSION_COOKIE =
  SESSION_COOKIE_NAME

const SESSION_TTL_HOURS = 12

// -----------------------------------------------------
// Runtime configuration
// -----------------------------------------------------

function getAuthSecret(): string {
  const secret = typeof process !== 'undefined' ? process.env?.AUTH_SECRET?.trim() : undefined
  if (!secret) {
    throw new Error('AUTH_SECRET غير مضبوط. انسخ .env.example إلى .env وضع سرًا عشوائيًا بطول 32 حرفًا على الأقل.')
  }
  if (secret.length < 32 || secret.toLowerCase().includes('replace-with')) {
    throw new Error('AUTH_SECRET ضعيف أو ما زال في قيمة المثال؛ استخدم سرًا عشوائيًا بطول 32 حرفًا على الأقل.')
  }
  return secret
}

// -----------------------------------------------------
// Password hashing
// -----------------------------------------------------

export function hashPassword(
  pw: string
): string {
  const salt =
    crypto
      .randomBytes(16)
      .toString('hex')

  const iterations = 210_000
  const hash = crypto.pbkdf2Sync(pw, salt, iterations, 64, 'sha512').toString('hex')
  return `${salt}:${iterations}:${hash}`
}

export function verifyPassword(
  pw: string,
  stored: string
): boolean {
  if (!pw || !stored) {
    return false
  }

  const parts = stored.split(':')
  const salt = parts[0]
  const legacyFormat = parts.length === 2
  const iterations = legacyFormat ? 1_000 : Number(parts[1])
  const hash = legacyFormat ? parts[1] : parts[2]
  if (!salt || !hash || !Number.isSafeInteger(iterations) || iterations < 1_000 || iterations > 1_000_000) return false

  try {
    const verify = crypto.pbkdf2Sync(pw, salt, iterations, 64, 'sha512').toString('hex')

    const storedBuffer =
      Buffer.from(
        hash,
        'hex'
      )

    const verifyBuffer =
      Buffer.from(
        verify,
        'hex'
      )

    if (
      storedBuffer.length !==
      verifyBuffer.length
    ) {
      return false
    }

    return crypto.timingSafeEqual(
      storedBuffer,
      verifyBuffer
    )
  } catch {
    return false
  }
}

// -----------------------------------------------------
// Register (shift) PIN
// -----------------------------------------------------
// A short numeric PIN each cashier sets for themselves, used only to
// open/close their register shift — separate from their login password.
// Self-contained (does not depend on hashPassword/verifyPassword names).

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const iterations = 100_000
  const hash = crypto.pbkdf2Sync(pin, salt, iterations, 64, 'sha512').toString('hex')
  return `${salt}:${iterations}:${hash}`
}

export function verifyPin(pin: string, stored: string): boolean {
  if (!pin || !stored) return false
  const parts = stored.split(':')
  const salt = parts[0]
  const legacyFormat = parts.length === 2
  const iterations = legacyFormat ? 1_000 : Number(parts[1])
  const hash = legacyFormat ? parts[1] : parts[2]
  if (!salt || !hash || !Number.isSafeInteger(iterations) || iterations < 1_000 || iterations > 1_000_000) return false
  try {
    const verify = crypto.pbkdf2Sync(pin, salt, iterations, 64, 'sha512').toString('hex')
    const storedBuffer = Buffer.from(hash, 'hex')
    const verifyBuffer = Buffer.from(verify, 'hex')
    if (storedBuffer.length !== verifyBuffer.length) return false
    return crypto.timingSafeEqual(storedBuffer, verifyBuffer)
  } catch {
    return false
  }
}

/**
 * PIN policy: 2 to 6 digits, numeric only.
 */
export function validatePinPolicy(
  pin: string
): {
  ok: boolean
  error?: string
} {
  if (!pin || !/^[0-9]{2,6}$/.test(pin)) {
    return {
      ok: false,
      error: 'الرقم السري يجب أن يكون من 2 إلى 6 أرقام',
    }
  }
  return { ok: true }
}


// -----------------------------------------------------
// Password policy
// -----------------------------------------------------

/**
 * Password policy:
 * - minimum 8 characters
 * - at least one Latin uppercase letter
 * - at least one digit
 * - at least one special character
 */
export function validatePasswordPolicy(
  pw: string
): {
  ok: boolean
  error?: string
} {
  if (
    !pw ||
    pw.length < 8
  ) {
    return {
      ok: false,
      error:
        'كلمة المرور يجب أن تكون 8 أحرف على الأقل',
    }
  }

  if (
    !/[A-Z]/.test(pw)
  ) {
    return {
      ok: false,
      error:
        'كلمة المرور يجب أن تحتوي على حرف لاتيني كبير (A-Z)',
    }
  }

  if (
    !/[0-9]/.test(pw)
  ) {
    return {
      ok: false,
      error:
        'كلمة المرور يجب أن تحتوي على رقم',
    }
  }

  if (
    !/[^a-zA-Z0-9]/.test(pw)
  ) {
    return {
      ok: false,
      error:
        'كلمة المرور يجب أن تحتوي على رمز خاص (@$!%*#?&...)',
    }
  }

  return {
    ok: true,
  }
}

// -----------------------------------------------------
// Session tokens
// -----------------------------------------------------

export function createSessionToken(
  user: SessionUser
): string {
  const payload = {
    ...user,
    exp:
      Date.now() +
      SESSION_TTL_HOURS *
        3600_000,
  }

  const body =
    Buffer.from(
      JSON.stringify(
        payload
      )
    ).toString(
      'base64url'
    )

  const signature =
    crypto
      .createHmac(
        'sha256',
        getAuthSecret()
      )
      .update(body)
      .digest(
        'base64url'
      )

  return `${body}.${signature}`
}

export function verifySessionToken(
  token:
    | string
    | undefined
    | null
): SessionUser | null {
  if (!token) {
    return null
  }

  const [
    body,
    signature,
  ] = token.split('.')

  if (
    !body ||
    !signature
  ) {
    return null
  }

  try {
    const expectedSignature = crypto.createHmac('sha256', getAuthSecret()).update(body).digest()
    const receivedSignature = Buffer.from(signature, 'base64url')
    if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) {
      return null
    }

    const payload =
      JSON.parse(
        Buffer.from(
          body,
          'base64url'
        ).toString()
      )

    if (
      !payload?.exp ||
      payload.exp <
        Date.now()
    ) {
      return null
    }

    if (
      !payload?.id ||
      !payload?.username ||
      !payload?.name ||
      !payload?.role
    ) {
      return null
    }

    let role:
      | 'admin'
      | 'manager'
      | 'cashier'

    if (
      payload.role ===
      'admin'
    ) {
      role = 'admin'
    } else if (
      payload.role ===
      'manager'
    ) {
      role = 'manager'
    } else {
      role = 'cashier'
    }

    return {
      id: String(
        payload.id
      ),
      username: String(
        payload.username
      ),
      name: String(
        payload.name
      ),
      role,
      mustChangePassword:
        Boolean(
          payload.mustChangePassword
        ),
    }
  } catch {
    return null
  }
}

export const SESSION_MAX_AGE =
  SESSION_TTL_HOURS * 3600

// -----------------------------------------------------
// Server-side helpers
// -----------------------------------------------------

export async function getCurrentUser(options: { allowMustChangePassword?: boolean } = {}): Promise<SessionUser | null> {
  try {
    const cookieStore =
      await cookies()

    const token =
      cookieStore.get(
        SESSION_COOKIE_NAME
      )?.value

    const decoded = verifySessionToken(token)
    if (!decoded) return null

    // Sessions are revalidated against the local database on every request,
    // so disabling a user or changing their role takes effect immediately.
    const liveUser = await db.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, name: true, role: true, active: true },
    })
    if (!liveUser?.active) return null

    const changeFlag = await db.setting.findUnique({ where: { key: `mustChangePw:${liveUser.id}` } })
    const mustChangePassword = changeFlag?.value === '1'
    if (mustChangePassword && !options.allowMustChangePassword) return null

    const role: SessionUser['role'] | null = ['admin', 'manager', 'cashier'].includes(liveUser.role) ? liveUser.role as SessionUser['role'] : null
    if (!role) return null

    return {
      id: liveUser.id,
      username: liveUser.username,
      name: liveUser.name,
      role,
      mustChangePassword,
    }
  } catch {
    return null
  }
}

export async function requireUser(
  allowedRoles?: string[]
): Promise<SessionUser> {
  const user =
    await getCurrentUser()

  if (!user) {
    throw new Response(
      JSON.stringify({
        error:
          'غير مصرح — الرجاء تسجيل الدخول',
      }),
      {
        status: 401,
        headers: {
          'Content-Type':
            'application/json',
        },
      }
    )
  }

  if (
    allowedRoles &&
    !allowedRoles.includes(
      user.role
    )
  ) {
    throw new Response(
      JSON.stringify({
        error:
          'لا تملك صلاحية لهذا الإجراء',
      }),
      {
        status: 403,
        headers: {
          'Content-Type':
            'application/json',
        },
      }
    )
  }

  return user
}

// -----------------------------------------------------
// Client IP
// -----------------------------------------------------

export async function getClientIp(): Promise<string | null> {
  try {
    const h =
      await headers()

    return (
      h
        .get(
          'x-forwarded-for'
        )
        ?.split(',')[0]
        ?.trim() ||
      h.get(
        'x-real-ip'
      ) ||
      h.get(
        'cf-connecting-ip'
      ) ||
      null
    )
  } catch {
    return null
  }
}

// -----------------------------------------------------
// Manager PIN
// -----------------------------------------------------

export async function verifyManagerPin(pin: string): Promise<boolean> {
  if (!pin) return false

  try {
    const row = await db.setting.findUnique({ where: { key: 'managerPin' } })
    // Only a dedicated global manager-approval credential is accepted here.
    // A user's shift PIN must never authorize discounted sales.
    return Boolean(row?.value && verifyPassword(pin, row.value))
  } catch {
    return false
  }
}

// -----------------------------------------------------
// Bootstrap admin
// -----------------------------------------------------

export async function ensureSeedAdmin(): Promise<void> {
  const count =
    await db.user.count()

  if (count === 0) {
    const admin =
      await db.user.create({
        data: {
          username: 'admin',
          passwordHash:
            hashPassword(
              'admin123'
            ),
          name:
            'المدير العام',
          role: 'admin',
        },
      })

    await flagMustChangePassword(admin.id)

    console.log(
      '✓ Created bootstrap admin in the local database; change the password at first login.'
    )
  }
}

// -----------------------------------------------------
// Password-change flag
// -----------------------------------------------------

export async function flagMustChangePassword(
  userId: string
): Promise<void> {
  await db.setting.upsert({
    where: {
      key: `mustChangePw:${userId}`,
    },

    update: {
      value: '1',
    },

    create: {
      key: `mustChangePw:${userId}`,
      value: '1',
    },
  })
}

export async function clearMustChangePassword(
  userId: string
): Promise<void> {
  await db.setting.deleteMany({
    where: {
      key: `mustChangePw:${userId}`,
    },
  })
}

export async function getMustChangePassword(
  userId: string
): Promise<boolean> {
  const row =
    await db.setting.findUnique({
      where: {
        key: `mustChangePw:${userId}`,
      },
    })

  return row?.value === '1'
}
