const API_KEY  = import.meta.env.VITE_GEMINI_API_KEY
const MODEL    = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`

export function isReady() { return true }

export async function initLLM(onProgress) {
  onProgress?.({ progress: 1, text: 'Gemini pronto' })
}

export async function* chatWithTrees(messages) {
  const systemMsg = messages.find(m => m.role === 'system')
  const history   = messages.filter(m => m.role !== 'system' && m.content?.trim())

  // Gemini requires alternating user/model turns — merge consecutive same-role messages
  const contents = []
  for (const m of history) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    if (contents.length > 0 && contents.at(-1).role === role) {
      contents.at(-1).parts[0].text += '\n' + m.content
    } else {
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }

  // Gemini requires the conversation to start with a user turn — drop any leading model turns
  while (contents.length && contents[0].role !== 'user') contents.shift()
  if (!contents.length) return

  const body = {
    contents,
    ...(systemMsg && { systemInstruction: { parts: [{ text: systemMsg.content }] } }),
    generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
  }

  console.log('[Gemini] sending', contents.length, 'turns to', MODEL)

  const res = await fetch(`${ENDPOINT}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error('[Gemini] HTTP error', res.status, err.slice(0, 300))
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`)
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let chunks = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return
      try {
        const chunk = JSON.parse(raw)
        if (chunks === 0) console.log('[Gemini] first chunk keys:', Object.keys(chunk))
        // collect text from all parts (handles thinking + response parts in 2.5)
        const parts = chunk.candidates?.[0]?.content?.parts ?? []
        const text  = parts.map(p => p.text ?? '').join('')
        if (text) { chunks++; yield text }
      } catch { /* skip malformed SSE chunks */ }
    }
  }
  console.log('[Gemini] stream done,', chunks, 'chunks')
}

/**
 * Measurement parsing — always returns structured JSON:
 * { height_m, diameter_cm, health, message }
 */
export async function parseMeasurementJSON(messages) {
  const systemMsg = messages.find(m => m.role === 'system')
  const history   = messages.filter(m => m.role !== 'system' && m.content?.trim())

  const contents = []
  for (const m of history) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    if (contents.length && contents.at(-1).role === role) {
      contents.at(-1).parts[0].text += '\n' + m.content
    } else {
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }
  while (contents.length && contents[0].role !== 'user') contents.shift()
  if (!contents.length) return null

  const body = {
    contents,
    ...(systemMsg && { systemInstruction: { parts: [{ text: systemMsg.content }] } }),
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 200,
      responseMimeType: 'application/json',
    },
  }

  const res = await fetch(`${ENDPOINT}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error('[Gemini] parseMeasurementJSON error', res.status, err.slice(0, 200))
    throw new Error(`Gemini ${res.status}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return null
  return JSON.parse(text)
}

export async function clearModelCache() { /* no-op */ }
export async function disposeLLM()      { /* no-op */ }
