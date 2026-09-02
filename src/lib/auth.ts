/**
 * Authentication helpers — password hashing + verification.
 * Uses Node built-in crypto (no external deps).
 *
 * Cloudflare/Vinext compatible:
 * - AUTH_SECRET is read lazily at runtime.
 * - No top-level process.env.AUTH_SECRET evaluation.
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
  try {
    if (
      typeof process !== 'undefined' &&
      process.env &&
      typeof process.env.AUTH_SECRET === 'string' &&
      process.env.AUTH_SECRET.trim() !== ''
    ) {
      return process.env.AUTH_SECRET
    }
  } catch {
    // Ignore runtime environment access errors.
  }

  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error('AUTH_SECRET is required in production')
  }

  // Development fallback only.
  return 'pos-clothing-store-secret-change-in-prod'
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

  const hash =
    crypto
      .pbkdf2Sync(
        pw,
        salt,
        1000,
        64,
        'sha512'
      )
      .toString('hex')

  return `${salt}:${hash}`
}

export function verifyPassword(
  pw: string,
  stored: string
): boolean {
  if (!pw || !stored) {
    return false
  }

  const [
    salt,
    hash,
  ] = stored.split(':')

  if (!salt || !hash) {
    return false
  }

  try {
    const verify =
      crypto
        .pbkdf2Sync(
          pw,
          salt,
          1000,
          64,
          'sha512'
        )
        .toString('hex')

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
    const expectedSignature =
      crypto
        .createHmac(
          'sha256',
          getAuthSecret()
        )
        .update(body)
        .digest(
          'base64url'
        )

    if (
      signature !==
      expectedSignature
    ) {
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

export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const cookieStore =
      await cookies()

    const token =
      cookieStore.get(
        SESSION_COOKIE_NAME
      )?.value

    return verifySessionToken(
      token
    )
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

export async function verifyManagerPin(
  pin: string
): Promise<boolean> {
  if (!pin) {
    return false
  }

  try {
    const row =
      await db.setting.findUnique({
        where: {
          key: 'managerPin',
        },
      })

    if (!row?.value) {
      return false
    }

    return verifyPassword(
      pin,
      row.value
    )
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
      '✓ Created bootstrap admin on the sheet: admin / admin123 (must change on first login)'
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
