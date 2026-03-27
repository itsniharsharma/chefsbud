import { io } from 'socket.io-client'

let socketClient = null
const connectionListeners = new Set()
let dashboardRoomReady = false

function notifyDashboardSocketConnection() {
  const connected = Boolean(socketClient?.connected && dashboardRoomReady)
  connectionListeners.forEach((listener) => listener(connected))
}

function setDashboardRoomReady(nextValue) {
  const normalized = Boolean(nextValue)
  if (dashboardRoomReady === normalized) return
  dashboardRoomReady = normalized
  notifyDashboardSocketConnection()
}

function bindDashboardSocketLifecycle(socket) {
  if (socket.__chefsBudLifecycleBound) {
    return socket
  }

  socket.__chefsBudLifecycleBound = true
  socket.on('connect', () => {
    setDashboardRoomReady(false)
    notifyDashboardSocketConnection()
  })
  socket.on('disconnect', () => {
    setDashboardRoomReady(false)
    notifyDashboardSocketConnection()
  })
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
  return Boolean(socketClient?.connected && dashboardRoomReady)
}

export function setDashboardSocketRoomReady(isReady) {
  setDashboardRoomReady(Boolean(isReady))
}

export function disconnectDashboardSocket() {
  if (!socketClient) return
  setDashboardRoomReady(false)
  socketClient.disconnect()
  notifyDashboardSocketConnection()
}
