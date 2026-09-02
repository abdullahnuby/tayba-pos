// PATCH FOR CURRENT COMMIT 9db3348cd7fb1e200babc21d42cc9bfe08737bf3
// Add this helper to the existing route and use it for OPEN/CLOSE credentials.
// Do NOT replace the existing register business logic.

import { verifyPassword } from '@/lib/auth'
import { hasCashierPin, verifyCashierPin } from '@/lib/cashier-pin'

export async function verifyRegisterCredential(user: any, password?: string, pin?: string) {
  const role = String(user?.role ?? '').toLowerCase()
  const isCashier = role === 'cashier' || role === 'كاشير'

  if (isCashier) {
    if (!(await hasCashierPin(user.id))) {
      return { ok: false, code: 'PIN_REQUIRED', message: 'يجب إعداد PIN للكاشير أولاً' }
    }
    if (!pin) {
      return { ok: false, code: 'PIN_REQUIRED', message: 'أدخل PIN الخاص بالكاشير' }
    }
    return (await verifyCashierPin(user.id, pin))
      ? { ok: true }
      : { ok: false, code: 'INVALID_PIN', message: 'PIN غير صحيح' }
  }

  if (!password) {
    return { ok: false, code: 'PASSWORD_REQUIRED', message: 'أدخل كلمة المرور' }
  }

  return (await verifyPassword(password, user.passwordHash))
    ? { ok: true }
    : { ok: false, code: 'INVALID_PASSWORD', message: 'كلمة المرور غير صحيحة' }
}
