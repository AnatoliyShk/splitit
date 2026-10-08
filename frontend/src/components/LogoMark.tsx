/**
 * Splitit's mark (styles: `.logo-*` in App.css): a clock face split into two halves, one per person, pulled
 * slightly apart, with a heart bridging the split. Time and a feeling, shared between two people.
 */
export function LogoMark() {
  return (
    <svg className="logo-svg" viewBox="0 0 32 32" aria-hidden="true">
      {/* The two halves of the clock: yours and theirs */}
      <path className="logo-half logo-half-first" d="M14 5.5a10.5 10.5 0 0 0 0 21z" />
      <path className="logo-half logo-half-second" d="M18 5.5a10.5 10.5 0 0 1 0 21z" />
      {/* The 9 and 3 o'clock ticks, so the circle reads as a clock */}
      <path className="logo-tick" d="M6.2 16h2.4M23.4 16h2.4" />
      {/* The shared feeling, across the split */}
      <path
        className="logo-heart"
        d="M16 22.5c-5.6-3.4-6.4-7.2-3.6-8.6 1.7-.8 3 .2 3.6 1.3.6-1.1 1.9-2.1 3.6-1.3 2.8 1.4 2 5.2-3.6 8.6z"
      />
    </svg>
  )
}
