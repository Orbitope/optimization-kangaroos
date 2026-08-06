import { CKColor, CKMarker, hexToInt } from '@contentkit/tokens'
import { hopPose, type HopOptions, type Vec3 } from '@kangaroos/core'
import { useGLTF } from '@react-three/drei'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import * as THREE from 'three'

/**
 * Placeholder geometry, used until a real model is supplied.
 *
 * Deliberately crude but correctly proportioned and oriented: it faces +Z, its
 * feet sit at y = 0, and it stands roughly one unit tall before scaling. That
 * is enough for every other part of the scene to be built and verified without
 * the asset, and obvious enough that nobody mistakes it for finished art.
 */
function usePlaceholderKangaroo(): THREE.BufferGeometry {
  return useMemo(() => {
    const parts: THREE.BufferGeometry[] = []

    const body = new THREE.CapsuleGeometry(0.22, 0.34, 4, 8)
    body.rotateX(Math.PI * 0.16)
    body.translate(0, 0.52, 0)
    parts.push(body)

    const head = new THREE.CapsuleGeometry(0.12, 0.14, 4, 8)
    head.rotateX(Math.PI * 0.5)
    head.translate(0, 0.86, 0.16)
    parts.push(head)

    const tail = new THREE.CapsuleGeometry(0.07, 0.5, 4, 6)
    tail.rotateX(Math.PI * 0.62)
    tail.translate(0, 0.24, -0.36)
    parts.push(tail)

    for (const side of [-1, 1]) {
      const thigh = new THREE.CapsuleGeometry(0.09, 0.2, 4, 6)
      thigh.translate(side * 0.14, 0.3, -0.04)
      parts.push(thigh)

      const foot = new THREE.BoxGeometry(0.11, 0.06, 0.3)
      foot.translate(side * 0.14, 0.04, 0.06)
      parts.push(foot)
    }

    const merged = mergeGeometries(parts)
    parts.forEach((p) => p.dispose())
    return merged
  }, [])
}

/** Minimal geometry merge — avoids pulling in three's addons for six shapes. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g))
  const total = nonIndexed.reduce((n, g) => n + g.attributes.position!.count, 0)

  const positions = new Float32Array(total * 3)
  const normals = new Float32Array(total * 3)
  let offset = 0

  for (const g of nonIndexed) {
    positions.set(g.attributes.position!.array as Float32Array, offset * 3)
    normals.set(g.attributes.normal!.array as Float32Array, offset * 3)
    offset += g.attributes.position!.count
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  out.computeBoundingSphere()
  return out
}

export interface KangarooProps {
  from: Vec3
  to: Vec3
  /** Progress through the current hop, 0..1. */
  t: number
  /** World-space height of the model at neutral scale. */
  size?: number
  color?: string
  hop?: HopOptions
  /** Held when a step has no horizontal extent, so a rejected hop doesn't spin. */
  previousHeading?: number
}

/**
 * One kangaroo, mid-hop.
 *
 * The pose comes from `hopPose` in the core rather than from an animation
 * clip. With a static mesh there is no rig to blend anyway, and it means the
 * arc height and the squash both derive from the actual step vector — a canned
 * cycle would play identically for a 0.01-unit step and a 3-unit overshoot.
 */
export function Kangaroo({
  from,
  to,
  t,
  size = 0.055,
  color = CKMarker.fill,
  hop,
  previousHeading = 0,
}: KangarooProps) {
  const group = useRef<THREE.Group>(null)
  const geometry = useKangarooGeometry()

  const pose = hopPose(from, to, t, hop, previousHeading)

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    g.position.set(pose.position.x, pose.position.y, pose.position.z)
    g.rotation.set(0, pose.heading, 0)
    g.scale.set(pose.scale.x * size, pose.scale.y * size, pose.scale.z * size)
  })

  return (
    <group ref={group}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial
          color={hexToInt(color)}
          roughness={0.55}
          emissive={hexToInt(color)}
          emissiveIntensity={0.18}
        />
      </mesh>
    </group>
  )
}

const KangarooGeometryContext = createContext<THREE.BufferGeometry | null>(null)

/**
 * Supply a real model to everything below.
 *
 * A provider rather than a `url` prop on each component: `useGLTF` suspends,
 * and calling it conditionally — which is what a per-component optional `url`
 * would require — breaks the rules of hooks. Wrapping instead keeps the load
 * unconditional and lets the whole scene share one parsed geometry.
 */
export function KangarooModel({ url, children }: { url: string; children: ReactNode }) {
  const gltf = useGLTF(url)

  const geometry = useMemo(() => {
    let found: THREE.BufferGeometry | null = null
    gltf.scene.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh
      if (!found && mesh.isMesh) found = mesh.geometry
    })
    return found
  }, [gltf])

  return (
    <KangarooGeometryContext.Provider value={geometry}>{children}</KangarooGeometryContext.Provider>
  )
}

/** The provided model if there is one, otherwise the placeholder. */
function useKangarooGeometry(): THREE.BufferGeometry {
  const provided = useContext(KangarooGeometryContext)
  const placeholder = usePlaceholderKangaroo()
  return provided ?? placeholder
}

export interface KangarooCrowdProps {
  /**
   * Start and end of every individual's current hop, in world space.
   *
   * `previousHeading` is held when the step has no horizontal extent — an
   * individual that did not move this generation, or a run that has already
   * finished. Without it they all pivot to face north the moment they stop.
   */
  hops: readonly { from: Vec3; to: Vec3; previousHeading?: number }[]
  t: number
  size?: number
  /** One colour per individual, or a single colour for all. */
  colors?: readonly string[]
  color?: string
  hop?: HopOptions
}

/**
 * A whole population, hopping at once.
 *
 * A single `InstancedMesh`, which is only possible because the model has no
 * rig: the entire animation is a matrix per instance, so there is no skinning
 * to instance. Skinned crowds are the genuinely hard case in web 3D and this
 * sidesteps it — forty kangaroos cost one draw call.
 */
export function KangarooCrowd({
  hops,
  t,
  size = 0.04,
  colors,
  // Not amber: it scores ΔE 4 against the cartographic ramp's uplands, so an
  // uncoloured crowd would climb straight into camouflage.
  color = CKMarker.fill,
  hop,
}: KangarooCrowdProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useKangarooGeometry()
  const scratch = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return

    hops.forEach((h, i) => {
      const pose = hopPose(h.from, h.to, t, hop, h.previousHeading ?? 0)
      scratch.position.set(pose.position.x, pose.position.y, pose.position.z)
      scratch.rotation.set(0, pose.heading, 0)
      scratch.scale.set(pose.scale.x * size, pose.scale.y * size, pose.scale.z * size)
      scratch.updateMatrix()
      m.setMatrixAt(i, scratch.matrix)
    })

    m.count = hops.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  })

  // Colours only change when the population is resized or recoloured.
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m || !colors) return
    const c = new THREE.Color()
    colors.forEach((hex, i) => m.setColorAt(i, c.set(hex)))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [colors])

  return (
    <instancedMesh
      ref={mesh}
      // Capacity is fixed at creation, so allocate for the largest population
      // this mount will ever show rather than reallocating mid-run.
      args={[geometry, undefined, Math.max(1, hops.length)]}
      castShadow
      key={hops.length}
    >
      <meshStandardMaterial color={hexToInt(color)} roughness={0.6} />
    </instancedMesh>
  )
}

export interface KangarooGenerationsProps {
  /**
   * One entry per generation shown, oldest first, each holding that
   * generation's whole population in world space.
   */
  generations: readonly (readonly Vec3[])[]
  size?: number
  /** Oldest and newest colours; generations interpolate between them. */
  from?: string
  to?: string
}

/**
 * A population drawn generation by generation, standing still.
 *
 * The hopping version was wrong about what a genetic algorithm does. Offspring
 * are not their parents having jumped — they are new individuals, born
 * somewhere else, and drawing an arc between generation five and generation six
 * asserts a continuity that does not exist. There is no path to animate,
 * because nothing travelled.
 *
 * So: no arcs. Each generation is a scatter of individuals standing where they
 * were born, and several generations are on screen at once, colour-coded oldest
 * to newest. The reading is then the right one — not "watch her climb" but
 * "watch the cloud contract onto the high ground", which is the only thing a
 * genetic algorithm actually does.
 *
 * One `InstancedMesh` for every generation at once. Fading older ones by both
 * colour and scale rather than by opacity, because transparent instances need
 * depth sorting the renderer will not do for them and the far half of the cloud
 * would punch holes in the near half.
 */
export function KangarooGenerations({
  generations,
  size = 0.045,
  // Not steelDark: it is near-black, and with no emissive term on an instanced
  // material half the generations rendered as unlit specks against the terrain.
  // Both ends of this ramp have to survive on their own.
  from = '#4E9BC8',
  to = CKMarker.fill,
}: KangarooGenerationsProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useKangarooGeometry()
  const scratch = useMemo(() => new THREE.Object3D(), [])
  const capacity = useMemo(
    () => generations.reduce((n, g) => n + g.length, 0),
    [generations],
  )

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const colour = new THREE.Color()
    const a = new THREE.Color(from)
    const b = new THREE.Color(to)

    let i = 0
    generations.forEach((gen, g) => {
      // Newest generation is full size and full colour; each older one is
      // smaller and closer to the background.
      const age = generations.length < 2 ? 1 : g / (generations.length - 1)
      const scale = size * (0.55 + 0.45 * age)
      // Linear rather than eased: the point is to read generation order off the
      // colour, and squaring it crushes the older half into one hue.
      colour.copy(a).lerp(b, age)

      for (const p of gen) {
        scratch.position.set(p.x, p.y, p.z)
        scratch.rotation.set(0, 0, 0)
        scratch.scale.setScalar(scale)
        scratch.updateMatrix()
        m.setMatrixAt(i, scratch.matrix)
        m.setColorAt(i, colour)
        i++
      }
    })

    m.count = i
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  })

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, Math.max(1, capacity)]} key={capacity} castShadow>
      {/*
        No `vertexColors`. Instanced colour arrives through `instanceColor`,
        which three multiplies into the material colour on its own; asking for
        vertex colours as well makes it look for a `color` attribute on the
        geometry, find none on a mesh built from primitives, and fall through
        to white — which is exactly what the first attempt rendered.

        The material colour therefore has to stay white, or it would tint every
        instance on top of the generation ramp.
      */}
      <meshStandardMaterial roughness={0.5} emissiveIntensity={0} />
    </instancedMesh>
  )
}
