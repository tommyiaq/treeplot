<template>
  <div class="chat-panel" :class="{ open: isOpen }">
    <!-- Handle / toggle header -->
    <div class="chat-handle" @click="togglePanel">
      <div class="handle-bar"></div>
      <span class="handle-title">⣿ FORESTA ASSISTANT</span>
      <button class="handle-close-btn" @click.stop="togglePanel">
        {{ isOpen ? '✕' : '▲' }}
      </button>
    </div>

    <!-- Panel body -->
    <div class="chat-body" v-show="isOpen">

      <!-- ── Measurement mode banner ── -->
      <div class="measure-banner" v-if="measureTree">
        <span class="measure-icon">{{ speciesIcon(measureTree) }}</span>
        <div class="measure-tree-meta">
          <span class="measure-tree-id">{{ measureTree.id }}</span>
          <span class="measure-tree-sp">{{ measureTree.species.toUpperCase() }}</span>
          <span class="measure-ref">
            Rif&nbsp;H={{ refH(measureTree) }}m · DBH={{ refD(measureTree) }}cm
          </span>
        </div>
        <div class="measure-banner-actions">
          <button class="form-btn" @click="openForm" title="Apri form manuale">⊞</button>
          <button class="exit-btn" @click="exitMeasure" title="Esci dal rilievo">✕</button>
        </div>
      </div>

      <!-- ── Parsed values preview ── -->
      <div class="measure-preview" v-if="measureTree && hasSomeParsed">
        <div class="pv-field" :class="{ filled: parsed.height !== null }">
          <span class="pv-label">H</span>
          <span class="pv-val">{{ parsed.height !== null ? parsed.height + ' m' : '—' }}</span>
        </div>
        <div class="pv-field" :class="{ filled: parsed.diameter !== null }">
          <span class="pv-label">DBH</span>
          <span class="pv-val">{{ parsed.diameter !== null ? parsed.diameter + ' cm' : '—' }}</span>
        </div>
        <div class="pv-field" :class="{ filled: parsed.health !== null }">
          <span class="pv-label">Salute</span>
          <span class="pv-val">{{ parsed.health !== null ? parsed.health + '/5' : '—' }}</span>
        </div>
        <button class="save-btn" v-if="allParsed" @click="saveMeasurement">SALVA ✓</button>
      </div>

      <!-- ── Messages list ── -->
      <div class="messages-list" ref="messagesRef">
        <div
          v-for="(msg, i) in visibleMessages"
          :key="i"
          class="msg-bubble"
          :class="msg.role"
        >
          <div class="msg-content" v-html="formatMessage(msg.content)"></div>
        </div>

        <div v-if="isStreaming" class="msg-bubble assistant streaming">
          <div class="msg-content"><span class="stream-cursor">▋</span></div>
        </div>
      </div>

      <!-- ── LLM loading progress ── -->
      <div class="llm-loading" v-if="store.llmStatus === 'loading'">
        <div class="progress-bar-track">
          <div class="progress-bar-fill" :style="{ width: `${store.llmProgress * 100}%` }"></div>
        </div>
        <div class="loading-msg hud-label">
          {{ store.llmProgressMsg || 'Caricamento modello...' }}
          {{ store.llmProgress > 0 ? `${Math.round(store.llmProgress * 100)}%` : '' }}
        </div>
      </div>

      <!-- ── Error state ── -->
      <div class="llm-error" v-if="store.llmStatus === 'error'">
        <div style="display:flex;flex-direction:column;gap:4px;width:100%">
          <span class="hud-label" style="color:#ff4444">⚠ Gemini non disponibile — modalità form attiva</span>
          <span v-if="llmErrorMsg" style="font-size:10px;color:#aa6666;letter-spacing:0.5px">{{ llmErrorMsg }}</span>
          <span style="font-size:10px;color:var(--dim)">Tocca un albero → usa il form ⊞ per misurare</span>
        </div>
        <button @click="retryInit" style="font-size:11px;flex-shrink:0">Riprova</button>
      </div>

      <!-- ── Input area ── -->
      <div class="chat-input-area">
        <textarea
          ref="inputRef"
          v-model="userInput"
          class="chat-input"
          rows="1"
          :placeholder="measureTree ? 'Es: 15m, 32cm, salute 4…' : 'Scrivi un messaggio…'"
          @keydown.enter.exact.prevent="sendMessage"
          @input="autoResizeTextarea"
        ></textarea>
        <button
          class="send-btn"
          @click="sendMessage"
          :disabled="!userInput.trim() || (isStreaming && !measureTree)"
        >➤</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, reactive } from 'vue'
import { usePlotStore } from '../store/plot.js'
import { initLLM, chatWithTrees, parseMeasurementJSON, isReady, clearModelCache } from '../utils/gemini.js'
import { haversineDistance, compassBearing, cardinalDirection } from '../utils/gps.js'

const store = usePlotStore()

const isOpen      = ref(false)
const userInput   = ref('')
const messagesRef = ref(null)
const inputRef    = ref(null)
const isStreaming  = ref(false)
const llmErrorMsg  = ref('')

// ── Measurement mode ──────────────────────────────────────────────────────────
const measureTree = ref(null)  // tree currently being measured via chat
const parsed = reactive({ height: null, diameter: null, health: null })

const hasSomeParsed = computed(() =>
  parsed.height !== null || parsed.diameter !== null || parsed.health !== null
)
const allParsed = computed(() =>
  parsed.height !== null && parsed.diameter !== null && parsed.health !== null
)

const SPECIES_ICONS = { pino: '🌲', quercia: '🌳', cipresso: '🌴' }
const speciesIcon = (t) => SPECIES_ICONS[t?.species] || '🌲'
const refH = (t) => t.measured_height_m   ?? t.height_m
const refD = (t) => t.measured_diameter_cm ?? t.diameter_cm

function resetParsed() {
  parsed.height   = null
  parsed.diameter = null
  parsed.health   = null
}

// Watch for tree selection → open chat, enter measurement mode
watch(() => store.selectedTree, (tree) => {
  if (tree) {
    isOpen.value = true
    measureTree.value = tree
    resetParsed()

    const icon = speciesIcon(tree)
    const rh = refH(tree)
    const rd = refD(tree)
    const isUpdate = tree.measured_at !== null

    const llmOk = store.llmStatus === 'ready'
    store.addChatMessage(
      'assistant',
      `${icon} **${tree.id} — ${tree.species.toUpperCase()}**\n` +
      `${isUpdate ? '🔄 Aggiornamento misure\n' : ''}` +
      `Riferimento: H=${rh}m · DBH=${rd}cm\n\n` +
      (llmOk
        ? `Dimmi le nuove misure. Esempi:\n_"15m, 32cm, salute 4"_`
        : `LLM non attivo — scrivi le misure o usa il form **⊞**.\nEs: _"15m, 32cm, salute 4"_`)
    )
    nextTick(scrollToBottom)
  } else {
    measureTree.value = null
    resetParsed()
  }
})

function exitMeasure() {
  store.setSelectedTree(null)
}

function openForm() {
  store.measureModalOpen = true
}

function saveMeasurement() {
  if (!allParsed.value || !measureTree.value) return

  // Validate limits before saving
  if (parsed.height < 0.1 || parsed.height > 100) {
    store.addChatMessage('assistant', `⚠ Altezza ${parsed.height}m fuori range (0.1–100m). Correggi e riprova.`)
    return
  }
  if (parsed.diameter < 0.5 || parsed.diameter > 500) {
    store.addChatMessage('assistant', `⚠ DBH ${parsed.diameter}cm fuori range (0.5–500cm). Correggi e riprova.`)
    return
  }

  store.updateMeasurement(measureTree.value.id, {
    height_m:    parsed.height,
    diameter_cm: parsed.diameter,
    health:      parsed.health,
  })

  const id = measureTree.value.id
  store.addChatMessage(
    'assistant',
    `✅ **${id}** salvato: H=${parsed.height}m · DBH=${parsed.diameter}cm · Salute=${parsed.health}/5`
  )
  store.setSelectedTree(null)
  nextTick(scrollToBottom)
}

// ── Gemini measurement prompt ─────────────────────────────────────────────────
function buildMeasurementPrompt(tree) {
  const base = tree.measured_at
    ? `Ultima rilevazione: H=${tree.measured_height_m}m · DBH=${tree.measured_diameter_cm}cm · Salute=${tree.measured_health}/5`
    : `Rilievo originale: H=${tree.height_m ?? '—'}m · DBH=${tree.diameter_cm ?? '—'}cm`

  return `Assistente rilievi forestali. Albero: ${tree.id} (${tree.specie_raw || tree.species}). ${base}.

Estrai dal messaggio dell'operatore: altezza (m), diametro/DBH (cm), salute (1–5).
Gestisci espressioni naturali: "stesse misure", "1m in più", "cresciuto di 3cm", "salute ottima" (=5), ecc.
Usa i valori base per risolvere espressioni relative o "stesse misure".
Se altezza o DBH diminuiscono rispetto alla base, avvisa nel message.

Rispondi SEMPRE e SOLO con questo JSON (nessun testo fuori dal JSON):
{"height_m": <numero o null>, "diameter_cm": <numero o null>, "health": <intero 1-5 o null>, "message": "<testo breve in italiano>"}

- Valori trovati → numero; valori mancanti → null
- message: conferma se completo, oppure chiede solo i valori mancanti`
}


// Pure regex parser — returns {height, diameter, health}, each null if not found.
// refH / refD: reference values used to resolve relative expressions ("X in più").
function parseValues(raw, refH = null, refD = null) {
  let t = raw.toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ')
  const result = { height: null, diameter: null, health: null }

  // ── Height ────────────────────────────────────────────────────────────────
  const hCtx  = /(?:altezza|alt(?:ezza)?|h(?:eight)?)\s*[:=]?\s*(\d+(?:\.\d+)?)/
  const hUnit = /(\d+(?:\.\d+)?)\s*m(?:etr[io]?)?(?!\w)(?!\s*c)/   // metro/metri/m
  let m = t.match(hCtx) || t.match(hUnit)
  if (m) { result.height = parseFloat(m[1]); t = t.replace(m[0], ' ') }

  // Relative height: "X m in più", "aumentata di X", "X metro in più"
  if (result.height === null && refH !== null) {
    const rel = t.match(/(\d+(?:\.\d+)?)\s*m(?:etr[io]?)?\s+in\s+più/i)
             || t.match(/(?:aumentat[ao]|cresciut[ao]|salito)\s+di\s+(\d+(?:\.\d+)?)/i)
             || t.match(/in\s+più\s+(?:di\s+)?(\d+(?:\.\d+)?)\s*m/i)
    if (rel) result.height = Math.round((refH + parseFloat(rel[1])) * 10) / 10
  }

  // ── Diameter ──────────────────────────────────────────────────────────────
  const dCtx  = /(?:diametro|diam(?:etro)?|dbh)\s*[:=]?\s*(\d+(?:\.\d+)?)/
  const dUnit = /(\d+(?:\.\d+)?)\s*c(?:enti)?m(?:etri?)?(?!\w)/
  m = t.match(dCtx) || t.match(dUnit)
  if (m) { result.diameter = parseFloat(m[1]); t = t.replace(m[0], ' ') }

  // Relative diameter: "X cm in più", "diametro cresciuto di X"
  if (result.diameter === null && refD !== null) {
    const rel = t.match(/(\d+(?:\.\d+)?)\s*cm\s+in\s+più/i)
             || t.match(/(?:diametro\s+)?(?:aumentat[ao]|cresciut[ao])\s+di\s+(\d+(?:\.\d+)?)\s*cm/i)
             || t.match(/(?:diametro\s+)?in\s+più\s+(?:di\s+)?(\d+(?:\.\d+)?)\s*cm/i)
    if (rel) result.diameter = Math.round((refD + parseFloat(rel[1])) * 10) / 10
  }

  // ── Health ────────────────────────────────────────────────────────────────
  const healthCtx = /(?:salute|stato|health)\s*[:=]?\s*([1-5])/
  m = t.match(healthCtx) || t.match(/\b([1-5])\b/)
  if (m) {
    result.health = parseInt(m[1])
  } else {
    const healthWords = [
      [5, /\b(ottim[ao]|ottimale|eccellente|perfett[ao])\b/],
      [4, /\b(buon[ao]|bene|discret[ao]|sano|sana)\b/],
      [3, /\b(medi[ao]|nella norma|accettabile|suffi\w+)\b/],
      [2, /\b(scarso|scarsa|cattiv[ao]|bas\w+|debole|malat[ao])\b/],
      [1, /\b(pessim[ao]|morente|mort[ao]|critic[ao]|gravissim[ao])\b/],
    ]
    for (const [val, re] of healthWords) {
      if (re.test(t)) { result.health = val; break }
    }
  }

  return result
}


function applyMeasurement(action) {
  const h = Number(action.height_m)
  const d = Number(action.diameter_cm)
  const s = Number(action.health)

  if (h < 0.1 || h > 100) {
    store.addChatMessage('assistant', `⚠ Altezza ${h}m fuori range (0.1–100m). Correggi e riprova.`)
    return
  }
  if (d < 0.5 || d > 500) {
    store.addChatMessage('assistant', `⚠ DBH ${d}cm fuori range (0.5–500cm). Correggi e riprova.`)
    return
  }
  if (s < 1 || s > 5 || !Number.isInteger(s)) {
    store.addChatMessage('assistant', `⚠ Salute ${s} non valida (deve essere 1–5). Correggi e riprova.`)
    return
  }

  // Regression check — trees don't shrink
  const prev = measureTree.value
  const prevH = prev?.measured_height_m   ?? prev?.height_m   ?? null
  const prevD = prev?.measured_diameter_cm ?? prev?.diameter_cm ?? null
  if (prevH !== null && h < prevH) {
    store.addChatMessage('assistant', `⚠ Altezza ${h}m inferiore al valore precedente (${prevH}m). Correggi l'altezza e riprova.`)
    parsed.height = null  // only clear height, keep diameter/health for LLM context
    return
  }
  if (prevD !== null && d < prevD) {
    store.addChatMessage('assistant', `⚠ DBH ${d}cm inferiore al valore precedente (${prevD}cm). Correggi il diametro e riprova.`)
    parsed.diameter = null  // only clear diameter
    return
  }

  // Update preview
  parsed.height   = h
  parsed.diameter = d
  parsed.health   = s

  const id = measureTree.value?.id
  if (!id) return

  store.updateMeasurement(id, { height_m: h, diameter_cm: d, health: s })
  store.addChatMessage('assistant',
    `✅ **${id}** salvato: H=${h}m · DBH=${d}cm · Salute=${s}/5`)
  store.setSelectedTree(null)
}

async function sendMeasurementToLLM() {
  const lastUserText = store.chatMessages.filter(m => m.role === 'user').slice(-1)[0]?.content ?? ''

  // ── Step 1: always accumulate parsed state from this message ─────────────
  // This runs regardless of LLM success/failure so state stays consistent.
  const tree = measureTree.value
  if (SAME_RE.test(lastUserText)) {
    if (tree?.measured_at) {
      // Previous field measurement → re-save immediately, no LLM needed
      applyMeasurement({ action: 'save_measurement', height_m: tree.measured_height_m, diameter_cm: tree.measured_diameter_cm, health: tree.measured_health })
      return
    }
    // Seed from shapefile reference if not already set
    if (parsed.height   === null && tree?.height_m   != null) parsed.height   = tree.height_m
    if (parsed.diameter === null && tree?.diameter_cm != null) parsed.diameter = tree.diameter_cm
  } else {
    const refH = tree?.measured_height_m   ?? tree?.height_m   ?? null
    const refD = tree?.measured_diameter_cm ?? tree?.diameter_cm ?? null
    const pv = parseValues(lastUserText, refH, refD)
    if (pv.height   !== null) parsed.height   = pv.height
    if (pv.diameter !== null) parsed.diameter = pv.diameter
    if (pv.health   !== null) parsed.health   = pv.health
  }

  // ── Step 2: if all 3 accumulated, save immediately ───────────────────────
  if (parsed.height !== null && parsed.diameter !== null && parsed.health !== null) {
    applyMeasurement({ action: 'save_measurement', height_m: parsed.height, diameter_cm: parsed.diameter, health: parsed.health })
    return
  }

  // ── Step 3: LLM returns structured JSON {height_m, diameter_cm, health, message} ─
  if (!isReady() || store.llmStatus === 'error') {
    handleMeasurementFallback(lastUserText)
    return
  }

  const systemMsg = { role: 'system', content: buildMeasurementPrompt(tree) }
  const historyForLLM = store.chatMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content }))

  try {
    const result = await parseMeasurementJSON([systemMsg, ...historyForLLM])
    if (!result) throw new Error('empty')

    // Show the LLM's message
    store.addChatMessage('assistant', result.message ?? '')
    nextTick(scrollToBottom)

    // Merge values
    if (result.height_m    != null) parsed.height   = result.height_m
    if (result.diameter_cm != null) parsed.diameter = result.diameter_cm
    if (result.health      != null) parsed.health   = result.health

    // Save if all 3 now accumulated
    if (parsed.height !== null && parsed.diameter !== null && parsed.health !== null) {
      applyMeasurement({ action: 'save_measurement', height_m: parsed.height, diameter_cm: parsed.diameter, health: parsed.health })
    }
  } catch (err) {
    console.error('[LLM] parseMeasurementJSON error:', err)
    handleMeasurementFallback(lastUserText)
  }
  nextTick(scrollToBottom)
}

const SAME_RE = /\b(stess[eo]|ugual[ei]|come prima|di prima|invariat[eo]|identic[aho]|same|unchanged|conferm[ao])\b/i

// Regex fallback (used when LLM isn't ready or fails)
function handleMeasurementFallback(text) {
  // "Same as before" — re-apply last field measurement, or fall back to shapefile reference
  if (SAME_RE.test(text)) {
    const tree = measureTree.value
    if (tree?.measured_at) {
      // Has previous field measurement — re-save same values
      applyMeasurement({ action: 'save_measurement', height_m: tree.measured_height_m, diameter_cm: tree.measured_diameter_cm, health: tree.measured_health })
    } else if (tree?.height_m != null && tree?.diameter_cm != null) {
      // No field measurement yet — seed from shapefile reference, ask for health
      parsed.height   = tree.height_m
      parsed.diameter = tree.diameter_cm
      store.addChatMessage('assistant',
        `Uso i valori di riferimento: H=${tree.height_m}m · DBH=${tree.diameter_cm}cm.\nChe salute dai all'albero? (1 = morente, 5 = ottimo)`)
    } else {
      store.addChatMessage('assistant', 'Nessuna rilevazione precedente. Dimmi le misure.')
    }
    return
  }

  // "sì/si/yes/ok" when only health is still missing → treat as confirmation to proceed
  const CONFIRM_RE = /^\s*(s[iì]|yes|ok|okay|va bene|certo|esatto|confermo)\s*$/i
  if (CONFIRM_RE.test(text) && parsed.height !== null && parsed.diameter !== null && parsed.health === null) {
    store.addChatMessage('assistant', 'Dimmi la salute dell\'albero (1 = morente, 5 = ottimo).')
    return
  }

  // Merge new values into existing state — don't overwrite already-seeded values
  const _tree = measureTree.value
  const _refH = _tree?.measured_height_m   ?? _tree?.height_m   ?? null
  const _refD = _tree?.measured_diameter_cm ?? _tree?.diameter_cm ?? null
  const pv = parseValues(text, _refH, _refD)
  if (pv.height   !== null) parsed.height   = pv.height
  if (pv.diameter !== null) parsed.diameter = pv.diameter
  if (pv.health   !== null) parsed.health   = pv.health

  const missing = []
  if (parsed.height   === null) missing.push('altezza (m)')
  if (parsed.diameter === null) missing.push('DBH (cm)')
  if (parsed.health   === null) missing.push('salute (1–5)')

  // If exactly one value is still missing and the user gave a bare number, use it
  if (missing.length === 1) {
    const bare = text.match(/\b(\d+(?:\.\d+)?)\b/)
    if (bare) {
      const n = parseFloat(bare[1])
      if (missing[0].startsWith('altezza'))  parsed.height   = n
      if (missing[0].startsWith('DBH'))      parsed.diameter = n
      if (missing[0].startsWith('salute'))   parsed.health   = Math.round(n)
      missing.length = 0
    }
  }

  if (missing.length === 3) {
    store.addChatMessage('assistant',
      `Non ho capito le misure. Prova: _"15m, 32cm, salute 4"_`)
    return
  }

  if (missing.length === 0) {
    applyMeasurement({ action: 'save_measurement', height_m: parsed.height, diameter_cm: parsed.diameter, health: parsed.health })
    return
  }

  store.addChatMessage('assistant', `Manca ancora: ${missing.join(', ')}`)
}

// ── General chat ──────────────────────────────────────────────────────────────
const visibleMessages = computed(() =>
  store.chatMessages.filter((m) => m.role === 'user' || m.role === 'assistant')
)

function togglePanel() {
  isOpen.value = !isOpen.value
  if (isOpen.value) nextTick(scrollToBottom)
}

function scrollToBottom() {
  if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
}

function autoResizeTextarea() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 100) + 'px'
}

function formatMessage(content) {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

async function sendMessage() {
  const text = userInput.value.trim()
  if (!text) return

  store.addChatMessage('user', text)
  userInput.value = ''
  if (inputRef.value) inputRef.value.style.height = 'auto'
  nextTick(scrollToBottom)

  if (measureTree.value) {
    await sendMeasurementToLLM()
    return
  }

  // General LLM chat
  if (!isReady() || isStreaming.value) return
  await sendToLLM()
}

async function sendToLLM() {
  isStreaming.value = true

  const systemMsg    = { role: 'system', content: buildSystemPrompt() }
  const historyForLLM = store.chatMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))

  const messages = [systemMsg, ...historyForLLM]
  let fullResponse = ''

  try {
    const gen = chatWithTrees(messages)
    store.addChatMessage('assistant', '')
    const lastIdx = store.chatMessages.length - 1

    for await (const chunk of gen) {
      fullResponse += chunk
      store.chatMessages[lastIdx].content = fullResponse
      nextTick(scrollToBottom)
    }
  } catch (err) {
    console.error('[LLM] Stream error:', err)
    if (!fullResponse) store.addChatMessage('assistant', 'Errore nella risposta. Riprova.')
  } finally {
    isStreaming.value = false
    nextTick(scrollToBottom)
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const pos    = store.userPosition
  const center = store.plotCenter

  let unmeasuredSorted = store.trees.filter((t) => t.measured_at === null)
  if (pos) {
    unmeasuredSorted = unmeasuredSorted
      .map((t) => ({ ...t, _dist: haversineDistance(pos, { lat: t.lat, lon: t.lon }) }))
      .sort((a, b) => a._dist - b._dist)
      .slice(0, 15)
      .map((t) => {
        const dir = cardinalDirection(compassBearing(pos, { lat: t.lat, lon: t.lon }))
        return `  - ${t.id} (${t.species.toUpperCase()}) ${t._dist.toFixed(1)}m ${dir}`
      })
  } else {
    unmeasuredSorted = unmeasuredSorted.slice(0, 15)
      .map((t) => `  - ${t.id} (${t.species.toUpperCase()})`)
  }

  return `Sei un assistente per rilievi forestali sul campo.
Particella: ${store.plotName}${center ? `, centro ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}` : ''}.
Avanzamento: ${store.measuredCount}/${store.trees.length} alberi misurati.

Per misurare un albero: toccalo sulla mappa 3D, poi digli altezza (m), diametro/DBH (cm) e salute (1–5).

ALBERI DA MISURARE (più vicini prima):
${unmeasuredSorted.join('\n') || '  Tutti gli alberi misurati — ottimo lavoro!'}

Rispondi in italiano, in modo conciso. Indica quale albero visitare dopo (ID, specie, distanza, direzione).`
}

// ── LLM init ──────────────────────────────────────────────────────────────────
async function initModel() {
  store.llmStatus      = 'loading'
  store.llmProgress    = 0
  store.llmProgressMsg = 'Connessione a Gemini...'
  try {
    await initLLM(({ progress, text }) => {
      store.llmProgress    = progress
      store.llmProgressMsg = text
    })
    store.llmStatus   = 'ready'
    store.llmProgress = 1
    await sendInitialGreeting()
  } catch (err) {
    console.error('[Gemini] Init error:', err)
    store.llmStatus   = 'error'
    llmErrorMsg.value = err?.message ?? String(err)
  }
}

async function retryInit() {
  store.llmStatus = 'idle'
  await initModel()
}

async function sendInitialGreeting() {
  if (isStreaming.value) return
  isStreaming.value = true

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user',   content: 'Ciao, sono pronto per iniziare i rilievi.' },
  ]

  let fullResponse = ''
  try {
    for await (const chunk of chatWithTrees(messages)) fullResponse += chunk
    store.addChatMessage('assistant', fullResponse)
  } catch {
    store.addChatMessage('assistant',
      'Benvenuto! Tocca un albero sulla mappa 3D per iniziare la misurazione.')
  } finally {
    isStreaming.value = false
    nextTick(scrollToBottom)
  }
}

// Auto-message when measurement saved
watch(() => store.measuredCount, async (newCount, oldCount) => {
  if (newCount <= oldCount || !isReady() || isStreaming.value || measureTree.value) return

  const total  = store.trees.length
  const prompt = newCount === total
    ? `All ${total} trees measured! Congratulations.`
    : `Tree measured! Progress: ${newCount}/${total}. What should I measure next?`

  store.addChatMessage('user', prompt)
  nextTick(scrollToBottom)
  await sendToLLM()
})

onMounted(() => { initModel() })
</script>

<style scoped>
.chat-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-top: 1px solid var(--border);
  position: relative;
  z-index: 20;
  max-height: 60dvh;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.chat-panel:not(.open) { max-height: 42px; }

.chat-handle {
  height: 42px;
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
}

.handle-bar {
  width: 32px;
  height: 3px;
  background: var(--dim);
  border-radius: 2px;
}

.handle-title {
  flex: 1;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--cyan);
  text-transform: uppercase;
}

.handle-close-btn {
  border: none;
  color: var(--dim);
  font-size: 14px;
  padding: 4px 6px;
  letter-spacing: 0;
  min-width: 28px;
  text-align: center;
}

/* ── Measurement banner ── */
.measure-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(0, 229, 255, 0.06);
  border-bottom: 1px solid rgba(0, 229, 255, 0.25);
  flex-shrink: 0;
}

.measure-icon { font-size: 22px; line-height: 1; }

.measure-tree-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.measure-tree-id {
  font-size: 16px;
  font-weight: bold;
  color: var(--cyan);
  letter-spacing: 2px;
}

.measure-tree-sp {
  font-size: 10px;
  color: var(--dim);
  letter-spacing: 2px;
}

.measure-ref {
  font-size: 11px;
  color: var(--dim);
  letter-spacing: 0.5px;
}

.measure-banner-actions {
  display: flex;
  gap: 6px;
}

.form-btn, .exit-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  letter-spacing: 0;
  text-transform: none;
  border-color: var(--dim);
  color: var(--dim);
}

.form-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.exit-btn:hover { border-color: #ff4444; color: #ff4444; }

/* ── Parsed preview ── */
.measure-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.pv-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--dim);
  border-radius: 2px;
  min-width: 58px;
  opacity: 0.5;
  transition: opacity 0.2s, border-color 0.2s;
}

.pv-field.filled {
  opacity: 1;
  border-color: var(--teal);
}

.pv-label {
  font-size: 9px;
  color: var(--dim);
  letter-spacing: 1px;
  text-transform: uppercase;
}

.pv-val {
  font-size: 14px;
  color: var(--text);
  font-weight: bold;
  letter-spacing: 0.5px;
}

.pv-field.filled .pv-val { color: var(--teal); }

.save-btn {
  margin-left: auto;
  padding: 6px 14px;
  border-color: var(--teal);
  color: var(--teal);
  font-size: 12px;
  letter-spacing: 1px;
  animation: glow-pulse 1.5s ease-in-out infinite;
}

/* ── Messages ── */
.chat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.msg-bubble {
  max-width: 88%;
  padding: 8px 12px;
  border-radius: 2px;
  font-size: 13px;
  line-height: 1.5;
}

.msg-bubble.user {
  align-self: flex-end;
  background: rgba(0, 229, 255, 0.08);
  border-left: 2px solid var(--cyan);
  color: var(--text);
}

.msg-bubble.assistant {
  align-self: flex-start;
  background: rgba(0, 20, 30, 0.8);
  border-left: 2px solid var(--teal);
  color: var(--text);
}

.msg-bubble.streaming { opacity: 0.7; }

.stream-cursor {
  animation: pulse-opacity 0.7s ease-in-out infinite;
  color: var(--cyan);
}

.msg-content :deep(strong) { color: var(--cyan); }
.msg-content :deep(em) { color: var(--dim); font-style: normal; }

/* ── LLM loading ── */
.llm-loading {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--border);
}

.progress-bar-track {
  width: 100%;
  height: 3px;
  background: var(--dim);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--cyan), var(--teal));
  border-radius: 2px;
  transition: width 0.3s ease;
}

.loading-msg {
  font-size: 10px;
  color: var(--dim);
  text-align: center;
  animation: pulse-opacity 1.5s ease-in-out infinite;
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.llm-error {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
}

/* ── Input ── */
.chat-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  resize: none;
  min-height: 36px;
  max-height: 100px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.4;
  padding: 8px 10px;
}

.send-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  letter-spacing: 0;
  text-transform: none;
}
</style>
