import { useId } from 'react'
import { Link } from 'react-router'
import { classNames } from '../classNames'
import type { PromoCardProps } from '../types/ui/promoCard'

/** A Home block: icon badge, title, text and an action button that always sits at the card's bottom (styles: `.promo*` in App.css). */
export function PromoCard({ icon, title, children, to, actionLabel, primary = false }: PromoCardProps) {
  const titleId = useId()
  return (
    <section className="promo" aria-labelledby={titleId}>
      <span className="promo-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24">{icon}</svg>
      </span>
      <h2 id={titleId}>{title}</h2>
      <p>{children}</p>
      <Link className={classNames('btn', primary && 'btn-primary', 'promo-action')} to={to}>
        {actionLabel}
      </Link>
    </section>
  )
}
