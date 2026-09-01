import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  hashPassword,
  validatePasswordPolicy,
  clearMustChangePassword,
} from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import {
  applyRateLimit,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { z } from 'zod'

const setupSchema = z.object({
  username: z
    .string()
    .min(
      3,
      'اسم المستخدم يجب أن يكون 3 أحرف على الأقل'
    ),

  password: z
    .string()
    .min(1),

  name: z
    .string()
    .min(2),

  storeName: z
    .string()
    .min(1),

  storeAddress: z
    .string()
    .optional()
    .default(''),

  storePhone: z
    .string()
    .optional()
    .default(''),

  vatEnabled: z
    .boolean()
    .default(false),

  vatRate: z
    .number()
    .min(0)
    .max(50)
    .default(14),
})

/**
 * First-time setup endpoint.
 *
 * Creates the first admin user and initial store settings.
 */
export async function POST(
  req: NextRequest
) {
  try {
    const limited =
      applyRateLimit(
        req,
        'setup',
        RATE_LIMITS.setup.max,
        RATE_LIMITS.setup.window
      )

    if (limited) {
      return limited
    }

    const userCount =
      await db.user.count()

    if (userCount > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'النظام مُهيأ بالفعل. سجل دخول كـ admin لتعديل المستخدمين.',
        },
        {
          status: 400,
        }
      )
    }

    const body =
      await req.json()

    const parsed =
      setupSchema.safeParse(
        body
      )

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed
              .error
              .issues[0]
              ?.message ||
            'بيانات غير صحيحة',
        },
        {
          status: 400,
        }
      )
    }

    const data =
      parsed.data

    const policy =
      validatePasswordPolicy(
        data.password
      )

    if (!policy.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: policy.error,
        },
        {
          status: 400,
        }
      )
    }

    const result =
      await db.$transaction(
        async (tx: any) => {
          const admin =
            await tx.user.create({
              data: {
                username:
                  data.username,

                passwordHash:
                  hashPassword(
                    data.password
                  ),

                name:
                  data.name,

                role:
                  'admin',
              },
            })

          const settings = [
            [
              'storeName',
              data.storeName,
            ],

            [
              'storeAddress',
              data.storeAddress,
            ],

            [
              'storePhone',
              data.storePhone,
            ],

            [
              'vatEnabled',
              String(
                data.vatEnabled
              ),
            ],

            [
              'vatRate',
              String(
                data.vatRate
              ),
            ],

            [
              'vatInclusive',
              'false',
            ],

            [
              'saleInvoicePrefix',
              'INV',
            ],

            [
              'purchaseInvoicePrefix',
              'PUR',
            ],

            [
              'returnPrefix',
              'RET',
            ],

            [
              'saleCounter',
              '0',
            ],

            [
              'purchaseCounter',
              '0',
            ],

            [
              'returnCounter',
              '0',
            ],

            [
              'currency',
              'EGP',
            ],

            [
              'loyaltyEnabled',
              'true',
            ],

            [
              'loyaltyRate',
              '0.01',
            ],

            [
              'receiptFooter',
              'شكراً لزيارتكم',
            ],

            [
              'autoSyncEnabled',
              'true',
            ],
          ] as const

          for (
            const [
              key,
              value,
            ] of settings
          ) {
            await tx.setting.upsert(
              {
                where: {
                  key,
                },

                update: {
                  value,
                },

                create: {
                  key,
                  value,
                },
              }
            )
          }

          return admin
        }
      )

    await clearMustChangePassword(
      result.id
    )

    await auditLog({
      user: {
        id: result.id,
        username:
          result.username,
        name: result.name,
        role: 'admin',
      },

      action: 'create',

      entity: 'user',

      entityId:
        result.id,

      after: {
        username:
          result.username,
        role: 'admin',
      },
    })

    return NextResponse.json(
      {
        ok: true,

        message:
          'تم إعداد النظام بنجاح. سجل دخول الآن.',

        user: {
          id: result.id,

          username:
            result.username,

          name:
            result.name,

          role:
            'admin',
        },
      },

      {
        status: 201,
      }
    )
  } catch (
    e: unknown
  ) {
    console.error(
      'AUTH_SETUP_POST_ERROR',
      e
    )

    const err =
      e as {
        message?: string
        stack?: string
      }

    return NextResponse.json(
      {
        ok: false,

        error:
          err.message ||
          'خطأ في الإعداد',
      },

      {
        status: 500,
      }
    )
  }
}

/**
 * Check whether first-time setup is required.
 */
export async function GET() {
  try {
    const count =
      await db.user.count()

    return NextResponse.json(
      {
        ok: true,

        needsSetup:
          count === 0,
      },

      {
        status: 200,

        headers: {
          'cache-control':
            'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (
    e: unknown
  ) {
    console.error(
      'AUTH_SETUP_GET_ERROR',
      e
    )

    const err =
      e as {
        message?: string
        stack?: string
      }

    return NextResponse.json(
      {
        ok: false,

        error:
          err.message ||
          'تعذر التحقق من حالة إعداد النظام',
      },

      {
        status: 500,
      }
    )
  }
}
