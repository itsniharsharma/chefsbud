import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getDashboardSocket } from '../services/socketService'
import { queryKeys } from '../lib/queryKeys'

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

    const invalidateOrders = () => {
      queryClient.invalidateQueries({
        queryKey: ['dashboard', 'orders-board', restaurantId],
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.analyticsCards(restaurantId),
      })
    }

    const onConnected = () => {
      socket.emit('dashboard:join-restaurant', roomPayload)
    }

    const onOrderChanged = () => {
      invalidateOrders()
    }

    socket.on('connect', onConnected)
    socket.on('order:changed', onOrderChanged)

    if (socket.connected) {
      onConnected()
    }

    return () => {
      socket.emit('dashboard:leave-restaurant', roomPayload)
      socket.off('connect', onConnected)
      socket.off('order:changed', onOrderChanged)
      socket.disconnect()
    }
  }, [enabled, restaurantId, queryClient])
}
