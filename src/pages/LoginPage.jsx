import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import FormInput from '../components/FormInput'
import Button from '../components/Button'
import { hasBillingAccess } from '../utils/billingAccess'

export default function LoginPage() {
  const [mode, setMode] = useState('manager')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [staffUsername, setStaffUsername] = useState('')
  const [staffPasskey, setStaffPasskey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login, staffLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const onSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result =
        mode === 'staff'
          ? await staffLogin({ username: staffUsername, passkey: staffPasskey })
          : await login({ email, password })

      if (!hasBillingAccess(result?.user?.billing)) {
        navigate('/plans', {
          replace: true,
          state: {
            source: 'login',
          },
        })
        return
      }

      const defaultDashboard = result?.user?.role === 'staff' ? '/dashboard/orders' : '/dashboard'
      navigate(location.state?.from?.pathname || defaultDashboard, { replace: true })
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <form className="card w-full max-w-xl p-6" onSubmit={onSubmit}>
        <Link to="/" className="mb-4 inline-block text-sm font-semibold text-slate-600 hover:text-[var(--primary)]">
          ← Back to Landing
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Login to Chef's Bud</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">Choose how you want to access your workspace</p>
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setMode('manager')
              setError('')
            }}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === 'manager'
                ? 'border-red-300 bg-red-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-red-200'
            }`}
          >
            <p className="text-sm font-semibold text-slate-900">Login As Manager</p>
            <p className="mt-1 text-xs text-slate-600">Full access to all modules and settings.</p>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('staff')
              setError('')
            }}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === 'staff'
                ? 'border-red-300 bg-red-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-red-200'
            }`}
          >
            <p className="text-sm font-semibold text-slate-900">Login As Staff</p>
            <p className="mt-1 text-xs text-slate-600">Access only Orders, Menu, Offers and Billing.</p>
          </button>
        </div>
        {error && <p className="mb-3 text-sm text-[var(--primary)]">{error}</p>}
        <div className="space-y-3">
          {mode === 'manager' ? (
            <>
              <FormInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <FormInput
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          ) : (
            <>
              <FormInput
                label="Staff Username"
                value={staffUsername}
                onChange={(e) => setStaffUsername(e.target.value)}
              />
              <FormInput
                label="Passkey"
                type="password"
                value={staffPasskey}
                onChange={(e) => setStaffPasskey(e.target.value)}
              />
            </>
          )}
        </div>
        <Button className="mt-5 w-full" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : mode === 'staff' ? 'Login as Staff' : 'Login as Manager'}
        </Button>
        {mode === 'manager' ? (
          <p className="mt-4 text-sm text-slate-600">
            New here?{' '}
            <Link to="/register" className="font-semibold text-[var(--primary)]">
              Sign up
            </Link>
          </p>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Staff credentials are created by the manager from Settings.</p>
        )}
      </form>
    </div>
  )
}
