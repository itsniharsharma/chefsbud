import { io } from 'socket.io-client'

let socketClient = null
const connectionListeners = new Set()

function notifyDashboardSocketConnection() {
  const connected = Boolean(socketClient?.connected)
  connectionListeners.forEach((listener) => listener(connected))
}

function bindDashboardSocketLifecycle(socket) {
  if (socket.__chefsBudLifecycleBound) {
    return socket
  }

  socket.__chefsBudLifecycleBound = true
  socket.on('connect', notifyDashboardSocketConnection)
  socket.on('disconnect', notifyDashboardSocketConnection)
  return socket
}

function getSocketBaseUrl() {
  const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '/api').trim()

  if (!apiBaseUrl || apiBaseUrl === '/api') {
    return window.location.origin
  }

  if (apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://')) {
    return apiBaseUrl.replace(/\/?api\/?$/, '')
  }

  return window.location.origin
}

export function getDashboardSocket() {
  if (socketClient) return socketClient

  socketClient = bindDashboardSocketLifecycle(io(getSocketBaseUrl(), {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelayMax: 4_000,
    auth: {
      token: localStorage.getItem('chefs_bud_token') || '',
    },
  }))

  return socketClient
}

export function subscribeDashboardSocketConnection(listener) {
  connectionListeners.add(listener)
  return () => {
    connectionListeners.delete(listener)
  }
}

export function getDashboardSocketConnected() {
  return Boolean(socketClient?.connected)
}

export function disconnectDashboardSocket() {
  if (!socketClient) return
  socketClient.disconnect()
  notifyDashboardSocketConnection()
}
