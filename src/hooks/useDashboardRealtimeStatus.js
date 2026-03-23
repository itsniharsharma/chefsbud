import { useSyncExternalStore } from 'react'
import {
  getDashboardSocket,
  getDashboardSocketConnected,
  subscribeDashboardSocketConnection,
} from '../services/socketService'

export function useDashboardRealtimeStatus(enabled = true) {
  if (enabled) {
    getDashboardSocket()
  }

  return useSyncExternalStore(
    subscribeDashboardSocketConnection,
    getDashboardSocketConnected,
    () => false,
  )
}