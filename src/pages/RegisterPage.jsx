import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import FormInput from '../components/FormInput'
import Button from '../components/Button'
import { authService } from '../services/authService'
import { hasBillingAccess } from '../utils/billingAccess'

export default function RegisterPage() {
  const [tab, setTab] = useState('signup')

  // signup state
  const [step, setStep] = useState('details')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [restaurantName, setRestaurantName] = useState('')
  const [gstin, setGstin] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // login state
  const [loginMode, setLoginMode] = useState('manager')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [staffUsername, setStaffUsername] = useState('')
  const [staffPasskey, setStaffPasskey] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  const { initiateRegistration, verifyRegistration, login, staffLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const onSubmitDetails = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')

    try {
      const response = await initiateRegistration({
        name,
        email,
        password,
        restaurantName,
        gstin: gstin.trim().toUpperCase().replace(/\s+/g, ''),
        address,
        phone,
      })
      setStep('verify')
      setInfo(response?.message || 'Verification code sent to your email')
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const onVerifyCode = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')

    try {
      await verifyRegistration({
        email,
        code: verificationCode.trim(),
      })
      navigate('/plans', {
        replace: true,
        state: {
          autoStartPlan: 'hybrid',
          source: 'registration',
        },
      })
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const onResendCode = async () => {
    setResendLoading(true)
    setError('')
    setInfo('')
    try {
      const response = await authService.resendRegistrationCode({ email })
      setInfo(response?.message || 'A new verification code has been sent')
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Unable to resend code')
    } finally {
      setResendLoading(false)
    }
  }

  const onLoginSubmit = async (event) => {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const result =
        loginMode === 'staff'
          ? await staffLogin({ username: staffUsername, passkey: staffPasskey })
          : await login({ email: loginEmail, password: loginPassword })

      if (!hasBillingAccess(result?.user?.billing)) {
        navigate('/plans', { replace: true })
        return
      }

      const defaultDashboard = result?.user?.role === 'staff' ? '/dashboard/orders' : '/dashboard'
      navigate(location.state?.from?.pathname || defaultDashboard, { replace: true })
    } catch (requestError) {
      setLoginError(requestError?.response?.data?.message || 'Login failed. Please try again.')
    } finally {
      setLoginLoading(false)
    }
  }

  return (
    <div className="auth-shell px-4 py-8 md:px-6 md:py-10">
      <div className="auth-frame mx-auto w-full max-w-6xl overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <aside className="auth-brand-panel hidden p-8 lg:col-span-5 lg:block">
            <div className="auth-brand-content">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">Owner Access</p>
              <h2 className="mt-3 text-4xl font-bold leading-tight">Premium control for premium hospitality teams</h2>
              <p className="mt-4 text-sm text-white">
                Sign up once, verify your email, and move straight into a single subscription checkout to unlock your dashboard.
              </p>

              <div className="mt-8 space-y-3">
                <div className="auth-feature px-4 py-3 text-sm">
                  Fast owner onboarding with email verification
                </div>
                <div className="auth-feature px-4 py-3 text-sm">
                  One payment today that covers setup plus your first month
                </div>
                <div className="auth-feature px-4 py-3 text-sm">
                  Automated monthly billing with access protection and grace handling
                </div>
              </div>
            </div>
          </aside>

          <section className="p-5 sm:p-7 lg:col-span-7 lg:p-10">
            <Link to="/overview" className="mb-4 inline-block text-sm font-semibold text-slate-700 hover:text-[var(--primary)]">
              ← Back to Overview
            </Link>

            <div className="auth-tab-wrap mb-5 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  className={`auth-tab-button px-3 py-2 text-sm font-semibold transition ${tab === 'signup' ? 'active' : 'hover:text-slate-900'}`}
                  onClick={() => {
                    setTab('signup')
                    setError('')
                    setInfo('')
                  }}
                >
                  Sign Up
                </button>
                <button
                  type="button"
                  className={`auth-tab-button px-3 py-2 text-sm font-semibold transition ${tab === 'login' ? 'active' : 'hover:text-slate-900'}`}
                  onClick={() => {
                    setTab('login')
                    setLoginError('')
                  }}
                >
                  Login
                </button>
              </div>
            </div>

            {tab === 'login' ? (
              <>
                <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Welcome back</h1>
                <p className="mb-5 mt-2 text-sm text-slate-700">Choose how you want to access your workspace.</p>

                <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => { setLoginMode('manager'); setLoginError('') }}
                    className={`auth-mode-button p-4 text-left transition ${loginMode === 'manager' ? 'active' : ''}`}
                  >
                    <p className="auth-mode-button-title text-sm">Login As Manager</p>
                    <p className="auth-mode-button-copy mt-1 text-xs">Full access to all modules and settings.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMode('staff'); setLoginError('') }}
                    className={`auth-mode-button p-4 text-left transition ${loginMode === 'staff' ? 'active' : ''}`}
                  >
                    <p className="auth-mode-button-title text-sm">Login As Staff</p>
                    <p className="auth-mode-button-copy mt-1 text-xs">Access Orders, Menu, Offers and Billing.</p>
                  </button>
                </div>

                {loginError && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-[var(--primary)]">{loginError}</p>}

                <form className="space-y-3" onSubmit={onLoginSubmit}>
                  {loginMode === 'manager' ? (
                    <>
                      <FormInput label="Email" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required />
                      <FormInput label="Password" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                    </>
                  ) : (
                    <>
                      <FormInput label="Staff Username" value={staffUsername} onChange={(e) => setStaffUsername(e.target.value)} required />
                      <FormInput label="Passkey" type="password" value={staffPasskey} onChange={(e) => setStaffPasskey(e.target.value)} required />
                    </>
                  )}
                  <Button className="mt-4 w-full" type="submit" disabled={loginLoading}>
                    {loginLoading ? 'Signing in...' : loginMode === 'staff' ? 'Login as Staff' : 'Login as Manager'}
                  </Button>
                  {loginMode === 'manager' ? (
                    <p className="mt-3 text-sm text-slate-600">
                      New here?{' '}
                      <button type="button" className="font-semibold text-[var(--primary)]" onClick={() => { setTab('signup'); setLoginError('') }}>
                        Sign up
                      </button>
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">Staff credentials are created by the manager from Settings.</p>
                  )}
                </form>
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                  {step === 'details' ? 'Create owner account' : 'Verify your email'}
                </h1>

                <p className="mb-5 mt-2 text-sm text-slate-700">
                  {step === 'details'
                    ? 'Set up your profile and restaurant details to begin.'
                    : 'Enter the 6-digit code sent to your email to continue.'}
                </p>

                {error ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-[var(--primary)]">{error}</p> : null}
                {info ? <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p> : null}

                <form className="space-y-3" onSubmit={step === 'details' ? onSubmitDetails : onVerifyCode}>
                  {step === 'details' ? (
                    <>
                      <FormInput label="Full Name" value={name} onChange={(e) => setName(e.target.value)} required />
                      <FormInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                      <FormInput
                        label="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <FormInput
                        label="Restaurant Name"
                        value={restaurantName}
                        onChange={(e) => setRestaurantName(e.target.value)}
                        required
                      />
                      <FormInput
                        label="GSTIN"
                        value={gstin}
                        onChange={(e) => setGstin(e.target.value)}
                        placeholder="22AAAAA0000A1Z5"
                        required
                      />
                      <FormInput label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
                      <FormInput label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </>
                  ) : (
                    <>
                      <FormInput label="Email" type="email" value={email} disabled required />
                      <FormInput
                        label="Verification Code"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="Enter 6-digit code"
                        required
                      />
                      <button
                        type="button"
                        className="text-sm font-semibold text-slate-700 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={onResendCode}
                        disabled={resendLoading}
                      >
                        {resendLoading ? 'Resending code...' : 'Resend code'}
                      </button>
                    </>
                  )}

                  <Button className="mt-4 w-full" type="submit" disabled={loading || (step === 'verify' && verificationCode.length < 6)}>
                    {loading
                      ? step === 'details'
                        ? 'Sending code...'
                        : 'Verifying...'
                      : step === 'details'
                        ? 'Send verification code'
                        : 'Verify and continue'}
                  </Button>

                  {step === 'verify' ? (
                    <button
                      type="button"
                      className="mt-2 text-sm font-semibold text-slate-600 hover:text-[var(--primary)]"
                      onClick={() => {
                        setStep('details')
                        setVerificationCode('')
                        setError('')
                        setInfo('')
                      }}
                    >
                      Edit registration details
                    </button>
                  ) : null}
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
