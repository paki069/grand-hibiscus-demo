export default function DiningRoomDecor() {
  return (
    <svg className="dining-room-decor" viewBox="0 0 740 660" preserveAspectRatio="none" aria-hidden="true">
      <path className="room-wall" d="M8 650V8H732V650H430M310 650H8" />
      <rect className="room-fixture" x="22" y="18" width="174" height="70" rx="6" />
      <text className="room-label" x="109" y="60" textAnchor="middle">Kitchen</text>
      <rect className="bar-fixture" x="270" y="22" width="200" height="34" rx="5" />
      <text className="room-label" x="370" y="44" textAnchor="middle">Bar</text>
      {Array.from({ length: 8 }, (_, i) => <circle key={i} className="bar-stool" cx={280 + i * 25} cy="70" r="8" />)}
      <text className="room-note" x="370" y="97" textAnchor="middle">8 stools</text>
      <rect className="room-fixture" x="600" y="18" width="116" height="70" rx="6" />
      <text className="room-label" x="658" y="60" textAnchor="middle">Restrooms</text>
      <path className="privacy-screen" d="M108 120V590M632 120V590" />
      <rect className="service-fixture" x="535" y="515" width="66" height="38" rx="5" />
      <text className="room-label small-room-label" x="568" y="539" textAnchor="middle">Service</text>
      <rect className="service-fixture" x="420" y="612" width="54" height="28" rx="5" />
      <text className="room-label small-room-label" x="447" y="631" textAnchor="middle">Host</text>
      <path className="entrance-arrow" d="M370 634V604m0 0-5 8m5-8 5 8" />
      <text className="room-note" x="370" y="654" textAnchor="middle">Entrance</text>
    </svg>
  )
}
