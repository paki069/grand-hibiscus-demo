'use client'

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { money } from '@/lib/format'

type ConciergeTour = {
  name: string
  location: string
  dates: string
  departures: string
  adultPrice?: string
  childPrice?: string
}

type LoyaltyGuide = {
  currency: string
  room_night_points: number
  room_addon_points: number
  spa_spend_block_amount: number
  spa_spend_block_points: number
  gym_points_per_guest_day: number
  tour_booking_points: number
  room_type_free_night_rewards: { room_type: string; points_per_night: number }[]
  gym_package_rewards: { package: string; points: number }[]
}

type GymPackage = {
  name: string
  description: string
  benefits: string[]
  price: string
  pointsEarned: number
}

type Message = {
  role: 'user' | 'assistant'
  content: string
  private?: boolean
  tourOptions?: ConciergeTour[]
  tourPrices?: ConciergeTour[]
  askIfHotelGuest?: boolean
  offerRoomBooking?: boolean
  loyaltyGuide?: LoyaltyGuide
  gymPackages?: GymPackage[]
  offerGymBooking?: boolean
  offerEventInquiry?: boolean
}

type TourAction = 'tour-guest-yes' | 'tour-guest-no'
type ConciergeResponseStyle = 'trinidadian' | 'standard'
type RecordingPointer = number | 'keyboard' | 'touch'

const CANCEL_RECORDING_DRAG_DISTANCE = 72

const suggestions = [
  'How does the loyalty programme work?',
  'What tours can I book?',
  'What time is check-in?',
  'How do QR passes work?',
  'What room would suit my stay?',
  "What's included in my room rate?",
  "What's the cancellation policy?",
  'Can you help me book a table?',
  'Are there any dining or gym offers for hotel guests?',
]

function speechChunks(value: string) {
  let remaining = value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const chunks: string[] = []
  while (remaining.length > 200) {
    let splitAt = remaining.lastIndexOf(' ', 199)
    if (splitAt <= 0) splitAt = 200
    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function speechTextForMessage(message: Message) {
  const details: string[] = []
  const tours = message.tourPrices ?? message.tourOptions
  if (tours) {
    details.push(...tours.slice(0, 5).map((tour) => [
      tour.name,
      tour.location,
      tour.dates,
      `Departures: ${tour.departures}`,
      ...(tour.adultPrice ? [`Adult price: ${tour.adultPrice}`] : []),
      ...(tour.childPrice ? [`Child price: ${tour.childPrice}`] : []),
    ].filter(Boolean).join('. ')))
    if (tours.length > 5) details.push('The full tour list is shown in the chat.')
  }
  if (message.gymPackages) {
    details.push(...message.gymPackages.slice(0, 5).map((item) => [
      item.name,
      item.price,
      `Earns ${item.pointsEarned} loyalty points`,
      item.description,
      item.benefits.join('. '),
    ].filter(Boolean).join('. ')))
    if (message.gymPackages.length > 5) details.push('The full gym plan list is shown in the chat.')
  }
  if (message.loyaltyGuide) {
    const guide = message.loyaltyGuide
    details.push(
      `Room stays earn ${guide.room_night_points} points per room night.`,
      `Room add-ons earn ${guide.room_addon_points} points each.`,
      `Spa earns ${guide.spa_spend_block_points} points per ${money(guide.spa_spend_block_amount, guide.currency)} spent.`,
      `Gym earns ${guide.gym_points_per_guest_day} points per guest, per day.`,
      `Tours earn ${guide.tour_booking_points} points per booking.`,
    )
    details.push(...guide.room_type_free_night_rewards.slice(0, 5).map((item) =>
      `${item.room_type} free night: ${item.points_per_night.toLocaleString()} points per night.`))
    details.push(...guide.gym_package_rewards.slice(0, 5).map((item) =>
      `${item.package}: ${item.points} points.`))
    if (guide.room_type_free_night_rewards.length > 5 || guide.gym_package_rewards.length > 5) {
      details.push('The full rewards list is shown in the chat.')
    }
  }
  return [message.content, ...details].filter(Boolean).join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseTours(value: unknown): ConciergeTour[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    if (!isRecord(item)
      || typeof item.name !== 'string'
      || typeof item.location !== 'string'
      || typeof item.dates !== 'string'
      || typeof item.departures !== 'string') return []
    return [{
      name: item.name,
      location: item.location,
      dates: item.dates,
      departures: item.departures,
      ...(typeof item.adultPrice === 'string' ? { adultPrice: item.adultPrice } : {}),
      ...(typeof item.childPrice === 'string' ? { childPrice: item.childPrice } : {}),
    }]
  })
}

function parseGymPackages(value: unknown): GymPackage[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    if (!isRecord(item)
      || typeof item.name !== 'string'
      || typeof item.description !== 'string'
      || typeof item.price !== 'string'
      || typeof item.pointsEarned !== 'number') return []
    return [{
      name: item.name,
      description: item.description,
      price: item.price,
      pointsEarned: item.pointsEarned,
      benefits: Array.isArray(item.benefits)
        ? item.benefits.filter((benefit): benefit is string => typeof benefit === 'string')
        : [],
    }]
  })
}

function parseLoyaltyGuide(value: unknown): LoyaltyGuide | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.currency !== 'string'
    || typeof value.room_night_points !== 'number'
    || typeof value.room_addon_points !== 'number'
    || typeof value.spa_spend_block_amount !== 'number'
    || typeof value.spa_spend_block_points !== 'number'
    || typeof value.gym_points_per_guest_day !== 'number'
    || typeof value.tour_booking_points !== 'number'
    || !Array.isArray(value.room_type_free_night_rewards)
    || !Array.isArray(value.gym_package_rewards)) return undefined
  const roomRewards: LoyaltyGuide['room_type_free_night_rewards'] = []
  for (const item of value.room_type_free_night_rewards) {
    if (isRecord(item) && typeof item.room_type === 'string' && typeof item.points_per_night === 'number') {
      roomRewards.push({ room_type: item.room_type, points_per_night: item.points_per_night })
    }
  }
  const gymRewards: LoyaltyGuide['gym_package_rewards'] = []
  for (const item of value.gym_package_rewards) {
    if (isRecord(item) && typeof item.package === 'string' && typeof item.points === 'number') {
      gymRewards.push({ package: item.package, points: item.points })
    }
  }
  return {
    currency: value.currency,
    room_night_points: value.room_night_points,
    room_addon_points: value.room_addon_points,
    spa_spend_block_amount: value.spa_spend_block_amount,
    spa_spend_block_points: value.spa_spend_block_points,
    gym_points_per_guest_day: value.gym_points_per_guest_day,
    tour_booking_points: value.tour_booking_points,
    room_type_free_night_rewards: roomRewards,
    gym_package_rewards: gymRewards,
  }
}

function TourList({ tours }: { tours: ConciergeTour[] }) {
  return (
    <ul className="concierge-detail-list">
      {tours.map((tour, index) => (
        <li key={`${tour.name}-${index}`}>
          <strong>{tour.name}</strong>{tour.location ? ` · ${tour.location}` : ''}
          <span>{tour.dates}</span>
          <span>Departures: {tour.departures}</span>
        </li>
      ))}
    </ul>
  )
}

function TourPriceList({ tours }: { tours: ConciergeTour[] }) {
  return (
    <ul className="concierge-detail-list">
      {tours.map((tour, index) => (
        <li key={`${tour.name}-${index}`}>
          <strong>{tour.name}</strong>{tour.location ? ` · ${tour.location}` : ''}
          <span>{tour.dates} · Departures: {tour.departures}</span>
          {tour.adultPrice && <span>Adult: {tour.adultPrice}{tour.childPrice ? ` · Child: ${tour.childPrice}` : ''}</span>}
        </li>
      ))}
    </ul>
  )
}

function LoyaltyRules({ guide }: { guide: LoyaltyGuide }) {
  return (
    <div className="concierge-loyalty-details">
      <p className="concierge-detail-intro">Points are added after a booking is confirmed:</p>
      <ul className="concierge-detail-list">
        <li>Room stays: {guide.room_night_points} per room night.</li>
        <li>Room add-ons: {guide.room_addon_points} per add-on.</li>
        <li>Spa: {guide.spa_spend_block_points} per {money(guide.spa_spend_block_amount, guide.currency)} spent.</li>
        <li>Gym: {guide.gym_points_per_guest_day} per guest, per day.</li>
        {guide.gym_package_rewards.map((item) => (
          <li key={item.package}>Gym {item.package}: {item.points} points.</li>
        ))}
        <li>Tours: {guide.tour_booking_points} per tour booking.</li>
      </ul>
      {guide.room_type_free_night_rewards.length > 0 && (
        <>
          <p className="concierge-detail-intro">Points can be redeemed for free-night coupons:</p>
          <ul className="concierge-detail-list">
            {guide.room_type_free_night_rewards.map((item) => (
              <li key={item.room_type}>{item.room_type}: {item.points_per_night.toLocaleString()} points per night.</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function GymPlanList({ packages }: { packages: GymPackage[] }) {
  return (
    <ul className="concierge-detail-list">
      {packages.map((gymPackage) => (
        <li key={gymPackage.name}>
          <strong>{gymPackage.name}</strong>
          <span>{gymPackage.price} · Earns {gymPackage.pointsEarned} loyalty points</span>
          {gymPackage.description && <span>{gymPackage.description}</span>}
          {gymPackage.benefits.length > 0 && <span>{gymPackage.benefits.join(' · ')}</span>}
        </li>
      ))}
    </ul>
  )
}

function ConciergeAvatar({ small = false }: { small?: boolean }) {
  return (
    <img
      className={small ? 'concierge-avatar is-small' : 'concierge-avatar'}
      src="/images/petal-concierge.png"
      alt=""
      width={48}
      height={48}
    />
  )
}

export default function GuestConcierge({
  responseStyle,
  voiceInputEnabled,
  voiceOutputEnabled,
}: {
  responseStyle: ConciergeResponseStyle
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [introVisible, setIntroVisible] = useState(true)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [awaitingTourGuest, setAwaitingTourGuest] = useState(false)
  const [recording, setRecording] = useState(false)
  const [cancelRecording, setCancelRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const microphoneStreamRef = useRef<MediaStream | null>(null)
  const discardRecordingRef = useRef(false)
  const recordingPointerRef = useRef<RecordingPointer | null>(null)
  const touchPointerIdRef = useRef<number | null>(null)
  const recordingPointerStartXRef = useRef<number | null>(null)
  const recordingPressActiveRef = useRef(false)
  const cancelRecordingRef = useRef(false)
  const keyboardActivationRef = useRef(false)
  const speechAbortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)

  function unlockAudioPlayback() {
    if (typeof window.AudioContext === 'undefined') return
    const currentContext = audioContextRef.current
    const context = currentContext && currentContext.state !== 'closed'
      ? currentContext
      : new window.AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') {
      void context.resume().catch((error: unknown) => {
        console.warn('[guest-concierge] Could not unlock audio playback:', error instanceof Error ? error.name : 'unknown error')
      })
    }
  }

  async function playSpeechAudio(blobs: Blob[], controller: AbortController) {
    const context = audioContextRef.current
    if (context && context.state !== 'closed') {
      if (context.state === 'suspended') await context.resume()
      if (controller.signal.aborted) throw new Error('Audio playback stopped.')
      const buffers = await Promise.all(blobs.map(async (blob) =>
        context.decodeAudioData(await blob.arrayBuffer())))
      if (controller.signal.aborted) throw new Error('Audio playback stopped.')
      const channelCount = Math.max(...buffers.map((buffer) => buffer.numberOfChannels))
      const totalLength = buffers.reduce((length, buffer) => length + buffer.length, 0)
      const combinedBuffer = context.createBuffer(channelCount, totalLength, context.sampleRate)
      let offset = 0
      for (const buffer of buffers) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1)
          combinedBuffer.getChannelData(channel).set(buffer.getChannelData(sourceChannel), offset)
        }
        offset += buffer.length
      }
      const source = context.createBufferSource()
      source.buffer = combinedBuffer
      source.connect(context.destination)
      audioSourceRef.current = source
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          if (audioSourceRef.current === source) audioSourceRef.current = null
          source.onended = null
          source.stop()
          source.disconnect()
          reject(new Error('Audio playback stopped.'))
        }
        source.onended = () => {
          controller.signal.removeEventListener('abort', onAbort)
          if (audioSourceRef.current === source) audioSourceRef.current = null
          source.disconnect()
          resolve()
        }
        controller.signal.addEventListener('abort', onAbort, { once: true })
        source.start()
      })
      return
    }

    for (const blob of blobs) {
      if (controller.signal.aborted) throw new Error('Audio playback stopped.')
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            controller.signal.removeEventListener('abort', onAbort)
            audio.onended = null
            audio.onerror = null
          }
          const onAbort = () => {
            cleanup()
            audio.pause()
            reject(new Error('Audio playback stopped.'))
          }
          audio.onended = () => {
            cleanup()
            resolve()
          }
          audio.onerror = () => {
            cleanup()
            reject(new Error('Audio playback failed.'))
          }
          controller.signal.addEventListener('abort', onAbort, { once: true })
          void audio.play().catch((error: unknown) => {
            cleanup()
            reject(error)
          })
        })
      } finally {
        audio.pause()
        URL.revokeObjectURL(url)
        if (audioUrlRef.current === url) audioUrlRef.current = null
        if (audioRef.current === audio) audioRef.current = null
      }
    }
  }

  async function transcribeAudio(blob: Blob) {
    if (!blob.size) {
      setVoiceError('I did not hear a question. Please try again or type your question.')
      return
    }
    setTranscribing(true)
    setVoiceError(null)
    try {
      const extension = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('file', blob, `petal-question.${extension}`)
      const response = await fetch('/api/guest-assistant/transcribe', { method: 'POST', body: form })
      const result: unknown = await response.json()
      if (!response.ok || !isRecord(result) || typeof result.text !== 'string') {
        setVoiceError(isRecord(result) && typeof result.error === 'string'
          ? result.error
          : 'I could not understand that recording. Please try again or type your question.')
        return
      }
      void sendMessage(result.text.slice(0, 1_000), undefined, true)
    } catch {
      setVoiceError('Voice transcription could not connect. Please try again or type your question.')
    } finally {
      setTranscribing(false)
    }
  }

  function resetRecordingPress() {
    recordingPointerRef.current = null
    touchPointerIdRef.current = null
    recordingPointerStartXRef.current = null
    recordingPressActiveRef.current = false
    cancelRecordingRef.current = false
    setCancelRecording(false)
  }

  function stopRecording(discard = false) {
    discardRecordingRef.current = discard
    resetRecordingPress()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop())
    microphoneStreamRef.current = null
    setRecording(false)
  }

  async function startRecording(pointer: RecordingPointer) {
    setVoiceError(null)
    if (!window.isSecureContext) {
      setVoiceError('Microphone access requires a secure HTTPS page. Open Petal using the site’s HTTPS address and try again.')
      resetRecordingPress()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice recording is not supported in this browser. Please type your question instead.')
      resetRecordingPress()
      return
    }
    unlockAudioPlayback()
    let stream: MediaStream | null = null
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream = currentStream
      if (!recordingPressActiveRef.current || recordingPointerRef.current !== pointer) {
        currentStream.getTracks().forEach((track) => track.stop())
        return
      }
      const supportedType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = supportedType ? new MediaRecorder(currentStream, { mimeType: supportedType }) : new MediaRecorder(currentStream)
      const chunks: BlobPart[] = []
      microphoneStreamRef.current = currentStream
      recorderRef.current = recorder
      discardRecordingRef.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        currentStream.getTracks().forEach((track) => track.stop())
        microphoneStreamRef.current = null
        recorderRef.current = null
        discardRecordingRef.current = true
        resetRecordingPress()
        setRecording(false)
        setVoiceError('The recording could not be read. Please try again or type your question.')
      }
      recorder.onstop = () => {
        currentStream.getTracks().forEach((track) => track.stop())
        microphoneStreamRef.current = null
        recorderRef.current = null
        const discard = discardRecordingRef.current
        resetRecordingPress()
        setRecording(false)
        if (!discard) {
          void transcribeAudio(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        }
      }
      recorder.start()
      setRecording(true)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      microphoneStreamRef.current = null
      recorderRef.current = null
      resetRecordingPress()
      const errorName = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
        ? error.name
        : ''
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setVoiceError('Your browser blocked microphone access. If you denied it earlier, it may not show another prompt. In this site’s browser settings, set Microphone to Allow, then reload. If the site opened inside another app, open it in Safari or Chrome.')
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setVoiceError('No microphone was found. Check that your phone has a working microphone, then try again.')
      } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        setVoiceError('The microphone is unavailable or being used by another app. Close other apps using it and try again.')
      } else if (errorName === 'SecurityError') {
        setVoiceError('Microphone access requires a secure HTTPS page. Open Petal using the site’s HTTPS address and try again.')
      } else {
        setVoiceError('The microphone is unavailable. Check your browser’s site permissions and try again, or type your question.')
      }
    }
  }

  function beginRecording(pointer: RecordingPointer, startX?: number) {
    if (pending || transcribing || recordingPointerRef.current !== null) return false
    recordingPointerRef.current = pointer
    recordingPointerStartXRef.current = startX ?? null
    recordingPressActiveRef.current = true
    cancelRecordingRef.current = false
    setCancelRecording(false)
    void startRecording(pointer)
    return true
  }

  function finishRecording(pointer: RecordingPointer, discard = false) {
    if (recordingPointerRef.current !== pointer) return
    stopRecording(discard || cancelRecordingRef.current)
  }

  function handleVoicePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return
    event.preventDefault()
    if (event.pointerType === 'touch') {
      if (recordingPointerRef.current === 'touch') {
        stopRecording()
      } else if (beginRecording('touch')) {
        touchPointerIdRef.current = event.pointerId
      }
      return
    }
    beginRecording(event.pointerId, event.clientX)
    if (recordingPointerRef.current === event.pointerId) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function handleVoicePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (recordingPointerRef.current !== event.pointerId || recordingPointerStartXRef.current === null) return
    const shouldCancel = event.clientX - recordingPointerStartXRef.current >= CANCEL_RECORDING_DRAG_DISTANCE
    if (shouldCancel !== cancelRecordingRef.current) {
      cancelRecordingRef.current = shouldCancel
      setCancelRecording(shouldCancel)
    }
  }

  function handleVoicePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (recordingPointerRef.current === 'touch') return
    finishRecording(event.pointerId)
  }

  function handleVoicePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (recordingPointerRef.current === 'touch') {
      if (touchPointerIdRef.current === event.pointerId) stopRecording(true)
      return
    }
    finishRecording(event.pointerId, true)
  }

  function handleVoiceLostPointerCapture(event: ReactPointerEvent<HTMLButtonElement>) {
    finishRecording(event.pointerId, true)
  }

  function handleVoiceKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat) return
    event.preventDefault()
    keyboardActivationRef.current = true
    beginRecording('keyboard')
  }

  function handleVoiceKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      finishRecording('keyboard')
      window.setTimeout(() => {
        keyboardActivationRef.current = false
      }, 0)
    }
  }

  function handleVoiceClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0) return
    if (keyboardActivationRef.current) {
      keyboardActivationRef.current = false
      return
    }
    if (recordingPointerRef.current === 'keyboard') {
      finishRecording('keyboard')
    } else {
      beginRecording('keyboard')
    }
  }

  function handleVoiceBlur() {
    if (recordingPointerRef.current === 'keyboard') finishRecording('keyboard', true)
  }

  function stopSpeaking() {
    speechAbortRef.current?.abort()
    speechAbortRef.current = null
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    setSpeakingIndex(null)
  }

  async function speakReply(index: number, value: string) {
    if (speakingIndex === index) {
      stopSpeaking()
      return
    }
    stopSpeaking()
    const controller = new AbortController()
    speechAbortRef.current = controller
    setSpeakingIndex(index)
    setVoiceError(null)
    unlockAudioPlayback()
    try {
      const audioBlobs: Blob[] = []
      for (const text of speechChunks(value)) {
        const response = await fetch('/api/guest-assistant/speech', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const result: unknown = await response.json()
          throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : 'Petal could not speak this reply.')
        }
        audioBlobs.push(await response.blob())
      }
      await playSpeechAudio(audioBlobs, controller)
    } catch (error) {
      if (!controller.signal.aborted) {
        setVoiceError(error instanceof Error ? error.message : 'Petal could not speak this reply.')
      }
    } finally {
      if (speechAbortRef.current === controller) {
        speechAbortRef.current = null
        setSpeakingIndex(null)
      }
    }
  }

  function closeConcierge() {
    stopRecording(true)
    stopSpeaking()
    setOpen(false)
  }

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, pending, open])

  useEffect(() => () => {
    discardRecordingRef.current = true
    const recorder = recorderRef.current
    if (recorder) {
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop())
    speechAbortRef.current?.abort()
    audioRef.current?.pause()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close().catch((error: unknown) => {
        console.warn('[guest-concierge] Could not close audio playback:', error instanceof Error ? error.name : 'unknown error')
      })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeConcierge()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  async function sendMessage(value: string, requestedAction?: TourAction, speakResponse = false) {
    const content = value.trim()
    if (!content || pending || content.length > 1_000) return
    const normalized = content.toLowerCase()
    const action = requestedAction ?? (awaitingTourGuest
      ? /^(?:yes|yeah|yep|i am|i'm|we are|we're)\b/.test(normalized) ? 'tour-guest-yes'
        : /^(?:no|nope|not currently|i am not|i'm not|we are not|we're not)\b/.test(normalized) ? 'tour-guest-no'
          : undefined
      : undefined)
    if (awaitingTourGuest) setAwaitingTourGuest(false)
    const nextMessages = [...messages]
    if (action) {
      for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
        if (nextMessages[index].askIfHotelGuest) {
          nextMessages[index] = { ...nextMessages[index], askIfHotelGuest: false }
          break
        }
      }
    }
    nextMessages.push({ role: 'user', content })
    setMessages(nextMessages)
    setInput('')
    setShowSuggestions(false)
    setPending(true)
    try {
      const response = await fetch('/api/guest-assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.filter((message) => !message.private).slice(-8),
          ...(action ? { action } : {}),
        }),
      })
      const result: unknown = await response.json()
      if (!response.ok || !result || typeof result !== 'object' || !('reply' in result) || typeof result.reply !== 'string') {
        const error = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'I’m sorry, I couldn’t respond just now. Please try again in a moment.'
        setMessages((current) => [...current, { role: 'assistant', content: error }])
        return
      }
      const reply = result.reply
      const isPrivate = 'private' in result && result.private === true
      const tourOptions = parseTours('tourOptions' in result ? result.tourOptions : undefined)
      const tourPrices = parseTours('tourPrices' in result ? result.tourPrices : undefined)
      const gymPackages = parseGymPackages('gymPackages' in result ? result.gymPackages : undefined)
      const askIfHotelGuest = 'askIfHotelGuest' in result && result.askIfHotelGuest === true && Boolean(tourOptions?.length)
      const offerRoomBooking = 'offerRoomBooking' in result && result.offerRoomBooking === true
      const offerGymBooking = 'offerGymBooking' in result && result.offerGymBooking === true
      const offerEventInquiry = 'offerEventInquiry' in result && result.offerEventInquiry === true
      const loyaltyGuide = parseLoyaltyGuide('loyaltyGuide' in result ? result.loyaltyGuide : undefined)
      const assistantMessage: Message = {
        role: 'assistant',
        content: reply,
        private: isPrivate,
        ...(tourOptions ? { tourOptions } : {}),
        ...(tourPrices ? { tourPrices } : {}),
        ...(gymPackages ? { gymPackages } : {}),
        ...(askIfHotelGuest ? { askIfHotelGuest } : {}),
        ...(offerRoomBooking ? { offerRoomBooking } : {}),
        ...(offerGymBooking ? { offerGymBooking } : {}),
        ...(offerEventInquiry ? { offerEventInquiry } : {}),
        ...(loyaltyGuide ? { loyaltyGuide } : {}),
      }
      const assistantMessageIndex = nextMessages.length
      setAwaitingTourGuest(askIfHotelGuest)
      setMessages((current) => {
        const history = isPrivate
          ? current.map((message, index) => index === current.length - 1 && message.role === 'user'
            ? { ...message, private: true }
            : message)
          : current
        return [...history, assistantMessage]
      })
      if (speakResponse && voiceOutputEnabled && !isPrivate) {
        void speakReply(assistantMessageIndex, speechTextForMessage(assistantMessage))
      }
    } catch {
      setMessages((current) => [...current, { role: 'assistant', content: 'I’m sorry, I couldn’t connect just now. Please try again in a moment.' }])
    } finally {
      setPending(false)
      if (!speakResponse) inputRef.current?.focus()
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage(input)
  }

  const touchRecording = recordingPointerRef.current === 'touch'

  return (
    <div className="guest-concierge">
      {open && (
        <section className="concierge-panel" role="dialog" aria-modal="false" aria-labelledby="concierge-title">
          <header className="concierge-header">
            <ConciergeAvatar />
            <div className="concierge-heading">
              <strong id="concierge-title">Petal</strong>
              <span>Your hotel concierge</span>
            </div>
            <span className="concierge-status" aria-label="Here to help" />
            <button className="concierge-close" type="button" onClick={closeConcierge} aria-label="Close concierge">×</button>
          </header>
          <div className="concierge-messages" aria-live="polite" aria-relevant="additions text">
            <div className="concierge-message assistant">
              {responseStyle === 'trinidadian'
                ? <>Hi, welcome! I’m Petal. Real glad you’re here. Ah can help with your stay, hotel services or loyalty points. Tap <strong>Suggested questions</strong> and leh we get started.</>
                : <>Hello, welcome! I’m Petal, your hotel concierge. Ask me about your stay, services or loyalty points. Tap <strong>Suggested questions</strong> to get started.</>}
            </div>
            {messages.map((message, index) => (
              <div className={`concierge-message ${message.role}`} key={`${index}-${message.role}`}>
                {message.role === 'assistant'
                  ? <div className="concierge-markdown"><ReactMarkdown>{message.content}</ReactMarkdown></div>
                  : message.content}
                {message.role === 'assistant' && voiceOutputEnabled && !message.private && (
                  <button
                    className="concierge-listen-button"
                    type="button"
                    aria-label={speakingIndex === index ? 'Stop Petal speaking' : 'Listen to Petal’s reply'}
                    onClick={() => void speakReply(index, speechTextForMessage(message))}
                  >
                    {speakingIndex === index ? 'Stop speaking' : 'Listen'}
                  </button>
                )}
                {message.tourOptions && <TourList tours={message.tourOptions} />}
                {message.tourPrices && <TourPriceList tours={message.tourPrices} />}
                {message.gymPackages && <GymPlanList packages={message.gymPackages} />}
                {message.askIfHotelGuest && (
                  <div className="concierge-choice-actions">
                    <button type="button" disabled={pending} onClick={() => void sendMessage('Yes, I am currently staying at the hotel.', 'tour-guest-yes')}>Yes</button>
                    <button type="button" disabled={pending} onClick={() => void sendMessage('No, I am not currently staying at the hotel.', 'tour-guest-no')}>No</button>
                  </div>
                )}
                {message.offerRoomBooking && (
                  <div className="concierge-choice-actions">
                    <Link className="concierge-room-link" href="/book/rooms">Book a room</Link>
                    <button type="button" onClick={() => inputRef.current?.focus()}>Ask something else</button>
                  </div>
                )}
                {message.offerGymBooking && (
                  <div className="concierge-choice-actions">
                    <Link className="concierge-room-link" href="/book/gym">View gym plans</Link>
                  </div>
                )}
                {message.offerEventInquiry && (
                  <div className="concierge-choice-actions">
                    <Link className="concierge-room-link" href="/events">Start an event inquiry</Link>
                  </div>
                )}
                {message.loyaltyGuide && <LoyaltyRules guide={message.loyaltyGuide} />}
              </div>
            ))}
            {pending && <div className="concierge-typing" role="status">Petal is typing…</div>}
            <div ref={transcriptEnd} />
          </div>
          <div className="concierge-tools">
            <button
              className="concierge-suggestions-toggle"
              type="button"
              aria-expanded={showSuggestions}
              onClick={() => setShowSuggestions((visible) => !visible)}
            >
              {showSuggestions ? 'Hide questions' : 'Suggested questions'}
              <span aria-hidden="true">{showSuggestions ? '−' : '+'}</span>
            </button>
            {showSuggestions && (
              <div className="concierge-suggestions">
                {suggestions.map((question) => (
                  <button key={question} type="button" disabled={pending || transcribing || recording} onClick={() => void sendMessage(question)}>
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form className={`concierge-form${recording ? ' is-recording' : ''}${cancelRecording ? ' is-cancel-armed' : ''}`} onSubmit={handleSubmit}>
            <label className="concierge-sr-only" htmlFor="concierge-input">Ask Petal a question</label>
            {recording
              ? (
                <div className="concierge-recording-prompt" aria-hidden="true">
                  <span className="concierge-recording-indicator" />
                  <span>{cancelRecording ? 'Release to discard' : touchRecording ? 'Tap mic to send' : 'Release to send'}</span>
                </div>
              )
              : (
                <input
                  ref={inputRef}
                  id="concierge-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  maxLength={1_000}
                  placeholder={transcribing ? 'Transcribing your question…' : 'Ask about your stay…'}
                  autoComplete="off"
                  disabled={pending || transcribing}
                />
              )}
            {voiceInputEnabled && (
              <button
                className={`concierge-mic-button${recording ? ' is-recording' : ''}`}
                type="button"
                aria-label={recording
                  ? touchRecording ? 'Tap to send recording' : 'Release to send, or swipe right to cancel'
                  : 'Start voice recording'}
                title={recording
                  ? touchRecording ? 'Tap again to send this recording' : 'Release to send, or swipe right to cancel'
                  : 'On phones, tap to start and tap again to send. On desktop, press and hold.'}
                disabled={pending || transcribing}
                onPointerDown={handleVoicePointerDown}
                onPointerMove={handleVoicePointerMove}
                onPointerUp={handleVoicePointerUp}
                onPointerCancel={handleVoicePointerCancel}
                onLostPointerCapture={handleVoiceLostPointerCapture}
                onKeyDown={handleVoiceKeyDown}
                onKeyUp={handleVoiceKeyUp}
                onBlur={handleVoiceBlur}
                onClick={handleVoiceClick}
                onContextMenu={(event) => event.preventDefault()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" /></svg>
              </button>
            )}
            {recording && (
              touchRecording ? (
                <button
                  className="concierge-recording-cancel"
                  type="button"
                  aria-label="Discard recording"
                  title="Discard recording"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => stopRecording(true)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>
                </button>
              ) : (
                <span className={`concierge-recording-cancel${cancelRecording ? ' is-armed' : ''}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>
                </span>
              )
            )}
            {!recording && (
              <button type="submit" aria-label="Send message" disabled={pending || transcribing || !input.trim()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" /></svg>
              </button>
            )}
          </form>
          {(recording || transcribing) && (
            <p className="concierge-voice-status" role="status">
              {recording
                ? cancelRecording
                  ? 'Release to cancel the recording.'
                  : touchRecording ? 'Recording… tap the microphone to send, or tap the discard button to cancel.'
                    : 'Recording… release to send, or swipe right to cancel.'
                : 'Transcribing your question…'}
            </p>
          )}
          {voiceError && <p className="concierge-voice-error" role="alert">{voiceError}</p>}
          {voiceInputEnabled && <p className="concierge-voice-help">On phones, tap the microphone to start and tap again to send. On desktop, press and hold.</p>}
          <p className="concierge-disclaimer">For bookings or changes, please use your account or contact the hotel team.</p>
        </section>
      )}
      {!open && introVisible && (
        <div className="concierge-intro">
          <button type="button" className="concierge-intro-close" onClick={() => setIntroVisible(false)} aria-label="Dismiss greeting">×</button>
          <strong>Hello, I’m Petal!</strong>
          <span>Open chat and tap “Suggested questions” to get started.</span>
        </div>
      )}
      <button
        type="button"
        className="concierge-launcher"
        aria-label={open ? 'Close hotel concierge' : 'Chat with Petal, your hotel concierge'}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closeConcierge()
            return
          }
          setOpen(true)
          setIntroVisible(false)
          window.setTimeout(() => inputRef.current?.focus(), 80)
        }}
      >
        {open ? <span className="concierge-launcher-close" aria-hidden="true">×</span> : <ConciergeAvatar small />}
      </button>
    </div>
  )
}
