import type { PublicUser } from './users'

// Shapes of the connection API responses; each mirrors a backend serializer

/** GET /api/users/<uuid>/connections/: someone the user shared occasions with. */
export type Connection = PublicUser & {
  strength: number
  shared_occasions: number
}

/** A person in the network graph: degree 0 is the user, 1 their connections, 2 people only those know. */
export type NetworkNode = PublicUser & { degree: 0 | 1 | 2 }

/** A connection between two people in the graph, by their uuids. */
export type NetworkEdge = { source: string; target: string; strength: number }

/** GET /api/users/<uuid>/connections/graph/. */
export type Network = { nodes: NetworkNode[]; edges: NetworkEdge[] }
