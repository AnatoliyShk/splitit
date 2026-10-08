// Props and UI state types for components/Switch.tsx

export type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The accessible name, e.g. "Use these filters"; the switch has no visible text of its own. */
  label: string
  disabled?: boolean
  className?: string
}
