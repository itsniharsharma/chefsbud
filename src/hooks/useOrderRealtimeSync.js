import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getDashboardSocket } from '../services/socketService'
import { queryKeys } from '../lib/queryKeys'

const ORDER_INVALIDATION_DEBOUNCE_MS = 250

export function useOrderRealtimeSync({ restaurantId, enabled = true }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !restaurantId) return undefined

    const socket = getDashboardSocket()
    socket.auth = {
      token: localStorage.getItem('chefs_bud_token') || '',
    }
    socket.connect()

    const roomPayload = {
      restaurantId,
    }

    let invalidationTimer = null
    let shouldRefreshAnalyticsCards = false

    const flushInvalidations = () => {
      invalidationTimer = null

      queryClient.invalidateQueries({
        queryKey: ['dashboard', 'orders-board', restaurantId],
      })
      queryClient.invalidateQueries({
        queryKey: ['dashboard', 'recent-orders', restaurantId],
      })

      if (shouldRefreshAnalyticsCards) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard.analyticsCards(restaurantId),
        })
      }

      shouldRefreshAnalyticsCards = false
    }

    const invalidateOrders = (payload = {}) => {
      const eventType = String(payload?.type || '').trim()
      const nextStatus = String(payload?.orderStatus || '').trim()

      if (eventType === 'created' || eventType === 'deleted' || nextStatus === 'Completed') {
        shouldRefreshAnalyticsCards = true
      }

      if (invalidationTimer) {
        return
      }

      invalidationTimer = setTimeout(flushInvalidations, ORDER_INVALIDATION_DEBOUNCE_MS)
    }

    const onConnected = () => {
      socket.emit('dashboard:join-restaurant', roomPayload)
    }

    const onOrderChanged = (payload) => {
      invalidateOrders(payload)
    }

    socket.on('connect', onConnected)
    socket.on('order:changed', onOrderChanged)

    if (socket.connected) {
      onConnected()
    }

    return () => {
      if (invalidationTimer) {
        clearTimeout(invalidationTimer)
        invalidationTimer = null
      }
      socket.emit('dashboard:leave-restaurant', roomPayload)
      socket.off('connect', onConnected)
      socket.off('order:changed', onOrderChanged)
      socket.disconnect()
    }
  }, [enabled, restaurantId, queryClient])
}
