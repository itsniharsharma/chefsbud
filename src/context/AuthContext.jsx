import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { authService } from '../services/authService'

export const AuthContext = createContext(null)

const TOKEN_KEY = 'chefs_bud_token'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(null)
  const [restaurant, setRestaurant] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(token))

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }, [token])

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      if (!token) {
        setAuthLoading(false)
        return
      }

      try {
        const data = await authService.me()
        if (!mounted) return
        setUser(data.user)
        setRestaurant(data.restaurant)
      } catch {
        if (!mounted) return
        setToken(null)
        setUser(null)
        setRestaurant(null)
      } finally {
        if (mounted) {
          setAuthLoading(false)
        }
      }
    }

    bootstrap()
    return () => {
      mounted = false
    }
  }, [token])

  const hydrateSession = useCallback((result) => {
    setToken(result.token)
    setUser(result.user)
    setRestaurant(result.restaurant)
  }, [])

  const refreshSession = useCallback(async () => {
    if (!token) {
      setUser(null)
      setRestaurant(null)
      return null
    }

    const data = await authService.me()
    setUser(data.user)
    setRestaurant(data.restaurant)
    return data
  }, [token])

  const login = useCallback(async (payload) => {
    const result = await authService.login(payload)
    hydrateSession(result)
    return result
  }, [hydrateSession])

  const staffLogin = useCallback(async (payload) => {
    const result = await authService.staffLogin(payload)
    hydrateSession(result)
    return result
  }, [hydrateSession])

  const initiateRegistration = useCallback(async (payload) => {
    return authService.initiateRegistration(payload)
  }, [])

  const verifyRegistration = useCallback(async (payload) => {
    const result = await authService.verifyRegistration(payload)
    hydrateSession(result)
    return result
  }, [hydrateSession])

  const logout = useCallback(async () => {
    if (token) {
      try {
        await authService.logout()
      } catch {
        // Always clear local auth state even if server logout fails.
      }
    }

    setToken(null)
    setUser(null)
    setRestaurant(null)
  }, [token])

  const value = useMemo(
    () => ({
      token,
      user,
      restaurant,
      authLoading,
      isAuthenticated: Boolean(token),
      login,
      staffLogin,
      initiateRegistration,
      verifyRegistration,
      logout,
      refreshSession,
      setUser,
      setRestaurant,
    }),
    [token, user, restaurant, authLoading, login, staffLogin, initiateRegistration, verifyRegistration, logout, refreshSession, setUser, setRestaurant],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
