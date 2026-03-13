import { io } from 'socket.io-client'

let socketClient = null

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

  socketClient = io(getSocketBaseUrl(), {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelayMax: 4_000,
    auth: {
      token: localStorage.getItem('chefs_bud_token') || '',
    },
  })

  return socketClient
}

export function disconnectDashboardSocket() {
  if (!socketClient) return
  socketClient.disconnect()
}
