'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // CRITICAL #3 fix: shorter stale time for POS — cashier needs to see
            // inventory changes from other cashiers within 5 seconds
            staleTime: 5 * 1000,  // 5 seconds (was 30s)
            gcTime: 5 * 60 * 1000,  // 5 minutes garbage collect
            refetchOnWindowFocus: true,  // refetch when user returns to POS tab
            refetchOnReconnect: true,
            retry: 2,
          },
          mutations: {
            retry: 0,  // no retry on mutations — user should see the error
          },
        },
      })
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
