'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { fmtDate, money } from '@/lib/format'
import { Pill } from '@/components/ui'
import LoyaltyWallet from '@/components/LoyaltyWallet'
import BackfillLoyaltyPointsButton from '@/components/BackfillLoyaltyPointsButton'
import { claimMyBirthdayReward } from '@/app/(guest)/account/actions'
import styles from './account-dashboard.module.css'

export interface LoyaltyGuide {
  room_night_points: number
  room_addon_points: number
  spa_spend_block_amount: number
  spa_spend_block_points: number
  gym_points_per_guest_day: number
  tour_booking_points: number
  gym_package_rewards: { package: string; points: number }[]
}

interface RoomTypeReward {
  id: string
  name: string
  loyalty_free_night_points: number
}

interface LedgerEntry {
  id: string
  points: number
  description: string
  created_at: string
}

interface Coupon {
  id: string
  code: string
  room_type_id: string
  points_cost: number
  status: string
  created_at: string
}

interface Reservation {
  id: string
  reference: string
  status: string
  isActive: boolean
  total: number | string | null
  currency: string
  created_at: string
  entitlements: { service_type: string }[] | null
}

interface BirthdayRewardStatus {
  birthday: string | null
  birthday_today: boolean
  already_claimed: boolean
  can_claim: boolean
}

type AccountTab = 'overview' | 'rewards' | 'redeem' | 'activity' | 'reservations' | 'birthday'

const tabs: { id: AccountTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'redeem', label: 'Redeem' },
  { id: 'activity', label: 'Activity' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'birthday', label: 'Birthday' },
]

export default function AccountDashboard({
  firstName,
  email,
  birthday,
  birthdayStatus,
  canClaimBirthdayReward,
  balance,
  ledger,
  coupons,
  roomTypes,
  reservations,
  timezone,
  loyaltyGuide,
  canBackfill,
}: {
  firstName: string
  email: string | null
  birthday: string | null
  birthdayStatus: BirthdayRewardStatus
  canClaimBirthdayReward: boolean
  balance: number
  ledger: LedgerEntry[]
  coupons: Coupon[]
  roomTypes: RoomTypeReward[]
  reservations: Reservation[]
  timezone: string
  loyaltyGuide: LoyaltyGuide
  canBackfill: boolean
}) {
  const [activeTab, setActiveTab] = useState<AccountTab>('overview')
  const [reservationView, setReservationView] = useState<'active' | 'past'>('active')
  const [birthdayMessage, setBirthdayMessage] = useState('')
  const [claimingBirthday, startBirthdayClaim] = useTransition()
  const nextReward = roomTypes.reduce<RoomTypeReward | null>((current, room) => (
    !current || room.loyalty_free_night_points < current.loyalty_free_night_points
      ? room
      : current
  ), null)
  const availableCoupons = coupons.filter((coupon) => coupon.status === 'available').length
  const activeReservations = reservations.filter((reservation) => reservation.isActive)
  const pastReservations = reservations.filter((reservation) => !reservation.isActive)
  const visibleReservations = reservationView === 'active' ? activeReservations : pastReservations
  const progress = nextReward
    ? Math.max(0, Math.min(100, (balance / nextReward.loyalty_free_night_points) * 100))
    : 0
  const pointsNeeded = nextReward ? Math.max(0, nextReward.loyalty_free_night_points - balance) : 0
  const showReservationView = (view: 'active' | 'past') => {
    setReservationView(view)
    setActiveTab('reservations')
  }
  const handleBirthdayClaim = () => {
    setBirthdayMessage('')
    startBirthdayClaim(async () => {
      const result = await claimMyBirthdayReward()
      setBirthdayMessage(result.message)
    })
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab)
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length]
    setActiveTab(nextTab.id)
    document.getElementById(`account-tab-${nextTab.id}`)?.focus()
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>THE GRAND HIBISCUS · REWARDS</p>
          <h1>{firstName ? `Welcome back, ${firstName}.` : 'Your rewards, in one place.'}</h1>
          <p className={styles.memberEmail}>{email ?? 'Your guest account'}</p>
        </div>
        <div className={styles.memberMark} aria-hidden="true">
          {(firstName || email || 'H').slice(0, 1).toUpperCase()}
        </div>
      </header>

      <nav className={styles.tabs} role="tablist" aria-label="Account sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`account-tab-${tab.id}`}
            className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="account-panel"
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={handleTabKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section
        id="account-panel"
        className={styles.panel}
        role="tabpanel"
        aria-labelledby={`account-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'overview' && (
          <div className={styles.overview}>
            <section className={styles.rewardHero} aria-labelledby="points-balance-title">
              <div className={styles.heroCopy}>
                <p className={styles.heroEyebrow}>A LITTLE MORE TO LOOK FORWARD TO</p>
                <h2 id="points-balance-title">Make every visit count.</h2>
                <p>Earn points on confirmed stays and eligible experiences, then turn them into a free night.</p>
                <button className={styles.heroLink} type="button" onClick={() => setActiveTab('rewards')}>
                  Explore your rewards <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className={styles.balanceCard}>
                <span className={styles.balanceLabel}>YOUR POINTS BALANCE</span>
                <div className={styles.balanceNumber}>
                  <strong>{balance.toLocaleString()}</strong>
                  <span>points</span>
                </div>
                <span className={styles.balanceNote}>Ready when you are.</span>
              </div>
              <span className={styles.heroOrnament} aria-hidden="true">✳</span>
            </section>

            <div className={styles.statGrid}>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Active bookings</span>
                <strong>{activeReservations.length}</strong>
                <span>Upcoming or in progress</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Past bookings</span>
                <strong>{pastReservations.length}</strong>
                <span>Completed or cancelled</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Free-night coupons</span>
                <strong>{availableCoupons}</strong>
                <span>Available to use</span>
              </article>
            </div>

            <div className={styles.overviewGrid}>
              <section className={styles.progressCard} aria-labelledby="next-reward-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>YOUR NEXT REWARD</p>
                    <h2 id="next-reward-title">
                      {nextReward ? `${nextReward.name} free night` : 'Free-night rewards'}
                    </h2>
                  </div>
                  <span className={styles.rewardMark} aria-hidden="true">✳</span>
                </div>
                {nextReward ? (
                  <>
                    <p className={styles.progressMessage}>
                      {pointsNeeded > 0
                        ? `You’re ${pointsNeeded.toLocaleString()} points away from a free night.`
                        : 'You have enough points to redeem this free-night reward.'}
                    </p>
                    <div
                      className={styles.progressTrack}
                      role="progressbar"
                      aria-label={`Progress toward a ${nextReward.name} free night`}
                      aria-valuemin={0}
                      aria-valuemax={nextReward.loyalty_free_night_points}
                      aria-valuenow={Math.max(0, Math.min(balance, nextReward.loyalty_free_night_points))}
                    >
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className={styles.progressMeta}>
                      <strong>{balance.toLocaleString()} points</strong>
                      <span>{nextReward.loyalty_free_night_points.toLocaleString()} points</span>
                    </div>
                    <button className={styles.textButton} type="button" onClick={() => setActiveTab('rewards')}>
                      {pointsNeeded > 0 ? 'See how to earn more' : 'Redeem your points'} <span aria-hidden="true">→</span>
                    </button>
                  </>
                ) : (
                  <p className={styles.progressMessage}>Free-night rewards are not available right now. Check back soon.</p>
                )}
              </section>

              <section className={styles.recentActivity} aria-labelledby="recent-activity-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>YOUR REWARDS JOURNEY</p>
                    <h2 id="recent-activity-title">Recent activity</h2>
                  </div>
                  <button className={styles.textButton} type="button" onClick={() => setActiveTab('activity')}>
                    View activity <span aria-hidden="true">→</span>
                  </button>
                </div>
                {ledger.length > 0 ? (
                  <ul className={styles.activityList}>
                    {ledger.slice(0, 4).map((entry) => (
                      <li className={styles.activityItem} key={entry.id}>
                        <span className={styles.activityIcon} aria-hidden="true">{entry.points > 0 ? '+' : '−'}</span>
                        <span className={styles.activityCopy}>
                          <strong>{entry.description}</strong>
                          <small>{fmtDate(entry.created_at, timezone)}</small>
                        </span>
                        <strong className={entry.points > 0 ? styles.positivePoints : styles.negativePoints}>
                          {entry.points > 0 ? '+' : ''}{entry.points.toLocaleString()}
                        </strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyCopy}>Your points activity will appear here when you start earning.</p>
                )}
              </section>
            </div>

            <div className={styles.bookingSections}>
              <section className={styles.bookingPreview} aria-labelledby="active-bookings-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>UPCOMING & IN PROGRESS</p>
                    <h2 id="active-bookings-title">Active bookings</h2>
                  </div>
                  <button className={styles.textButton} type="button" onClick={() => showReservationView('active')}>
                    View active <span aria-hidden="true">→</span>
                  </button>
                </div>
                {activeReservations.length > 0 ? (
                  <div className={styles.reservationGrid}>
                    {activeReservations.slice(0, 2).map((reservation) => (
                      <ReservationCard key={reservation.id} reservation={reservation} timezone={timezone} />
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyBookings}>
                    <p>No active bookings right now.</p>
                    <Link href="/book/rooms">Explore rooms <span aria-hidden="true">→</span></Link>
                  </div>
                )}
              </section>

              <section className={styles.bookingPreview} aria-labelledby="past-bookings-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>YOUR STAY HISTORY</p>
                    <h2 id="past-bookings-title">Past bookings</h2>
                  </div>
                  <button className={styles.textButton} type="button" onClick={() => showReservationView('past')}>
                    View past <span aria-hidden="true">→</span>
                  </button>
                </div>
                {pastReservations.length > 0 ? (
                  <div className={styles.reservationGrid}>
                    {pastReservations.slice(0, 2).map((reservation) => (
                      <ReservationCard key={reservation.id} reservation={reservation} timezone={timezone} />
                    ))}
                  </div>
                ) : (
                  <p className={styles.emptyCopy}>Completed and cancelled bookings will appear here.</p>
                )}
              </section>
            </div>
          </div>
        )}

        {activeTab === 'rewards' && (
          <div className={styles.rewardsPanel}>
            <div className={styles.tabIntro}>
              <p className={styles.eyebrow}>EVERY VISIT ADDS UP</p>
              <h2>Ways to earn points</h2>
              <p>Earn points on eligible stays and experiences. Your current balance is {balance.toLocaleString()} points.</p>
            </div>
            <div className={styles.earningGrid}>
              <article className={styles.earningCard}>
                <span className={styles.earningIcon} aria-hidden="true">01</span>
                <p className={styles.eyebrow}>STAY A LITTLE LONGER</p>
                <h3>Hotel stays</h3>
                <strong>+{loyaltyGuide.room_night_points} points</strong>
                <p>For each eligible paid room night.</p>
              </article>
              <article className={styles.earningCard}>
                <span className={styles.earningIcon} aria-hidden="true">02</span>
                <p className={styles.eyebrow}>ADD SOMETHING EXTRA</p>
                <h3>Room add-ons</h3>
                <strong>+{loyaltyGuide.room_addon_points} points</strong>
                <p>For each eligible room add-on.</p>
              </article>
              <article className={styles.earningCard}>
                <span className={styles.earningIcon} aria-hidden="true">03</span>
                <p className={styles.eyebrow}>TAKE TIME TO UNWIND</p>
                <h3>Spa experiences</h3>
                <strong>+{loyaltyGuide.spa_spend_block_points} points</strong>
                <p>For each {Number(loyaltyGuide.spa_spend_block_amount).toLocaleString()} spent on eligible spa services.</p>
              </article>
              <article className={styles.earningCard}>
                <span className={styles.earningIcon} aria-hidden="true">04</span>
                <p className={styles.eyebrow}>KEEP MOVING</p>
                <h3>Gym access</h3>
                <strong>+{loyaltyGuide.gym_points_per_guest_day} points</strong>
                <p>Per guest, per eligible day.</p>
              </article>
              <article className={styles.earningCard}>
                <span className={styles.earningIcon} aria-hidden="true">05</span>
                <p className={styles.eyebrow}>FIND YOUR NEXT ADVENTURE</p>
                <h3>Eligible tours</h3>
                <strong>+{loyaltyGuide.tour_booking_points} points</strong>
                <p>For each eligible tour booking.</p>
              </article>
              {loyaltyGuide.gym_package_rewards.filter((reward) => reward.points > 0).map((reward) => (
                <article className={styles.earningCard} key={reward.package}>
                  <span className={styles.earningIcon} aria-hidden="true">✳</span>
                  <p className={styles.eyebrow}>GYM MEMBERSHIPS</p>
                  <h3>{reward.package}</h3>
                  <strong>+{reward.points} points</strong>
                  <p>When you purchase this eligible package.</p>
                </article>
              ))}
            </div>
            <p className={styles.earningNote}>Points are added after eligible bookings are confirmed. Cancelled or refunded bookings may have points reversed.</p>
            {canBackfill && (
              <div className={styles.backfillCallout}>
                <div>
                  <strong>Booked with us before?</strong>
                  <p>Check this account for eligible confirmed bookings that may be missing points. Cancelled, refunded, and already-credited bookings are handled safely.</p>
                </div>
                <BackfillLoyaltyPointsButton />
              </div>
            )}
          </div>
        )}

        {activeTab === 'redeem' && (
          <div className={styles.rewardsPanel}>
            <div className={styles.tabIntro}>
              <p className={styles.eyebrow}>A REWARD FOR YOUR NEXT STAY</p>
              <h2>Redeem your points</h2>
              <p>Exchange your points for a free-night coupon and keep track of rewards you can use.</p>
            </div>
            <LoyaltyWallet
              balance={balance}
              ledger={ledger}
              coupons={coupons}
              roomTypes={roomTypes}
              showActivity={false}
            />
          </div>
        )}

        {activeTab === 'activity' && (
          <section className={styles.detailSection} aria-labelledby="activity-title">
            <div className={styles.tabIntro}>
              <p className={styles.eyebrow}>EVERY POINT HAS A STORY</p>
              <h2 id="activity-title">Recent points activity</h2>
              <p>Your latest points transactions, including points earned, redeemed, or adjusted.</p>
            </div>
            {ledger.length > 0 ? (
              <ul className={styles.fullActivityList}>
                {ledger.map((entry) => (
                  <li className={styles.activityItem} key={entry.id}>
                    <span className={styles.activityIcon} aria-hidden="true">{entry.points > 0 ? '+' : '−'}</span>
                    <span className={styles.activityCopy}>
                      <strong>{entry.description}</strong>
                      <small>{fmtDate(entry.created_at, timezone)}</small>
                    </span>
                    <strong className={entry.points > 0 ? styles.positivePoints : styles.negativePoints}>
                      {entry.points > 0 ? '+' : ''}{entry.points.toLocaleString()}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.emptyBookings}>
                <p>No points activity yet.</p>
                <Link href="/book/rooms">Plan a stay <span aria-hidden="true">→</span></Link>
              </div>
            )}
          </section>
        )}

        {activeTab === 'reservations' && (
          <section className={styles.detailSection} aria-labelledby="reservations-title">
            <div className={styles.tabIntro}>
              <p className={styles.eyebrow}>YOUR TIME WITH US</p>
              <h2 id="reservations-title">Reservations</h2>
              <p>Upcoming and in-progress bookings are separate from your booking history.</p>
            </div>
            <div className={styles.bookingFilters} role="group" aria-label="Filter reservations">
              <button
                className={`${styles.bookingFilter} ${reservationView === 'active' ? styles.selectedBookingFilter : ''}`}
                type="button"
                aria-pressed={reservationView === 'active'}
                onClick={() => setReservationView('active')}
              >
                Active bookings <span>{activeReservations.length}</span>
              </button>
              <button
                className={`${styles.bookingFilter} ${reservationView === 'past' ? styles.selectedBookingFilter : ''}`}
                type="button"
                aria-pressed={reservationView === 'past'}
                onClick={() => setReservationView('past')}
              >
                Past bookings <span>{pastReservations.length}</span>
              </button>
            </div>
            {visibleReservations.length > 0 ? (
              <div className={styles.reservationGrid}>
                {visibleReservations.map((reservation) => (
                  <ReservationCard key={reservation.id} reservation={reservation} timezone={timezone} />
                ))}
              </div>
            ) : (
              <div className={styles.emptyBookings}>
                <p>
                  {reservationView === 'active'
                    ? 'No active bookings right now.'
                    : 'Completed and cancelled bookings will appear here.'}
                </p>
                {reservationView === 'active' && <Link href="/book/rooms">Explore rooms <span aria-hidden="true">→</span></Link>}
              </div>
            )}
          </section>
        )}

        {activeTab === 'birthday' && (
          <section className={styles.detailSection} aria-labelledby="birthday-title">
            <div className={styles.tabIntro}>
              <p className={styles.eyebrow}>A LITTLE SOMETHING FOR YOUR DAY</p>
              <h2 id="birthday-title">Birthday celebration</h2>
              <p>We’d love to celebrate with you each year.</p>
            </div>
            <div className={styles.birthdayCard}>
              <div className={styles.birthdayPoints}>
                <span className={styles.earningIcon} aria-hidden="true">✳</span>
                <span className={styles.eyebrow}>YOUR ANNUAL BIRTHDAY GIFT</span>
                <strong>100 points</strong>
              </div>
              <div className={styles.birthdayDetails}>
                <h3>{birthday ? `Birthday on file: ${formatBirthday(birthday)}` : 'No birthday on file yet'}</h3>
                <p>
                  Tell our front desk your birthday when you arrive, and we’ll add it to your profile. On your birthday, log in and claim your 100-point gift here, or ask the front desk to redeem it for you.
                </p>
                {!birthday && <p className={styles.birthdayHelp}>Ask the front desk to add your birthday to your guest profile.</p>}
                {birthdayStatus.already_claimed && (
                  <p className={styles.birthdayHelp}>You’ve already claimed this year’s birthday gift.</p>
                )}
                {canClaimBirthdayReward && birthdayStatus.can_claim && (
                  <button
                    className={styles.birthdayClaimButton}
                    type="button"
                    disabled={claimingBirthday}
                    onClick={handleBirthdayClaim}
                  >
                    {claimingBirthday ? 'Adding your gift…' : 'Claim 100 birthday points'}
                  </button>
                )}
                {canClaimBirthdayReward && birthday && !birthdayStatus.birthday_today && !birthdayStatus.already_claimed && (
                  <p className={styles.birthdayHelp}>Your birthday gift will be ready to claim on your birthday.</p>
                )}
                {birthdayMessage && <p className={styles.birthdayMessage} role="status">{birthdayMessage}</p>}
              </div>
            </div>
          </section>
        )}
      </section>
    </div>
  )
}

function formatBirthday(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
}

function ReservationCard({ reservation, timezone }: { reservation: Reservation; timezone: string }) {
  const services = [...new Set((reservation.entitlements ?? []).map((entitlement) => entitlement.service_type))]

  return (
    <article className={styles.reservationCard}>
      <div className={styles.reservationTop}>
        <span className={styles.reservationLabel}>BOOKING REFERENCE</span>
        <Pill value={reservation.status} />
      </div>
      <strong className={styles.reservationReference}>{reservation.reference}</strong>
      <p className={styles.reservationServices}>
        {services.length > 0 ? services.join(' · ') : 'Reservation details'}
      </p>
      <div className={styles.reservationBottom}>
        <span>{fmtDate(reservation.created_at, timezone)}</span>
        <strong>{money(reservation.total, reservation.currency)}</strong>
      </div>
      <Link href={`/reservations/${reservation.id}`} className={styles.reservationLink}>
        View booking <span aria-hidden="true">→</span>
      </Link>
    </article>
  )
}
