import { createNodeBorderProgram } from '@sigma/node-border'
import Graph from 'graphology'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import Sigma from 'sigma'
import type { NodeHoverDrawingFunction, NodeLabelDrawingFunction } from 'sigma/rendering'
import { apiGet } from '../api'
import { queryKeys } from '../queryClient'
import type { Network } from '../types/connections'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

// Re-render when the OS theme flips, so the canvas picks up the new token values
function useDarkMode() {
  return useSyncExternalStore(
    (onChange) => {
      darkQuery.addEventListener('change', onChange)
      return () => darkQuery.removeEventListener('change', onChange)
    },
    () => darkQuery.matches,
  )
}

// WebGL can't read CSS variables, so resolve the design tokens to plain colors
function tokens() {
  const style = getComputedStyle(document.documentElement)
  const get = (name: string) => style.getPropertyValue(name).trim()
  return {
    ink: get('--ink'),
    muted: get('--text-muted'),
    bg: get('--bg'),
    surface: get('--surface'),
    primary: get('--primary'),
    secondary: get('--secondary'),
  }
}

type Colors = ReturnType<typeof tokens>
type LabelData = Parameters<NodeHoverDrawingFunction>[1]

// Spreads consecutive nodes far apart, so the strongest connections (listed first) don't bunch up
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// Screen x of the user's node; the camera centers the graph's bounding box, which can sit off to one side
type CenterX = () => number

// Labels point away from the user: right of nodes on their right, left of those on their left
function labelPlacement(data: LabelData, centerX: CenterX) {
  const onLeft = data.x < centerX() - 1
  const gap = data.size + 5
  return onLeft ? { x: data.x - gap, align: 'right' as const } : { x: data.x + gap, align: 'left' as const }
}

// Shortens text with an ellipsis until it fits in `max` pixels
function fitText(context: CanvasRenderingContext2D, text: string, max: number) {
  if (context.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && context.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}

function labelDrawer(colors: Colors, centerX: CenterX, container: HTMLElement): NodeLabelDrawingFunction {
  return (context, data, settings) => {
    // The hovered node is named by its hover box instead
    if (!data.label || data.highlighted) return
    const { x, align } = labelPlacement(data, centerX)
    context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`
    // Long names near an edge are trimmed; hovering shows them in full
    const room = align === 'left' ? container.clientWidth - x - 6 : x - 6
    context.fillStyle = colors.ink
    context.textAlign = align
    context.fillText(fitText(context, data.label, room), x, data.y + settings.labelSize / 3)
    context.textAlign = 'left'
  }
}

// The default hover box is always white; draw it with theme colors and an ink border instead.
// It sits above the node, so it never covers the links to neighbours beside it.
function hoverDrawer(colors: Colors, container: HTMLElement): NodeHoverDrawingFunction {
  return (context, data, settings) => {
    if (!data.label) return
    const size = settings.labelSize
    context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`
    const width = context.measureText(data.label).width
    const left = Math.max(4, Math.min(data.x - width / 2 - 8, container.clientWidth - width - 20))
    const middle = data.y - data.size - size / 2 - 10
    context.beginPath()
    context.roundRect(left, middle - size / 2 - 6, width + 16, size + 12, 8)
    context.fillStyle = colors.surface
    context.fill()
    context.lineWidth = 2
    context.strokeStyle = colors.ink
    context.stroke()
    context.fillStyle = colors.ink
    context.fillText(data.label, left + 8, middle + size / 3)
  }
}

// Rings around the user: connections inside (the stronger, the closer), and each outsider beside
// the connection who links to them most strongly
function buildGraph(network: Network, colors: Colors) {
  const graph = new Graph()
  const meNode = network.nodes.find((node) => node.degree === 0)!
  const myStrengths = new Map<string, number>() // connection uuid -> strength with the user
  const outsiderAnchors = new Map<string, { friendUuid: string; strength: number }>() // outsider -> strongest friend link
  const maxStrength = Math.max(...network.edges.map((edge) => edge.strength))
  for (const edge of network.edges) {
    const otherUuid = edge.source === meNode.uuid ? edge.target : edge.target === meNode.uuid ? edge.source : null
    if (otherUuid) myStrengths.set(otherUuid, edge.strength)
  }
  const degreeByUuid = new Map(network.nodes.map((node) => [node.uuid, node.degree]))
  for (const edge of network.edges) {
    for (const [outsiderUuid, friendUuid] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ]) {
      if (degreeByUuid.get(outsiderUuid) !== 2 || degreeByUuid.get(friendUuid) !== 1) continue
      if ((outsiderAnchors.get(outsiderUuid)?.strength ?? -1) < edge.strength) {
        outsiderAnchors.set(outsiderUuid, { friendUuid, strength: edge.strength })
      }
    }
  }

  const maxMyStrength = Math.max(...myStrengths.values())
  const polarByUuid = new Map<string, { angle: number; radius: number }>()
  graph.addNode(meNode.uuid, { x: 0, y: 0, size: 16, color: colors.primary, borderColor: colors.ink })
  // Connections arrive strongest first; the golden angle spreads neighbours in that order apart
  network.nodes
    .filter((node) => node.degree === 1)
    .forEach((node, nodeIndex) => {
      const share = (myStrengths.get(node.uuid) ?? 0) / maxMyStrength
      const angle = nodeIndex * GOLDEN_ANGLE - Math.PI / 2
      const radius = 1 - 0.45 * share
      polarByUuid.set(node.uuid, { angle, radius })
      graph.addNode(node.uuid, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        size: 7 + 5 * share,
        label: node.name,
        color: colors.secondary,
        borderColor: colors.ink,
      })
    })
  // Outsiders fan out just past their friend, a small step apart
  const outsiderFans = new Map<string, string[]>() // friend uuid -> outsider uuids
  for (const [outsiderUuid, { friendUuid }] of outsiderAnchors) {
    outsiderFans.set(friendUuid, [...(outsiderFans.get(friendUuid) ?? []), outsiderUuid])
  }
  const nameByUuid = new Map(network.nodes.map((node) => [node.uuid, node.name]))
  for (const [friendUuid, outsiderUuids] of outsiderFans) {
    const { angle, radius } = polarByUuid.get(friendUuid)!
    outsiderUuids.forEach((outsiderUuid, outsiderIndex) => {
      const outsiderAngle = angle + (outsiderIndex - (outsiderUuids.length - 1) / 2) * 0.22
      const outsiderRadius = radius + 0.5
      graph.addNode(outsiderUuid, {
        x: outsiderRadius * Math.cos(outsiderAngle),
        y: outsiderRadius * Math.sin(outsiderAngle),
        size: 6,
        label: nameByUuid.get(outsiderUuid),
        color: colors.surface,
        borderColor: colors.ink,
        outsider: true,
      })
    })
  }

  for (const edge of network.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
    const withMe = edge.source === meNode.uuid || edge.target === meNode.uuid
    const share = withMe ? edge.strength / maxMyStrength : edge.strength / maxStrength
    // Your own links are ink; links between other people are the quieter muted tone
    graph.addEdge(edge.source, edge.target, {
      size: withMe ? 1 + 3 * share : 0.5 + 2 * share,
      color: withMe ? colors.ink : colors.muted,
    })
  }
  return graph
}

/**
 * The user's network: their connections around them (closer, bigger and more thickly linked
 * when stronger), the links between those people, and the people only they know on an outer
 * ring. Hovering a person highlights their links. Purely visual; the list beside it carries the
 * user's own connections for screen readers.
 */
export default function ConnectionsGraph({ userUuid }: { userUuid: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dark = useDarkMode()
  const networkQuery = useQuery({
    queryKey: queryKeys.connectionsGraph(userUuid),
    queryFn: () => apiGet<Network>(`/api/users/${userUuid}/connections/graph/`),
  })
  const network = networkQuery.data

  useEffect(() => {
    const container = containerRef.current
    if (!container || !network) return
    const colors = tokens()
    const narrow = container.clientWidth < 520
    const graph = buildGraph(network, colors)

    let renderer: Sigma | undefined
    let hovered: string | null = null
    // Labels are first drawn inside the constructor, before `renderer` is set; refresh() below redraws them
    const centerX = () => renderer?.graphToViewport({ x: 0, y: 0 }).x ?? container.clientWidth / 2
    try {
      renderer = new Sigma(graph, container, {
        defaultNodeType: 'bordered',
        nodeProgramClasses: {
          bordered: createNodeBorderProgram({
            borders: [
              { size: { value: 2, mode: 'pixels' }, color: { attribute: 'borderColor' } },
              { size: { fill: true }, color: { attribute: 'color' } },
            ],
          }),
        },
        defaultDrawNodeLabel: labelDrawer(colors, centerX, container),
        defaultDrawNodeHover: hoverDrawer(colors, container),
        labelFont: "'DM Sans', system-ui, sans-serif",
        labelWeight: '700',
        labelSize: narrow ? 12 : 14,
        labelRenderedSizeThreshold: 0,
        // Show more names than sigma's default; it still skips labels that would collide
        labelDensity: 2,
        // Room on the sides for the outward-pointing labels
        stagePadding: narrow ? 70 : 60,
        // A static picture: the page keeps its own scrolling and dragging
        enableCameraZooming: false,
        enableCameraPanning: false,
        // Outsiders stay unnamed until someone linked to them is hovered. While someone is hovered,
        // fade everyone they aren't linked to and name everyone they are.
        nodeReducer: (node, data) => {
          if (!hovered) return data.outsider ? { ...data, label: '' } : data
          if (node === hovered) return { ...data, highlighted: true }
          if (graph.areNeighbors(node, hovered)) return { ...data, forceLabel: true }
          return { ...data, label: '', color: colors.bg, borderColor: colors.muted }
        },
        edgeReducer: (edge, data) => {
          if (!hovered || graph.hasExtremity(edge, hovered)) return data
          return { ...data, hidden: true }
        },
      })
    } catch {
      // No WebGL (old device, disabled GPU): hide the empty figure; the list still shows every connection
      container.parentElement!.hidden = true
      return
    }
    const activeRenderer = renderer
    activeRenderer.on('enterNode', ({ node }) => {
      hovered = node
      activeRenderer.refresh({ skipIndexation: true })
    })
    activeRenderer.on('leaveNode', () => {
      hovered = null
      activeRenderer.refresh({ skipIndexation: true })
    })
    activeRenderer.refresh()
    return () => activeRenderer.kill()
  }, [network, dark])

  // The list below still shows every connection
  if (networkQuery.isError) return null

  return (
    <figure className="connections-figure">
      <div
        ref={containerRef}
        className="connections-graph"
        role="img"
        aria-label="Graph of your connections and the people they know"
      />
      <figcaption>
        You're the yellow dot and your connections are lilac; the closer and bigger, the stronger. Plain dots
        are people your connections know. Hover over anyone to see their links.
      </figcaption>
    </figure>
  )
}
