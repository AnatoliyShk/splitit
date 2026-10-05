// Shapes of the tag API responses; each mirrors a backend serializer

/** A tag as the panel reads and writes it (OccasionTagSerializer). */
export type Tag = { id: number; name: string }

/** Public occasion lists send tags by name only. */
export type TagName = Tag['name']
