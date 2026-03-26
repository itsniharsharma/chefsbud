import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getDashboardSocket } from '../services/socketService'
import { queryKeys } from '../lib/queryKeys'

const CLIENT_INVALIDATE_THROTTLE_MS = 1500

export function useInventoryRealtimeSync({ restaurantId, enabled = true }) {
  const queryClient = useQueryClient()
  const lastInvalidateRef = useRef(0)

  useEffect(() => {
    if (!enabled || !restaurantId) return undefined

    const socket = getDashboardSocket()

    const invalidateInventoryAnalytics = () => {
      const now = Date.now()
      if (now - lastInvalidateRef.current < CLIENT_INVALIDATE_THROTTLE_MS) {
        return
      }

      lastInvalidateRef.current = now
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.analyticsOverview(restaurantId),
      })
    }

    const onInventoryChanged = (payload = {}) => {
      if (String(payload?.restaurantId || '') !== String(restaurantId)) {
        return
      }
      invalidateInventoryAnalytics()
    }

    socket.on('inventory:changed', onInventoryChanged)

    return () => {
      socket.off('inventory:changed', onInventoryChanged)
    }
  }, [enabled, restaurantId, queryClient])
}
