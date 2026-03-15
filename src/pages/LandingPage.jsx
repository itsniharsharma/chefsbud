import { Link } from 'react-router-dom'
import Button from '../components/Button'
import MarketingHeader from '../components/MarketingHeader'

const heroStories = [
  'Command menu, tables, live orders, and analytics from one elegant control room.',
  'Convert walk-ins into repeat guests with speed, consistency, and smart offers.',
  'Replace chaos with a premium operating system designed for modern hospitality brands.',
]

const platformPillars = [
  {
    title: 'Guest Experience Engine',
    text: 'Fast, polished QR ordering with checkout and status tracking guests actually enjoy using.',
    badge: 'Experience',
  },
  {
    title: 'Operations Command Center',
    text: 'Kitchen, floor, and billing workflows stay synchronized in real time throughout service.',
    badge: 'Ops',
  },
  {
    title: 'Revenue Intelligence Layer',
    text: 'Surface high-margin dishes, slow time windows, and promotion ROI with clarity.',
    badge: 'Growth',
  },
  {
    title: 'Offer Intelligence Studio',
    text: 'Design strategic offers with AI-assisted prompts and strict validation before publish.',
    badge: 'AI + Offers',
  },
]

const trustMetrics = [
  { value: '99.95%', label: 'Dashboard Availability Target' },
  { value: '<250ms', label: 'Critical Route Response Target' },
  { value: 'Role-Based', label: 'Owner Access Controls' },
  { value: 'Realtime', label: 'Order Lifecycle Visibility' },
]

const marqueeItems = [
  'Live Orders',
  'Premium Guest UX',
  'Menu Intelligence',
  'Offer Studio',
  'Revenue Analytics',
  'Table QR Flow',
  'Role Security',
  'Operational Clarity',
]

const marqueeLoopItems = [...marqueeItems, ...marqueeItems]

const outcomes = [
  {
    title: 'Faster Table Turnover',
    text: 'Reduce waiting friction by moving ordering and updates into a simple customer flow.',
    figure: '+31%',
  },
  {
    title: 'Higher Offer Conversion',
    text: 'Deploy smarter promotions based on actual basket behavior and timing windows.',
    figure: '+29%',
  },
  {
    title: 'More Predictable Service',
    text: 'Give managers a live signal of queue pressure, delays, and payment completion.',
    figure: '+42%',
  },
]

const stackCards = [
  {
    title: 'Owner Dashboard',
    bullets: ['Live cards for revenue, orders, and active tables', 'Modular navigation for menu, offers, billing, analytics', 'Single workspace for management and decisions'],
  },
  {
    title: 'Customer Ordering Surface',
    bullets: ['QR table route with branded menu experience', 'Cart, coupon, and checkout journey', 'Order tracking and status timeline'],
  },
  {
    title: 'Data + Automation Layer',
    bullets: ['Offer draft parser and validation pipeline', 'Cached analytics responses for speed', 'Structured service-level control paths'],
  },
]

const demoStages = [
  {
    title: 'Stage 1: Brand Setup',
    text: 'Create owner account, configure restaurant identity, and activate pricing plan.',
    image: '/img/im_1.png',
  },
  {
    title: 'Stage 2: Menu + Tables',
    text: 'Publish menu and generate table QR cards for instant customer ordering.',
    image: '/img/im_2.png',
  },
  {
    title: 'Stage 3: Service Flow',
    text: 'Track kitchen progress and keep guests informed with live order statuses.',
    image: '/img/im_3.png',
  },
  {
    title: 'Stage 4: Optimization',
    text: 'Analyze data, tune offers, and improve average ticket value continuously.',
    image: '/img/im_4.png',
  },
]

const faqItems = [
  {
    q: 'Is Chef\'s Bud only for large chains?',
    a: 'No. The platform is designed so ambitious single-outlet restaurants can operate with enterprise-level clarity from day one.',
  },
  {
    q: 'How quickly can we go live?',
    a: 'Most teams can configure restaurant profile, menu, and table QR flow in one short setup session.',
  },
  {
    q: 'Can we optimize offers without risking bad rules?',
    a: 'Yes. Offer creation includes structured validation and guided draft flow so promotions are controlled before launch.',
  },
  {
    q: 'Will this work on mobile and desktop for staff?',
    a: 'Yes. The UI is responsive and optimized for mixed device operations across owners, managers, and floor teams.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f8f8fb] text-slate-900">
      <MarketingHeader />

      <main id="home" className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="relative overflow-hidden rounded-3xl border border-red-100 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0f172a] p-6 text-white shadow-[0_24px_60px_rgba(2,6,23,0.35)] md:p-10">
          <div className="absolute -right-20 top-10 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(229,9,20,0.48),transparent_68%)]" />
          <div className="absolute -left-24 bottom-0 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.2),transparent_70%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.08)_50%,transparent_100%)]" />

          <div className="relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-200">Premium Restaurant Growth Platform</p>
              <h1 className="mt-3 text-4xl font-bold leading-tight md:text-6xl">
                {/* Build a Restaurant */}
                Anmol Randi
                <span className="block text-red-300">People Remember for Service</span>
              </h1>
              <p className="mt-5 max-w-2xl text-sm text-slate-200 md:text-base">
                Chef's Bud gives owners a clear command layer across guest experience, floor execution, and revenue strategy.
                Launch faster, operate cleaner, and scale with confidence.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/plans">
                  <Button className="px-7 py-3">Start With Pricing</Button>
                </Link>
                <Link to="/register">
                  <Button variant="secondary" className="px-7 py-3">Owner Sign Up</Button>
                </Link>
                <Link to="/platform">
                  <Button variant="secondary" className="px-7 py-3 bg-white/10 text-white border-white/30 hover:bg-white/20 hover:text-white">
                    Watch Platform Journey
                  </Button>
                </Link>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                {trustMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-slate-100 backdrop-blur">
                    <p className="text-lg font-bold text-red-200">{metric.value}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-200">{metric.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4">
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md">
                <p className="text-[11px] uppercase tracking-[0.28em] text-red-200">Why Teams Choose It</p>
                <div className="mt-3 space-y-3">
                  {heroStories.map((line) => (
                    <div key={line} className="rounded-xl border border-white/15 bg-slate-950/30 px-3 py-2 text-sm text-slate-100">
                      {line}
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-white/20 bg-white/10 p-3">
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-300">Trust Highlights</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-100">
                    <li>JWT auth and owner-bound data isolation</li>
                    <li>Structured offer validation before publish</li>
                    <li>Performance-aware dashboard and analytics design</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-red-100 bg-white py-3 shadow-sm">
          <div className="landing-marquee-track">
            {marqueeLoopItems.map((item, index) => (
              <div key={`${item}-${index}`} className="landing-marquee-chip">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section id="platform" className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {platformPillars.map((card) => (
            <article key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">{card.badge}</p>
              <h3 className="mt-2 text-xl font-bold text-slate-900">{card.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{card.text}</p>
            </article>
          ))}
        </section>

        <section id="about" className="landing-lazy-section mt-12 grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="rounded-3xl border border-red-100 bg-gradient-to-br from-white to-red-50 p-7 shadow-[0_16px_30px_rgba(229,9,20,0.08)] md:col-span-7">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Business Outcomes</p>
            <h2 className="mt-2 text-3xl font-bold">Designed for ambitious operators who care about both speed and brand quality</h2>
            <p className="mt-4 text-slate-600">
              A premium interface is only useful when operations get measurably better. Chef's Bud is built to improve
              throughput, consistency, and revenue confidence in the same system.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {outcomes.map((impact) => (
                <div key={impact.title} className="rounded-xl border border-red-100 bg-white p-4">
                  <p className="text-2xl font-bold text-[var(--primary)]">{impact.figure}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">{impact.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{impact.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:col-span-5">
            {stackCards.map((stack) => (
              <article key={stack.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Platform Module</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">{stack.title}</h3>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  {stack.bullets.map((point) => (
                    <p key={point}>• {point}</p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="app-views" className="landing-lazy-section mt-12">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Demonstration Journey</p>
          <h2 className="mt-2 text-3xl font-bold">From setup to daily excellence in four strategic stages</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {demoStages.map((step) => (
              <article key={step.title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
                <div className="h-40 overflow-hidden border-b border-red-100 bg-slate-100">
                  <img
                    src={step.image}
                    alt={step.title}
                    className="h-full w-full object-cover object-top transition-transform duration-300 hover:scale-105"
                    loading="lazy"
                    decoding="async"
                    width="1280"
                    height="720"
                  />
                </div>
                <div className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Operational Stage</p>
                  <h3 className="mt-2 font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{step.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="trust" className="landing-lazy-section mt-12 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] md:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Trust and Credibility</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">Built to inspire confidence before a single order is placed</h2>
            <p className="mt-3 text-sm text-slate-600 md:text-base">
              Premium brands win through consistency. Your landing experience should communicate discipline, control,
              and reliability from the first scroll.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">Owner-level data access</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">Real-time order visibility</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">Validated offer workflow</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">Multi-module platform consistency</div>
            </div>
          </div>
        </section>

        <section className="landing-lazy-section mt-12 grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">FAQ</p>
            <h2 className="mt-2 text-2xl font-bold">Questions decision-makers ask before switching systems</h2>
            <div className="mt-4 space-y-3">
              {faqItems.map((item) => (
                <details key={item.q} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer list-none font-semibold text-slate-800">{item.q}</summary>
                  <p className="mt-2 text-sm text-slate-600">{item.a}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-red-100 bg-gradient-to-br from-white to-red-50 p-6 shadow-[0_14px_28px_rgba(229,9,20,0.1)] lg:col-span-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Ready to Launch Better</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Move from reactive operations to controlled growth</h3>
            <p className="mt-3 text-sm text-slate-600">
              Start with pricing, complete setup, and bring premium digital service to every table in your restaurant.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/plans">
                <Button className="px-6 py-3">Explore Pricing</Button>
              </Link>
              <Link to="/register">
                <Button variant="secondary" className="px-6 py-3">Owner Sign Up</Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-lazy-section mt-12 rounded-3xl border border-red-100 bg-gradient-to-r from-slate-950 via-slate-900 to-[#0f172a] p-7 text-white shadow-[0_24px_40px_rgba(15,23,42,0.35)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-200">Final Call</p>
          <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold md:text-4xl">Run your restaurant like a premium, data-aware brand</h2>
              <p className="mt-2 text-sm text-slate-200 md:text-base">
                Build a guest experience your team can execute consistently and your customers want to come back for.
              </p>
            </div>
            <Link to="/plans">
              <Button className="px-8 py-3">Start Your Setup</Button>
            </Link>
          </div>
        </section>

      </main>

      <footer id="contact" className="mt-10 border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-slate-600 md:flex-row md:items-center md:justify-between md:px-6">
          <p>© {new Date().getFullYear()} Chef's Bud - Premium Restaurant Revenue OS</p>
          <div className="flex gap-5">
            <a href="mailto:chefsbudofficial@gmail.com" className="hover:text-[var(--primary)]">
              chefsbudofficial@gmail.com
            </a>
            <a href="tel:+919815454626" className="hover:text-[var(--primary)]">
              +91 9815454626
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
