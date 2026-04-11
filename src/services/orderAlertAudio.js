let alertAudio = null
let unlockListenersBound = false
let playbackUnlocked = false
let pendingPlayRequested = false

function getAlertAudio() {
  if (alertAudio) return alertAudio

  alertAudio = new Audio('/sound.mp3')
  alertAudio.preload = 'auto'
  alertAudio.volume = 1
  return alertAudio
}

async function unlockPlayback() {
  const audio = getAlertAudio()

  try {
    audio.muted = true
    audio.currentTime = 0
    await audio.play()
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    playbackUnlocked = true

    if (pendingPlayRequested) {
      pendingPlayRequested = false
      audio.currentTime = 0
      await audio.play()
    }

    return true
  } catch {
    audio.muted = false
    return false
  }
}

export function bindOrderAlertAudioUnlock() {
  if (unlockListenersBound) return
  unlockListenersBound = true

  const onFirstInteraction = () => {
    const events = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((eventName) => {
      window.removeEventListener(eventName, onFirstInteraction)
    })
    unlockListenersBound = false
    void unlockPlayback()
  }

  ;['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, onFirstInteraction, { once: true, passive: true })
  })

  if (navigator.userActivation?.hasBeenActive) {
    void unlockPlayback()
  }
}

export async function playOrderAlertSound() {
  const audio = getAlertAudio()

  if (!playbackUnlocked) {
    await unlockPlayback()
  }

  try {
    audio.currentTime = 0
    await audio.play()
    return true
  } catch {
    pendingPlayRequested = true
    return false
  }
}
