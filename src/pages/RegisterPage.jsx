import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import FormInput from '../components/FormInput'
import Button from '../components/Button'
import { authService } from '../services/authService'

export default function RegisterPage() {
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
  const { initiateRegistration, verifyRegistration } = useAuth()
  const navigate = useNavigate()

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
      navigate('/plans', { replace: true })
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_-10%,rgba(229,9,20,0.18),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(2,6,23,0.12),transparent_30%),#f6f8fc] px-4 py-8 md:px-6 md:py-10">
      <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.14)]">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <aside className="relative hidden overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-[#101b3a] p-8 text-white lg:col-span-5 lg:block">
            <div className="absolute -right-20 -top-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(229,9,20,0.45),transparent_68%)]" />
            <div className="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.14),transparent_72%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.03)_0%,rgba(255,255,255,0.12)_42%,rgba(255,255,255,0.02)_100%)]" />

            <div className="relative z-10">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-200">Owner Access</p>
              <h2 className="mt-3 text-4xl font-bold leading-tight">Premium control for premium hospitality teams</h2>
              <p className="mt-4 text-sm text-slate-200">
                Sign up to configure your workspace, then complete plan activation to unlock dashboard access.
              </p>

              <div className="mt-8 space-y-3">
                <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                  Fast owner onboarding with email verification
                </div>
                <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                  Mandatory setup payment plus monthly autopay authorization
                </div>
                <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                  Billing-aware access guard for protected routes
                </div>
              </div>
            </div>
          </aside>

          <section className="p-5 sm:p-7 lg:col-span-7 lg:p-10">
            <Link to="/overview" className="mb-4 inline-block text-sm font-semibold text-slate-600 hover:text-[var(--primary)]">
              ← Back to Overview
            </Link>

            <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm"
                  onClick={() => {
                    setError('')
                    setInfo('')
                  }}
                >
                  Sign Up
                </button>
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
                  onClick={() => {
                    navigate('/login', { replace: true })
                    setError('')
                    setInfo('')
                  }}
                >
                  Login
                </button>
              </div>
            </div>

            <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
              {step === 'details' ? 'Create owner account' : 'Verify your email'}
            </h1>
            <p className="mb-5 mt-2 text-sm text-slate-500">
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
          </section>
        </div>
      </div>
    </div>
  )
}
