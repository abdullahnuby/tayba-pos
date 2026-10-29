/**
 * Pure signed-session token helpers. Kept free of Next.js and database imports
 * so token integrity can be tested directly with Node.
 */
import * as crypto from 'crypto'

export interface SessionUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'manager' | 'cashier'
  mustChangePassword?: boolean
}

const SESSION_TTL_HOURS = 12

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

export function createSessionToken(
  user: SessionUser,
  sessionEpoch = '0',
): string {
  const payload = {
    ...user,
    sessionEpoch,
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
): (SessionUser & { sessionEpoch: string }) | null {
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
      !payload?.role ||
      typeof payload?.sessionEpoch !== 'string' ||
      !payload.sessionEpoch
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
      sessionEpoch: payload.sessionEpoch,
    }
  } catch {
    return null
  }
}


export const SESSION_MAX_AGE = SESSION_TTL_HOURS * 3600
