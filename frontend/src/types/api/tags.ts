// Shapes of the tag API responses; each mirrors a backend serializer

/** A tag with its id (TagSerializer, and the panel's OccasionTagSerializer). */
export type Tag = { id: number; name: string }

/** Public occasion lists send tags by name only. */
export type TagName = Tag['name']
