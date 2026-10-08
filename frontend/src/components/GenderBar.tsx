import type { GenderBarProps } from '../types/ui/genderBar'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * Who's going by gender (styles: `.gender-bar*` in App.css): a line split into blue (men), gray (didn't say)
 * and pink (women) in proportion, with a blue male icon on its left and a pink female icon on its right.
 * Hovering or focusing an icon, or the line, shows the exact number; screen readers read the same text.
 */
export function GenderBar({ counts }: GenderBarProps) {
  const manText = plural(counts.man, 'man', 'men')
  const womanText = plural(counts.woman, 'woman', 'women')
  const undisclosedText = `${counts.undisclosed} did not say`
  return (
    <div className="gender-bar" role="group" aria-label="Who is going, by gender">
      <span className="gender-stat gender-man" tabIndex={0} role="img" aria-label={manText}>
        <svg className="gender-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 3h5v5M21 3l-6.75 6.75" />
          <circle cx="10" cy="14" r="6" />
        </svg>
        <span className="gender-tooltip" aria-hidden="true">
          {manText}
        </span>
      </span>
      <span className="gender-stat gender-line" tabIndex={0} role="img" aria-label={undisclosedText}>
        <span className="gender-track" aria-hidden="true">
          <span className="gender-segment gender-segment-man" style={{ flexGrow: counts.man }} />
          <span className="gender-segment gender-segment-undisclosed" style={{ flexGrow: counts.undisclosed }} />
          <span className="gender-segment gender-segment-woman" style={{ flexGrow: counts.woman }} />
        </span>
        <span className="gender-tooltip" aria-hidden="true">
          {undisclosedText}
        </span>
      </span>
      <span className="gender-stat gender-woman" tabIndex={0} role="img" aria-label={womanText}>
        <svg className="gender-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15v7M9 19h6" />
          <circle cx="12" cy="9" r="6" />
        </svg>
        <span className="gender-tooltip" aria-hidden="true">
          {womanText}
        </span>
      </span>
    </div>
  )
}
