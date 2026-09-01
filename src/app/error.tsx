'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console for debugging (could be sent to Sentry in prod)
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-background to-amber-50 dark:from-red-950/30 dark:via-background dark:to-amber-950/20 p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-destructive text-destructive-foreground shadow-lg">
            <AlertTriangle className="size-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">حدث خطأ غير متوقع</h1>
          <p className="text-sm text-muted-foreground">
            نعتذر عن هذا الإزعاج. يمكنك المحاولة مرة أخرى أو العودة للصفحة الرئيسية.
          </p>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs mb-4">
          <p className="font-mono break-all text-muted-foreground">
            {error.message || 'Unknown error'}
            {error.digest && (
              <span className="block mt-1 text-[10px]">Digest: {error.digest}</span>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={reset} className="flex-1">
            <RefreshCw className="size-4" /> إعادة المحاولة
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              window.location.href = '/'
            }}
          >
            العودة للرئيسية
          </Button>
        </div>
      </div>
    </div>
  )
}
