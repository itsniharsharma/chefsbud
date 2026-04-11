export function getOrderDisplayNumber(order) {
  const dailyOrderNumber = Number(order?.dailyOrderNumber)
  if (Number.isInteger(dailyOrderNumber) && dailyOrderNumber > 0) {
    return String(dailyOrderNumber)
  }

  return '0'
}