import { create } from 'zustand'

export type SectionKey =
  | 'dashboard'
  | 'products'
  | 'purchases'
  | 'sales'
  | 'suppliers'
  | 'customers'
  | 'returns'
  | 'register'
  | 'stock-adjustments'
  | 'reports'
  | 'sync'
  | 'audit'
  | 'users'
  | 'settings'

interface AppState {
  activeSection: SectionKey
  setSection: (s: SectionKey) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: 'dashboard',
  setSection: (s) => set({ activeSection: s }),
}))
