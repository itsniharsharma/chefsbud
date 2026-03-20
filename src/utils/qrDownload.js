export async function createLabeledQrDataUrl({
  QRCode,
  value,
  tableNumber,
  floorNumber = 1,
  qrSize = 720,
}) {
  const qrDataUrl = await QRCode.toDataURL(value, {
    width: qrSize,
    margin: 2,
    errorCorrectionLevel: 'H',
  })

  const image = await loadImage(qrDataUrl)
  const padding = Math.round(qrSize * 0.08)
  const headerHeight = Math.round(qrSize * 0.2)
  const footerHeight = Math.round(qrSize * 0.08)
  const canvas = document.createElement('canvas')
  canvas.width = image.width + padding * 2
  canvas.height = image.height + headerHeight + footerHeight + padding * 2

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas rendering is unavailable')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.fillStyle = '#111827'
  context.textAlign = 'center'
  context.font = `700 ${Math.round(qrSize * 0.08)}px Segoe UI`
  context.fillText(`Table ${tableNumber}`, canvas.width / 2, padding + Math.round(headerHeight * 0.45))

  context.font = `600 ${Math.round(qrSize * 0.055)}px Segoe UI`
  context.fillStyle = '#6b7280'
  context.fillText(`Floor ${Number(floorNumber || 1)}`, canvas.width / 2, padding + Math.round(headerHeight * 0.8))

  context.drawImage(image, padding, padding + headerHeight)

  return canvas.toDataURL('image/png')
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to render QR image'))
    image.src = source
  })
}
