/** Joins the given class names, skipping empty ones. */
export const classNames = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')
