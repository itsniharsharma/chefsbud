import { useNavigate } from 'react-router-dom'
import BasketCard from '../components/cards/BasketCard'
import FunnelCard from '../components/cards/FunnelCard'
import HiddenGemsCard from '../components/cards/HiddenGemsCard'
import LeakageCard from '../components/cards/LeakageCard'
import PricingCard from '../components/cards/PricingCard'
import QualityCard from '../components/cards/QualityCard'
import RevenueDriversCard from '../components/cards/RevenueDriversCard'

export default function ControlRoomPage({ cards = {} }) {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <LeakageCard data={cards?.leakage?.trend || []} onOpen={() => navigate('leakage')} />
      <HiddenGemsCard points={cards?.hiddenGems?.points || []} onOpen={() => navigate('growth-opportunities')} />
      <RevenueDriversCard split={cards?.revenueDrivers?.split || []} onOpen={() => navigate('revenue-structure')} />
      <FunnelCard steps={cards?.funnel?.steps || []} onOpen={() => navigate('funnel')} />
      <PricingCard points={cards?.pricing?.points || []} onOpen={() => navigate('pricing')} />
      <BasketCard trend={cards?.basket?.trend || []} onOpen={() => navigate('basket')} />
      <div className="xl:col-span-2">
        <QualityCard points={cards?.quality?.points || []} onOpen={() => navigate('quality')} />
      </div>
    </div>
  )
}
