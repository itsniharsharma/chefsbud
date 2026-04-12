import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getDashboardSocket, setDashboardSocketRoomReady } from '../services/socketService'
import { bindOrderAlertAudioUnlock, playOrderAlertSound } from '../services/orderAlertAudio'
import { queryKeys } from '../lib/queryKeys'

const ORDER_INVALIDATION_DEBOUNCE_MS = 250
const ROOM_JOIN_RETRY_MS = 2500

function showOrderDesktopNotification(payload = {}) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return

  const orderId = String(payload?.orderId || payload?._id || '').trim()
  const suffix = orderId ? orderId.slice(-6).toUpperCase() : ''
  const notification = new Notification('New QR Order Received', {
    body: suffix ? `Order #${suffix} is waiting.` : 'A new order is waiting.',
    tag: orderId ? `order-${orderId}` : 'order-new',
    renotify: true,
  })

  notification.onclick = () => {
    window.focus()
    notification.close()
  }
}

function bindDesktopNotificationPermissionBootstrap() {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return () => {}
  if (Notification.permission !== 'default') return () => {}

  const onInteraction = () => {
    Notification.requestPermission().catch(() => {})
    window.removeEventListener('pointerdown', onInteraction)
    window.removeEventListener('keydown', onInteraction)
    window.removeEventListener('touchstart', onInteraction)
  }

  window.addEventListener('pointerdown', onInteraction, { once: true, passive: true })
  window.addEventListener('keydown', onInteraction, { once: true })
  window.addEventListener('touchstart', onInteraction, { once: true, passive: true })

  return () => {
    window.removeEventListener('pointerdown', onInteraction)
    window.removeEventListener('keydown', onInteraction)
    window.removeEventListener('touchstart', onInteraction)
  }
}

export function useOrderRealtimeSync({ restaurantId, enabled = true, enableSoundNotifications = false }) {
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
    let joinRetryTimer = null
    let shouldRefreshAnalyticsCards = false
    let unbindNotificationPermissionBootstrap = () => {}

    if (enableSoundNotifications) {
      bindOrderAlertAudioUnlock()
      unbindNotificationPermissionBootstrap = bindDesktopNotificationPermissionBootstrap()
    }

    const clearJoinRetry = () => {
      if (!joinRetryTimer) return
      clearTimeout(joinRetryTimer)
      joinRetryTimer = null
    }

    const scheduleJoinRetry = () => {
      if (joinRetryTimer) return
      joinRetryTimer = setTimeout(() => {
        joinRetryTimer = null
        requestRoomJoin()
      }, ROOM_JOIN_RETRY_MS)
    }

    const requestRoomJoin = () => {
      if (!socket.connected) return

      socket.emit('dashboard:join-restaurant', roomPayload, (ack = {}) => {
        if (ack?.ok) {
          setDashboardSocketRoomReady(true)
          clearJoinRetry()
          return
        }

        setDashboardSocketRoomReady(false)
        scheduleJoinRetry()
      })
    }

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
      setDashboardSocketRoomReady(false)
      requestRoomJoin()
    }

    const onOrderChanged = async (payload) => {
      const eventType = String(payload?.type || '').trim()

      if (eventType === 'created') {
        if (enableSoundNotifications) {
          showOrderDesktopNotification(payload)
        }

        if (enableSoundNotifications) {
          await playOrderAlertSound()
        }

        await queryClient.refetchQueries({
          queryKey: ['dashboard', 'orders-board', restaurantId],
          type: 'active',
        })

        return
      }

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
      clearJoinRetry()
      unbindNotificationPermissionBootstrap()
      setDashboardSocketRoomReady(false)
      socket.emit('dashboard:leave-restaurant', roomPayload)
      socket.off('connect', onConnected)
      socket.off('order:changed', onOrderChanged)
      socket.disconnect()
    }
  }, [enabled, restaurantId, queryClient, enableSoundNotifications])
}
