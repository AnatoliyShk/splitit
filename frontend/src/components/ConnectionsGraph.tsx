import { createNodeBorderProgram } from '@sigma/node-border'
import Graph from 'graphology'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Sigma from 'sigma'
import type { NodeHoverDrawingFunction, NodeLabelDrawingFunction } from 'sigma/rendering'
import { apiGet } from '../api'
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
  const me = network.nodes.find((n) => n.degree === 0)!
  const mine = new Map<string, number>() // connection uuid -> strength with the user
  const anchor = new Map<string, { friend: string; strength: number }>() // outsider -> strongest friend link
  const maxStrength = Math.max(...network.edges.map((e) => e.strength))
  for (const e of network.edges) {
    const other = e.source === me.uuid ? e.target : e.target === me.uuid ? e.source : null
    if (other) mine.set(other, e.strength)
  }
  const degree = new Map(network.nodes.map((n) => [n.uuid, n.degree]))
  for (const e of network.edges) {
    for (const [outsider, friend] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      if (degree.get(outsider) !== 2 || degree.get(friend) !== 1) continue
      if ((anchor.get(outsider)?.strength ?? -1) < e.strength) anchor.set(outsider, { friend, strength: e.strength })
    }
  }

  const maxMine = Math.max(...mine.values())
  const polar = new Map<string, { angle: number; radius: number }>()
  graph.addNode(me.uuid, { x: 0, y: 0, size: 16, color: colors.primary, borderColor: colors.ink })
  // Connections arrive strongest first; the golden angle spreads neighbours in that order apart
  network.nodes
    .filter((n) => n.degree === 1)
    .forEach((n, i) => {
      const share = (mine.get(n.uuid) ?? 0) / maxMine
      const angle = i * GOLDEN_ANGLE - Math.PI / 2
      const radius = 1 - 0.45 * share
      polar.set(n.uuid, { angle, radius })
      graph.addNode(n.uuid, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        size: 7 + 5 * share,
        label: n.name,
        color: colors.secondary,
        borderColor: colors.ink,
      })
    })
  // Outsiders fan out just past their friend, a small step apart
  const fans = new Map<string, string[]>()
  for (const [outsider, { friend }] of anchor) fans.set(friend, [...(fans.get(friend) ?? []), outsider])
  const names = new Map(network.nodes.map((n) => [n.uuid, n.name]))
  for (const [friend, outsiders] of fans) {
    const { angle, radius } = polar.get(friend)!
    outsiders.forEach((uuid, j) => {
      const a = angle + (j - (outsiders.length - 1) / 2) * 0.22
      const r = radius + 0.5
      graph.addNode(uuid, {
        x: r * Math.cos(a),
        y: r * Math.sin(a),
        size: 6,
        label: names.get(uuid),
        color: colors.surface,
        borderColor: colors.ink,
        outsider: true,
      })
    })
  }

  for (const e of network.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
    const withMe = e.source === me.uuid || e.target === me.uuid
    const share = withMe ? e.strength / maxMine : e.strength / maxStrength
    // Your own links are ink; links between other people are the quieter muted tone
    graph.addEdge(e.source, e.target, {
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
  const [network, setNetwork] = useState<Network | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    apiGet<Network>(`/api/users/${userUuid}/connections/graph/`)
      .then(setNetwork)
      .catch(() => setFailed(true)) // the list below still shows every connection
  }, [userUuid])

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
    const r = renderer
    r.on('enterNode', ({ node }) => {
      hovered = node
      r.refresh({ skipIndexation: true })
    })
    r.on('leaveNode', () => {
      hovered = null
      r.refresh({ skipIndexation: true })
    })
    r.refresh()
    return () => r.kill()
  }, [network, dark])

  if (failed) return null

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
