import Button from '../../../components/Button'
import { ANALYTICS_RANGE_OPTIONS } from '../constants'

export default function TimeFilter({ range, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ANALYTICS_RANGE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          variant={range === option.value ? 'primary' : 'secondary'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
