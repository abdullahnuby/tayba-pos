import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'
import { env as cloudflareEnv } from 'cloudflare:workers'

/**
 * Cloudflare Workers has no persistent filesystem, so a plain
 * `file:./db/tayba.db` SQLite datasource can never work there —
 * and the native Prisma query engine binary cannot run in the
 * Workers V8 isolate at all, regardless of `binaryTargets`.
 *
 * On Cloudflare we use D1 (Cloudflare's own SQLite-compatible
 * edge database) through Prisma's driver adapter, which talks to
 * D1 over the Workers binding instead of a native engine binary.
 *
 * Locally (vinext dev / next dev / tests), there is no D1 binding,
 * so we fall back to the traditional file-based SQLite engine —
 * that path still needs the query engine binary, which is why
 * we keep `binaryTargets` in schema.prisma for local/dev builds.
 *
 * Cloudflare's `cloudflare:workers` module exposes Worker bindings
 * directly to server-side Vinext code. We use the static `env`
 * import here so the production Worker always receives the real
 * D1 binding instead of falling through to an unconfigured Prisma
 * client.
 */

type D1Database = ConstructorParameters<typeof PrismaD1>[0]

type CloudflareEnv = {
  DB?: D1Database
}

function getD1Binding(): D1Database | undefined {
  try {
    return (cloudflareEnv as CloudflareEnv).DB
  } catch {
    // Not running inside a Cloudflare Worker.
    return undefined
  }
}

const logLevels =
  process.env.NODE_ENV === 'development'
    ? (['warn', 'error'] as const)
    : (['error'] as const)

async function createPrismaClient(): Promise<PrismaClient> {
  const d1 = getD1Binding()

  if (d1) {
    const adapter = new PrismaD1(d1)
    return new PrismaClient({ adapter, log: [...logLevels] })
  }

  // Local/dev fallback only.
  const databaseUrl =
    process.env.DATABASE_URL || 'file:./db/tayba.db'

  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: [...logLevels],
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaInitPromise?: Promise<PrismaClient>
}

// Top-level await: resolves once per Worker isolate. The D1 binding
// (like KV/env vars) is available at module-evaluation time in the
// Workers ES module runtime, not just inside a request handler.
const prismaInstance: PrismaClient =
  globalForPrisma.prisma ??
  (await (globalForPrisma.prismaInitPromise ??=
    createPrismaClient()))

export const db: any = prismaInstance

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

const fieldAliases = {
  minQuantity: 'minQuantity',
  reorderQty: 'reorderQty',
}

Object.defineProperty(db.productVariant, 'fields', {
  value: fieldAliases,
  enumerable: false,
  configurable: true,
})

function parseNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

async function buildInvoiceNumber(
  tx: any,
  prefixKey: string,
  counterKey: string,
  fallbackPrefix: string
): Promise<string> {
  const prefixRow = await tx.setting.findUnique({
    where: { key: prefixKey },
  })

  const counterRow = await tx.setting.findUnique({
    where: { key: counterKey },
  })

  const prefix =
    (prefixRow ? prefixRow.value : fallbackPrefix) ||
    fallbackPrefix

  const current = parseNumber(counterRow?.value, 0)
  const next = Math.max(0, current) + 1
  const normalized = String(next).padStart(6, '0')

  await tx.setting.upsert({
    where: { key: counterKey },
    create: {
      key: counterKey,
      value: String(next),
    },
    update: {
      value: String(next),
    },
  })

  return `${prefix}-${normalized}`
}

export async function atomicAction<T = any>(
  action: string,
  payload: Record<string, any> = {}
): Promise<T> {
  const input = payload.payload ?? payload

  switch (action) {
    case 'commit_sale': {
      const items = Array.isArray(input.items) ? input.items : []

      if (!items.length) {
        throw new Error(
          'الفاتورة يجب أن تحتوي على منتج واحد على الأقل'
        )
      }

      const subtotal = items.reduce(
        (sum: number, item: any) =>
          sum +
          Number(item.unitPrice || 0) *
            Number(item.quantity || 0),
        0
      )

      const discount = parseNumber(input.discount, 0)

      const taxEnabled =
        String(
          (
            await db.setting.findUnique({
              where: { key: 'vatEnabled' },
            })
          )?.value || 'false'
        ).toLowerCase() === 'true'

      const vatRate = parseNumber(
        (
          await db.setting.findUnique({
            where: { key: 'vatRate' },
          })
        )?.value || 14,
        14
      )

      const afterDiscount = Math.max(
        0,
        subtotal - discount
      )

      const taxAmount = taxEnabled
        ? afterDiscount * (vatRate / 100)
        : 0

      const total = afterDiscount + taxAmount

      const paid = parseNumber(input.paid, 0)

      const change = Math.max(
        0,
        paid - total
      )

      const status = input.status || 'completed'
      const completed = status === 'completed'

      const sale = await db.$transaction(async (tx: any) => {
        const saleData = await tx.sale.create({
          data: {
            invoiceNo: await buildInvoiceNumber(
              tx,
              'saleInvoicePrefix',
              'saleCounter',
              'INV'
            ),
            customerId: input.customerId || null,
            userId: input.userId || null,
            date: new Date(
              input.date || Date.now()
            ),
            subtotal,
            discount,
            taxRate: taxEnabled ? vatRate : 0,
            taxAmount,
            total,
            paid,
            change,
            paymentMethod:
              input.paymentMethod || 'cash',
            status,
            notes: input.notes || null,
          },
        })

        const createdItems: any[] = []
        const decrements = new Map<string, number>()

        for (const item of items) {
          const variantId = String(item.variantId)

          const variant =
            await tx.productVariant.findUnique({
              where: { id: variantId },
            })

          if (!variant) {
            throw new Error(
              'بعض المنتجات غير موجودة'
            )
          }

          const qty = Number(
            item.quantity || 0
          )

          if (
            completed &&
            variant.quantity < qty
          ) {
            throw new Error(
              `المخزون غير كافٍ لـ ${
                variant.sku || variant.id
              }`
            )
          }

          decrements.set(
            variantId,
            (decrements.get(variantId) || 0) +
              qty
          )

          const saleItem =
            await tx.saleItem.create({
              data: {
                saleId: saleData.id,
                variantId,
                quantity: qty,
                unitPrice: Number(
                  item.unitPrice || 0
                ),
                unitCost: Number(
                  variant.costPrice || 0
                ),
                total:
                  Number(
                    item.unitPrice || 0
                  ) * qty,
              },
            })

          createdItems.push(saleItem)
        }

        if (completed) {
          for (const [
            variantId,
            qty,
          ] of decrements) {
            await tx.productVariant.update({
              where: { id: variantId },
              data: {
                quantity: {
                  decrement: qty,
                },
              },
            })
          }

          if (
            input.customerId &&
            total - paid > 0
          ) {
            await tx.customer.update({
              where: {
                id: input.customerId,
              },
              data: {
                balance: {
                  increment:
                    total - paid,
                },
              },
            })
          }
        }

        return {
          ...saleData,
          items: createdItems,
        }
      })

      return sale as T
    }

    case 'commit_sale_return': {
      const items = Array.isArray(input.items)
        ? input.items
        : []

      const sale =
        await db.sale.findUnique({
          where: {
            id: input.saleId,
          },
          include: {
            items: true,
          },
        })

      if (!sale) {
        throw new Error(
          'الفاتورة غير موجودة'
        )
      }

      const createdReturn =
        await db.$transaction(async (tx: any) => {
          const returnNo =
            await buildInvoiceNumber(
              tx,
              'returnPrefix',
              'returnCounter',
              'RET'
            )

          const created =
            await tx.saleReturn.create({
              data: {
                returnNo,
                saleId: sale.id,
                customerId:
                  sale.customerId || null,
                date: new Date(
                  input.date || Date.now()
                ),
                subtotal: 0,
                total: 0,
                reason:
                  input.reason || null,
                notes:
                  input.notes || null,
                status: 'completed',
              },
            })

          let subtotal = 0

          for (const item of items) {
            const saleItem =
              await tx.saleItem.findUnique({
                where: {
                  id: item.saleItemId,
                },
              })

            if (!saleItem) {
              throw new Error(
                'بند الفاتورة غير صحيح'
              )
            }

            const qty = Number(
              item.quantity || 0
            )

            subtotal +=
              Number(
                item.unitPrice || 0
              ) * qty

            await tx.saleReturnItem.create({
              data: {
                saleReturnId: created.id,
                saleItemId: saleItem.id,
                variantId:
                  saleItem.variantId,
                quantity: qty,
                unitPrice: Number(
                  item.unitPrice || 0
                ),
                total:
                  Number(
                    item.unitPrice || 0
                  ) * qty,
              },
            })

            await tx.productVariant.update({
              where: {
                id: saleItem.variantId,
              },
              data: {
                quantity: {
                  increment: qty,
                },
              },
            })
          }

          await tx.saleReturn.update({
            where: {
              id: created.id,
            },
            data: {
              subtotal,
              total: subtotal,
            },
          })

          const allReturned =
            sale.items.every(
              (saleItem: any) => {
                const returnedQty =
                  items
                    .filter(
                      (it: any) =>
                        it.saleItemId ===
                        saleItem.id
                    )
                    .reduce(
                      (
                        sum: number,
                        it: any
                      ) =>
                        sum +
                        Number(
                          it.quantity || 0
                        ),
                      0
                    )

                return (
                  returnedQty >=
                  saleItem.quantity
                )
              }
            )

          await tx.sale.update({
            where: {
              id: sale.id,
            },
            data: {
              status: allReturned
                ? 'returned'
                : 'partial_return',
            },
          })

          return {
            ...created,
            subtotal,
            total: subtotal,
          }
        })

      return createdReturn as T
    }

    case 'commit_purchase': {
      const items = Array.isArray(input.items)
        ? input.items
        : []

      if (!items.length) {
        throw new Error(
          'فاتورة الشراء يجب أن تحتوي على بند واحد على الأقل'
        )
      }

      const subtotal = items.reduce(
        (sum: number, item: any) =>
          sum +
          Number(item.unitCost || 0) *
            Number(item.quantity || 0),
        0
      )

      const discount = parseNumber(
        input.discount,
        0
      )

      const taxEnabled =
        String(
          (
            await db.setting.findUnique({
              where: {
                key: 'vatEnabled',
              },
            })
          )?.value || 'false'
        ).toLowerCase() === 'true'

      const vatRate = parseNumber(
        (
          await db.setting.findUnique({
            where: {
              key: 'vatRate',
            },
          })
        )?.value || 14,
        14
      )

      const afterDiscount = Math.max(
        0,
        subtotal - discount
      )

      const taxAmount = taxEnabled
        ? afterDiscount * (vatRate / 100)
        : 0

      const total =
        afterDiscount + taxAmount

      const paid = parseNumber(
        input.paid,
        0
      )

      const completed =
        (input.status || 'completed') ===
        'completed'

      const purchase =
        await db.$transaction(async (tx: any) => {
          const created =
            await tx.purchase.create({
              data: {
                invoiceNo:
                  await buildInvoiceNumber(
                    tx,
                    'purchaseInvoicePrefix',
                    'purchaseCounter',
                    'PUR'
                  ),
                supplierId:
                  input.supplierId,
                date: new Date(
                  input.date || Date.now()
                ),
                subtotal,
                discount,
                taxRate: taxEnabled
                  ? vatRate
                  : 0,
                taxAmount,
                total,
                paid,
                status:
                  input.status ||
                  'completed',
                notes:
                  input.notes || null,
              },
            })

          for (const item of items) {
            const variantId = String(
              item.variantId
            )

            const variant =
              await tx.productVariant.findUnique(
                {
                  where: {
                    id: variantId,
                  },
                }
              )

            if (!variant) {
              throw new Error(
                'بعض المنتجات غير موجودة'
              )
            }

            const qty = Number(
              item.quantity || 0
            )

            const unitCost = Number(
              item.unitCost || 0
            )

            await tx.purchaseItem.create({
              data: {
                purchaseId: created.id,
                variantId,
                quantity: qty,
                unitCost,
                total:
                  unitCost * qty,
                enteredQuantity:
                  Number(
                    item.enteredQuantity ||
                      qty
                  ),
                unit:
                  item.unit || 'piece',
                unitFactor:
                  Number(
                    item.unitFactor || 1
                  ),
              },
            })

            if (completed) {
              await tx.productVariant.update({
                where: {
                  id: variantId,
                },
                data: {
                  quantity: {
                    increment: qty,
                  },
                  costPrice:
                    ((variant.quantity *
                      variant.costPrice) +
                      qty * unitCost) /
                    Math.max(
                      1,
                      variant.quantity +
                        qty
                    ),
                },
              })
            }
          }

          if (
            completed &&
            total - paid > 0
          ) {
            await tx.supplier.update({
              where: {
                id: input.supplierId,
              },
              data: {
                balance: {
                  increment:
                    total - paid,
                },
              },
            })
          }

          return {
            ...created,
            items,
          }
        })

      return purchase as T
    }

    case 'void_sale': {
      const sale =
        await db.sale.findUnique({
          where: {
            id: input.saleId,
          },
          include: {
            items: true,
          },
        })

      if (!sale) {
        throw new Error(
          'الفاتورة غير موجودة'
        )
      }

      return await db.$transaction(
        async (tx: any) => {
          for (const item of sale.items) {
            await tx.productVariant.update({
              where: {
                id: item.variantId,
              },
              data: {
                quantity: {
                  increment:
                    item.quantity,
                },
              },
            })
          }

          if (
            sale.customerId &&
            Number(sale.total || 0) -
              Number(sale.paid || 0) >
              0
          ) {
            await tx.customer.update({
              where: {
                id: sale.customerId,
              },
              data: {
                balance: {
                  decrement:
                    Number(
                      sale.total || 0
                    ) -
                    Number(
                      sale.paid || 0
                    ),
                },
              },
            })
          }

          return tx.sale.update({
            where: {
              id: sale.id,
            },
            data: {
              status: 'voided',
              voidReason:
                input.voidReason ||
                'إلغاء بدون سبب',
            },
          })
        }
      )
    }

    case 'resume_sale': {
      const sale =
        await db.sale.findUnique({
          where: {
            id: input.saleId,
          },
          include: {
            items: true,
          },
        })

      if (!sale) {
        throw new Error(
          'الفاتورة غير موجودة'
        )
      }

      return await db.$transaction(
        async (tx: any) => {
          for (const item of sale.items) {
            const variant =
              await tx.productVariant.findUnique(
                {
                  where: {
                    id: item.variantId,
                  },
                }
              )

            if (
              !variant ||
              variant.quantity <
                item.quantity
            ) {
              throw new Error(
                'مخزون غير كافٍ'
              )
            }
          }

          for (const item of sale.items) {
            await tx.productVariant.update({
              where: {
                id: item.variantId,
              },
              data: {
                quantity: {
                  decrement:
                    item.quantity,
                },
              },
            })
          }

          return tx.sale.update({
            where: {
              id: sale.id,
            },
            data: {
              status: 'completed',
            },
          })
        }
      )
    }

    case 'commit_stock_adjustment': {
      const payloadItem =
        input.payload ?? input

      const variantId = String(
        payloadItem.variantId
      )

      const change = Number(
        payloadItem.quantityChange || 0
      )

      if (!change) {
        throw new Error(
          'قيمة التعديل غير صحيحة'
        )
      }

      const variant =
        await db.productVariant.findUnique(
          {
            where: {
              id: variantId,
            },
          }
        )

      if (!variant) {
        throw new Error(
          'المنتج غير موجود'
        )
      }

      const nextQuantity =
        variant.quantity + change

      if (nextQuantity < 0) {
        throw new Error(
          'التعديل سيؤدي إلى مخزون سالب'
        )
      }

      return await db.$transaction(
        async (tx: any) => {
          const created =
            await tx.stockAdjustment.create(
              {
                data: {
                  variantId,
                  userId:
                    payloadItem.userId ||
                    null,
                  type:
                    payloadItem.type ||
                    'adjustment',
                  quantityChange:
                    change,
                  reason:
                    payloadItem.reason ||
                    null,
                  notes:
                    payloadItem.notes ||
                    null,
                },
              }
            )

          await tx.productVariant.update({
            where: {
              id: variantId,
            },
            data: {
              quantity: nextQuantity,
            },
          })

          return created
        }
      )
    }

    case 'void_purchase': {
      const purchase =
        await db.purchase.findUnique({
          where: {
            id: input.purchaseId,
          },
          include: {
            items: true,
          },
        })

      if (!purchase) {
        throw new Error(
          'فاتورة الشراء غير موجودة'
        )
      }

      return await db.$transaction(
        async (tx: any) => {
          for (const item of purchase.items) {
            const variant =
              await tx.productVariant.findUnique(
                {
                  where: {
                    id: item.variantId,
                  },
                }
              )

            const newQty =
              (variant?.quantity || 0) -
              item.quantity

            if (newQty < 0) {
              throw new Error(
                'لا يمكن إلغاء الشراء'
              )
            }

            await tx.productVariant.update({
              where: {
                id: item.variantId,
              },
              data: {
                quantity: newQty,
              },
            })
          }

          if (
            purchase.supplierId &&
            Number(purchase.total || 0) -
              Number(purchase.paid || 0) >
              0
          ) {
            await tx.supplier.update({
              where: {
                id: purchase.supplierId,
              },
              data: {
                balance: {
                  decrement:
                    Number(
                      purchase.total || 0
                    ) -
                    Number(
                      purchase.paid || 0
                    ),
                },
              },
            })
          }

          return tx.purchase.update({
            where: {
              id: purchase.id,
            },
            data: {
              status: 'voided',
              notes:
                (purchase.notes || '') +
                ` [void: ${
                  input.voidReason ||
                  'إلغاء بدون سبب'
                }]`,
            },
          })
        }
      )
    }

    default:
      throw new Error(
        `Unsupported atomic action: ${action}`
      )
  }
}

export type DatabaseModelName = keyof PrismaClient