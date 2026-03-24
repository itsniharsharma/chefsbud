import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

const navItems = [
  { to: '/overview', label: 'Overview' },
  { to: '/platform', label: 'Platform' },
  { to: '/demo', label: 'Demo' },
  { to: '/plans', label: 'Pricing' },
  { to: '/contact', label: 'Contact' },
]

function navClassName({ isActive }) {
  return isActive
    ? 'text-[var(--primary)]'
    : 'hover:text-[var(--primary)]'
}

export default function MarketingHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-red-100/70 bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Link to="/overview" className="text-2xl font-extrabold text-[var(--primary)]">
          Chef's Bud
        </Link>
        <button
          className="rounded-lg border border-red-100 px-3 py-2 text-sm font-semibold text-slate-700 md:hidden"
          onClick={() => setMobileNavOpen((prev) => !prev)}
        >
          {mobileNavOpen ? 'Close' : 'Menu'}
        </button>
        <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-700 md:flex">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClassName}>
              {item.label}
            </NavLink>
          ))}
          <Link to="/register" className="hover:text-[var(--primary)]">
            Sign Up
          </Link>
        </nav>
      </div>

      {mobileNavOpen && (
        <nav className="border-t border-red-100 bg-white px-4 py-3 md:hidden">
          <div className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `${isActive ? 'text-[var(--primary)] bg-red-50' : 'hover:bg-red-50 hover:text-[var(--primary)]'} rounded-lg px-2 py-2`
                }
                onClick={() => setMobileNavOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
            <Link
              to="/register"
              className="rounded-lg px-2 py-2 hover:bg-red-50 hover:text-[var(--primary)]"
              onClick={() => setMobileNavOpen(false)}
            >
              Sign Up
            </Link>
          </div>
        </nav>
      )}
    </header>
  )
}
