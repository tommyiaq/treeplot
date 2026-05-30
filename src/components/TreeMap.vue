<template>
  <div class="map-container" ref="containerRef">
    <canvas
      ref="mapCanvas"
      style="width: 100%; height: 100%; display: block; touch-action: none"
    />

    <!-- HUD overlay -->
    <div class="hud-overlay">
      <!-- Top-right: nearby tree count -->
      <div class="hud-nearby-badge" v-if="nearbyCount > 0">
        🌲 {{ nearbyCount }} vicin{{ nearbyCount === 1 ? 'o' : 'i' }}
      </div>

      <!-- Bottom-left: action buttons -->
      <div class="hud-bottom-left">
        <button class="hud-btn" @click="$emit('load-csv')">Carica CSV</button>
        <button class="hud-btn" @click="handleExport">Esporta</button>
      </div>

      <!-- Bottom-right: compass to nearest unmeasured tree -->
      <div class="hud-compass" v-if="nearestInfo">
        <div class="compass-arrow" :style="{ transform: `rotate(${nearestInfo.bearing}deg)` }">↑</div>
        <div class="compass-info">
          <span class="compass-id">{{ nearestInfo.id }}</span>
          <span class="compass-dist">{{ nearestInfo.distance }}m</span>
          <span class="compass-dir hud-label">{{ nearestInfo.cardinal }}</span>
        </div>
      </div>

      <!-- Temporary HUD message -->
      <div class="hud-message" v-if="hudMessage" :class="{ visible: !!hudMessage }">
        {{ hudMessage }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { usePlotStore } from '../store/plot.js'
import { latLonToXZ, haversineDistance, compassBearing, cardinalDirection } from '../utils/gps.js'

const emit = defineEmits(['load-csv'])

const store = usePlotStore()
const containerRef = ref(null)
const mapCanvas = ref(null)

// Three.js refs
let renderer = null
let scene = null
let camera = null
let controls = null
let animationId = null
let clock = null

// Scene objects
let userMarker = null
let userRangeRing = null
let treeGroups = [] // { group, crownMesh, trunkMesh, treeId }
let crownMeshes = [] // for raycasting

// GPS
let gpsWatchId = null

// HUD state
const nearbyCount = computed(() => store.nearbyTrees.length)
const hudMessage = ref('')
let hudMessageTimer = null

const nearestInfo = computed(() => {
  if (!store.userPosition) return null
  const unmeasured = store.trees.filter((t) => t.measured_at === null)
  if (!unmeasured.length) return null

  let nearest = null
  let minDist = Infinity
  for (const t of unmeasured) {
    const d = haversineDistance(store.userPosition, { lat: t.lat, lon: t.lon })
    if (d < minDist) {
      minDist = d
      nearest = t
    }
  }
  if (!nearest) return null

  const bearing = compassBearing(store.userPosition, { lat: nearest.lat, lon: nearest.lon })
  return {
    id: nearest.id,
    distance: minDist.toFixed(1),
    bearing: Math.round(bearing),
    cardinal: cardinalDirection(bearing),
  }
})

function showHudMessage(msg, duration = 2500) {
  hudMessage.value = msg
  if (hudMessageTimer) clearTimeout(hudMessageTimer)
  hudMessageTimer = setTimeout(() => {
    hudMessage.value = ''
  }, duration)
}

// ──────────────────────────────────────────────
// Species color configs
// ──────────────────────────────────────────────
const SPECIES_CONFIG = {
  pino:    { crownColor: 0x33cc55, crownEmissive: 0x1a8830, emissiveIntensity: 0.7 },
  quercia: { crownColor: 0x88cc00, crownEmissive: 0x446600, emissiveIntensity: 0.7 },
  cipresso:{ crownColor: 0x00bbaa, crownEmissive: 0x007766, emissiveIntensity: 0.7 },
}

const GRAY_COLOR   = new THREE.Color(0x556677)
const GRAY_EMISSIVE = new THREE.Color(0x223344)
const TAPPABLE_EMISSIVE_INTENSITY = 0.8

// ──────────────────────────────────────────────
// Init Three.js
// ──────────────────────────────────────────────
function initThree() {
  const canvas = mapCanvas.value
  const container = containerRef.value
  const w = container.clientWidth
  const h = container.clientHeight

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(w, h)
  renderer.setClearColor(0x020915, 1)

  // Scene — no fog so trees stay visible at all distances
  scene = new THREE.Scene()

  // Camera
  camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500)
  camera.position.set(0, 25, 18)
  camera.lookAt(0, 0, 0)

  // Controls
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 5
  controls.maxDistance = 60
  controls.maxPolarAngle = Math.PI / 2.05
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  }

  // Clock
  clock = new THREE.Clock()

  // Lighting — bright enough to see tree colors clearly
  const ambient = new THREE.AmbientLight(0xffffff, 2.5)
  scene.add(ambient)

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
  dirLight.position.set(10, 30, 10)
  scene.add(dirLight)

  // Build static scene elements
  buildGround()
  buildGridRings()
  buildPlotBoundary()
  buildUserMarker()

  // Build trees
  buildTreeObjects()

  // Start render loop
  renderLoop()
}

function buildGround() {
  const geom = new THREE.CircleGeometry(20, 64)
  const mat = new THREE.MeshBasicMaterial({ color: 0x0d1e2e, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0
  scene.add(mesh)
}

function buildGridRings() {
  const radii = [3, 6, 9, 12]
  radii.forEach((r) => {
    const geom = new THREE.RingGeometry(r - 0.03, r + 0.03, 64)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a4060,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0.01
    scene.add(mesh)

    // Radius label (not using canvas text, just a small marker)
  })
}

function buildPlotBoundary() {
  const geom = new THREE.RingGeometry(12.95, 13.05, 128)
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.02
  scene.add(mesh)

  // Glowing inner ring (slightly brighter)
  const glowGeom = new THREE.RingGeometry(12.9, 13.1, 128)
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.15,
  })
  const glowMesh = new THREE.Mesh(glowGeom, glowMat)
  glowMesh.rotation.x = -Math.PI / 2
  glowMesh.position.y = 0.015
  scene.add(glowMesh)
}

function buildUserMarker() {
  const markerGroup = new THREE.Group()
  markerGroup.position.set(0, 0.05, 0)

  // Outer ring
  const outerGeom = new THREE.RingGeometry(0.6, 0.8, 32)
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
  })
  const outerRing = new THREE.Mesh(outerGeom, outerMat)
  outerRing.rotation.x = -Math.PI / 2
  markerGroup.add(outerRing)

  // Inner dot
  const innerGeom = new THREE.CircleGeometry(0.3, 32)
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
  })
  const innerDot = new THREE.Mesh(innerGeom, innerMat)
  innerDot.rotation.x = -Math.PI / 2
  markerGroup.add(innerDot)

  scene.add(markerGroup)
  userMarker = markerGroup

  // 5m range ring
  const rangeGeom = new THREE.RingGeometry(4.9, 5.0, 64)
  const rangeMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.3,
  })
  const rangeRing = new THREE.Mesh(rangeGeom, rangeMat)
  rangeRing.rotation.x = -Math.PI / 2
  rangeRing.position.y = 0.03
  scene.add(rangeRing)
  userRangeRing = rangeRing
}

function makeTreeGroup(tree) {
  const group = new THREE.Group()
  group.userData.treeId = tree.id

  const diamCm = tree.diameter_cm
  // Compress visual height so trees fit the camera framing (plot radius = 13 units)
  const height = tree.height_m * 0.18

  // Trunk
  const trunkH = Math.max(0.3, height * 0.25)
  const trunkGeom = new THREE.CylinderGeometry(
    (diamCm / 200),
    (diamCm / 200) * 0.8,
    trunkH,
    8
  )
  const trunkMat = new THREE.MeshBasicMaterial({ color: 0x3d2010 })
  const trunk = new THREE.Mesh(trunkGeom, trunkMat)
  trunk.position.y = trunkH / 2
  group.add(trunk)

  // Crown
  let crownGeom
  let crownYOffset
  const cfg = SPECIES_CONFIG[tree.species] || SPECIES_CONFIG.pino

  if (tree.species === 'pino') {
    crownGeom = new THREE.ConeGeometry((diamCm / 100) * 0.8, height * 0.7, 8)
    crownYOffset = trunkH + (height * 0.7) / 2
  } else if (tree.species === 'quercia') {
    crownGeom = new THREE.SphereGeometry((diamCm / 100) * 1.1, 8, 6)
    crownYOffset = trunkH + (diamCm / 100) * 1.1
  } else {
    // cipresso
    crownGeom = new THREE.ConeGeometry((diamCm / 100) * 0.3, height * 0.9, 6)
    crownYOffset = trunkH + (height * 0.9) / 2
  }

  const crownMat = new THREE.MeshStandardMaterial({
    color: cfg.crownColor,
    emissive: cfg.crownEmissive,
    emissiveIntensity: cfg.emissiveIntensity,
    roughness: 0.8,
    metalness: 0.0,
  })

  const crown = new THREE.Mesh(crownGeom, crownMat)
  crown.position.y = crownYOffset
  crown.userData.treeId = tree.id
  crown.userData.species = tree.species
  crown.userData.baseEmissiveIntensity = cfg.emissiveIntensity
  crown.userData.baseColor = cfg.crownColor
  crown.userData.baseEmissive = cfg.crownEmissive
  group.add(crown)

  // Position group in scene
  const center = store.plotCenter
  if (center) {
    const { x, z } = latLonToXZ(center.lat, center.lon, tree.lat, tree.lon)
    group.position.set(x, 0, z)
  }

  return { group, crownMesh: crown, trunkMesh: trunk }
}

function buildTreeObjects() {
  // Clear existing
  treeGroups.forEach(({ group }) => scene.remove(group))
  treeGroups = []
  crownMeshes = []

  store.trees.forEach((tree) => {
    const { group, crownMesh, trunkMesh } = makeTreeGroup(tree)
    scene.add(group)
    treeGroups.push({ group, crownMesh, trunkMesh, treeId: tree.id })
    crownMeshes.push(crownMesh)
  })

  // Apply measured state
  updateTreeStates()
}

function updateTreeStates() {
  const tappableIds = new Set(store.tappableTrees.map((t) => t.id))

  treeGroups.forEach(({ crownMesh, treeId }) => {
    const tree = store.trees.find((t) => t.id === treeId)
    if (!tree) return

    const mat = crownMesh.material
    const cfg = SPECIES_CONFIG[tree.species] || SPECIES_CONFIG.pino

    if (tree.measured_at !== null) {
      // Measured: species color, pulse handled in render loop
      mat.color.set(cfg.crownColor)
      mat.emissive.set(cfg.crownEmissive)
      mat.emissiveIntensity = 0.5
    } else if (tappableIds.has(treeId)) {
      // Tappable (nearby unmeasured): dim gray with faster pulse
      mat.color.set(GRAY_COLOR)
      mat.emissive.set(GRAY_EMISSIVE)
      mat.emissiveIntensity = TAPPABLE_EMISSIVE_INTENSITY
    } else {
      // Unmeasured, not tappable: flat gray
      mat.color.set(GRAY_COLOR)
      mat.emissive.set(GRAY_EMISSIVE)
      mat.emissiveIntensity = 0.2
    }
  })
}

function renderLoop() {
  animationId = requestAnimationFrame(renderLoop)
  const elapsed = clock.getElapsedTime()

  controls.update()

  // Animate tree emissive intensities
  treeGroups.forEach(({ crownMesh, treeId }) => {
    const tree = store.trees.find((t) => t.id === treeId)
    if (!tree) return
    if (tree.measured_at !== null) {
      // Measured: slow sparkle pulse in species color
      crownMesh.material.emissiveIntensity = 0.4 + 0.5 * Math.abs(Math.sin(elapsed * 1.5))
    } else {
      // Tappable gray: faster pulse to signal it's selectable
      const isTappable = store.tappableTrees.some((t) => t.id === treeId)
      crownMesh.material.emissiveIntensity = isTappable
        ? 0.3 + 0.5 * Math.abs(Math.sin(elapsed * 2.5))
        : 0.2
    }
  })

  renderer.render(scene, camera)
}

// ──────────────────────────────────────────────
// GPS
// ──────────────────────────────────────────────
function startGps() {
  if (!navigator.geolocation) {
    console.warn('[GPS] Geolocation not supported')
    return
  }
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      store.setUserPosition(pos.coords.latitude, pos.coords.longitude)
    },
    (err) => {
      console.warn('[GPS] Error:', err.message)
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  )
}

function stopGps() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId)
    gpsWatchId = null
  }
}

// ──────────────────────────────────────────────
// Touch / click raycasting
// ──────────────────────────────────────────────
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function getCanvasNDC(clientX, clientY) {
  const canvas = mapCanvas.value
  const rect = canvas.getBoundingClientRect()
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
}

function castRay() {
  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(crownMeshes, false)
  if (!intersects.length) return

  const hit = intersects[0].object
  const treeId = hit.userData.treeId
  if (!treeId) return

  const tree = store.trees.find((t) => t.id === treeId)
  if (!tree) return

  const tappable = store.tappableTrees.find((t) => t.id === treeId)
  if (tappable) {
    store.setSelectedTree(tree)
  } else if (store.userPosition) {
    const dist = haversineDistance(store.userPosition, { lat: tree.lat, lon: tree.lon })
    showHudMessage(`Troppo lontano — avvicinati a ${dist.toFixed(1)}m (${tree.id})`)
  }
}

function onCanvasClick(e) {
  getCanvasNDC(e.clientX, e.clientY)
  castRay()
}

let lastTouchX = 0
let lastTouchY = 0
let touchStartTime = 0

function onTouchStart(e) {
  if (e.touches.length === 1) {
    lastTouchX = e.touches[0].clientX
    lastTouchY = e.touches[0].clientY
    touchStartTime = Date.now()
  }
}

function onTouchEnd(e) {
  if (e.changedTouches.length === 1) {
    const dx = Math.abs(e.changedTouches[0].clientX - lastTouchX)
    const dy = Math.abs(e.changedTouches[0].clientY - lastTouchY)
    const dt = Date.now() - touchStartTime
    // Only treat as tap if minimal movement and short duration
    if (dx < 10 && dy < 10 && dt < 400) {
      getCanvasNDC(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
      castRay()
    }
  }
}

function onTouchMove(e) {
  // Prevent page scroll
  e.preventDefault()
}

// ──────────────────────────────────────────────
// Resize
// ──────────────────────────────────────────────
let resizeObserver = null

function onResize() {
  const container = containerRef.value
  if (!container || !renderer || !camera) return
  const w = container.clientWidth
  const h = container.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

// ──────────────────────────────────────────────
// Watchers
// ──────────────────────────────────────────────
watch(
  () => store.userPosition,
  (pos) => {
    if (!pos || !userMarker || !store.plotCenter) return
    const { x, z } = latLonToXZ(store.plotCenter.lat, store.plotCenter.lon, pos.lat, pos.lon)
    userMarker.position.set(x, 0.05, z)
    if (userRangeRing) userRangeRing.position.set(x, 0.03, z)
    updateTreeStates()
  }
)

watch(
  () => store.trees,
  () => {
    buildTreeObjects()
  },
  { deep: false }
)

watch(
  () => store.measuredCount,
  () => {
    updateTreeStates()
  }
)

// ──────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────
onMounted(() => {
  initThree()
  startGps()

  const canvas = mapCanvas.value
  canvas.addEventListener('click', onCanvasClick)
  canvas.addEventListener('touchstart', onTouchStart, { passive: true })
  canvas.addEventListener('touchend', onTouchEnd, { passive: true })
  canvas.addEventListener('touchmove', onTouchMove, { passive: false })

  resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(containerRef.value)
})

onUnmounted(() => {
  stopGps()

  if (animationId) cancelAnimationFrame(animationId)

  const canvas = mapCanvas.value
  if (canvas) {
    canvas.removeEventListener('click', onCanvasClick)
    canvas.removeEventListener('touchstart', onTouchStart)
    canvas.removeEventListener('touchend', onTouchEnd)
    canvas.removeEventListener('touchmove', onTouchMove)
  }

  if (resizeObserver) resizeObserver.disconnect()

  if (controls) controls.dispose()

  if (renderer) {
    renderer.dispose()
    renderer = null
  }

  // Dispose geometries and materials
  treeGroups.forEach(({ crownMesh, trunkMesh }) => {
    crownMesh.geometry.dispose()
    crownMesh.material.dispose()
    trunkMesh.geometry.dispose()
    trunkMesh.material.dispose()
  })
})

function handleExport() {
  store.exportCsv()
}
</script>

<style scoped>
.map-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #020915;
}

.hud-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

.hud-nearby-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(4, 13, 26, 0.85);
  border: 1px solid var(--border);
  color: var(--teal);
  font-size: 12px;
  letter-spacing: 1px;
  padding: 4px 10px;
  border-radius: 2px;
  pointer-events: none;
}

.hud-bottom-left {
  position: absolute;
  bottom: 14px;
  left: 10px;
  display: flex;
  gap: 8px;
  pointer-events: all;
}

.hud-btn {
  font-size: 11px;
  padding: 5px 10px;
  letter-spacing: 1px;
  background: rgba(4, 13, 26, 0.85);
}

.hud-compass {
  position: absolute;
  bottom: 14px;
  right: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(4, 13, 26, 0.85);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 2px;
  min-width: 70px;
  pointer-events: none;
}

.compass-arrow {
  font-size: 22px;
  color: var(--cyan);
  display: block;
  text-align: center;
  line-height: 1;
  transition: transform 0.3s ease;
}

.compass-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 2px;
}

.compass-id {
  font-size: 11px;
  color: var(--cyan);
  letter-spacing: 1px;
}

.compass-dist {
  font-size: 14px;
  color: var(--text);
  font-weight: bold;
}

.compass-dir {
  font-size: 10px;
  color: var(--dim);
}

.hud-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(4, 13, 26, 0.92);
  border: 1px solid var(--amber);
  color: var(--amber);
  font-size: 13px;
  letter-spacing: 1px;
  padding: 10px 18px;
  border-radius: 2px;
  text-align: center;
  max-width: 260px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.hud-message.visible {
  opacity: 1;
}
</style>
