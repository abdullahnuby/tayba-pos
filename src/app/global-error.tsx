'use client'

import { useEffect } from 'react'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Global error boundary — catches errors that escape the root layout
 * (e.g. errors thrown in layout.tsx itself or during render).
 * Must render its own <html> and <body> tags.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          background: 'oklch(0.16 0.01 165)',
          color: 'oklch(0.96 0.005 95)',
          margin: 0,
          padding: '2rem',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: '500px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
            خطأ حرج في النظام
          </h1>
          <p style={{ color: 'oklch(0.7 0.01 95)', marginBottom: '2rem' }}>
            حدث خطأ منع تحميل الواجهة. حاول تحديث الصفحة.
          </p>
          <pre
            style={{
              background: 'oklch(0.21 0.012 165)',
              padding: '1rem',
              borderRadius: '8px',
              fontSize: '0.75rem',
              textAlign: 'left',
              direction: 'ltr',
              marginBottom: '2rem',
              overflow: 'auto',
            }}
          >
            {error.message || 'Unknown error'}
            {error.digest ? `\nDigest: ${error.digest}` : ''}
          </pre>
          <button
            onClick={reset}
            style={{
              background: 'oklch(0.65 0.13 165)',
              color: 'oklch(0.16 0.01 165)',
              border: 'none',
              padding: '0.75rem 2rem',
              borderRadius: '8px',
              fontSize: '1rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  )
}
