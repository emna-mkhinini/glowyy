import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'

const SUGGESTIONS = [
  { label: 'Routine pour peau grasse à imperfections', text: "J'ai la peau grasse avec des boutons et des points noirs. Tu peux me proposer une routine ?" },
  { label: 'Rétinol et vitamine C ensemble ?', text: 'Est-ce que je peux utiliser le rétinol et la vitamine C dans la même routine ?' },
  { label: "C'est quoi la niacinamide ?", text: "C'est quoi la niacinamide et est-ce que c'est adapté à ma peau mixte ?" },
  { label: 'Analyser ma peau en photo', photo: true },
]

const TOOL_LABELS = {
  build_skincare_routine: 'Routine personnalisée',
  get_ingredient_info: 'Fiche ingrédient',
  check_ingredient_compatibility: 'Compatibilité vérifiée',
  check_warning_signs: 'Signes d’alerte vérifiés',
}

// Resize to max 1024 px and re-encode as JPEG to keep the request light.
function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL('image/jpeg', 0.85)
      URL.revokeObjectURL(img.src)
      resolve({ url, mimeType: 'image/jpeg', data: url.split(',')[1] })
    }
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = URL.createObjectURL(file)
  })
}

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="logo-mark">
      <path d="M12 3c-3 4.3-5.5 7-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 10 15 7.3 12 3z" />
    </svg>
  )
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [image, setImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  async function onPickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setImage(await readImage(file))
      inputRef.current?.focus()
    } catch {
      setError('Impossible de lire cette image.')
    }
  }

  async function send(textArg) {
    const text = (textArg ?? input).trim()
    if ((!text && !image) || loading) return
    const history = messages.map((m) => ({ role: m.role, text: m.image ? `${m.text} [photo jointe]`.trim() : m.text }))
    const userMsg = { role: 'user', text, image: image?.url }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setError('')
    const sentImage = image
    setImage(null)
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          image: sentImage ? { mimeType: sentImage.mimeType, data: sentImage.data } : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Erreur du serveur')
      setMessages((m) => [...m, { role: 'assistant', text: data.reply, tools: data.toolsUsed ?? [] }])
    } catch (err) {
      setError(err.message || 'Connexion impossible au serveur.')
    } finally {
      setLoading(false)
    }
  }

  function onSuggestion(s) {
    if (s.photo) fileRef.current?.click()
    else send(s.text)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const empty = messages.length === 0

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <DropIcon />
          <div>
            <h1>Bechra</h1>
            <p>Ton assistante skincare IA</p>
          </div>
        </div>
        {!empty && (
          <button className="ghost" onClick={() => { setMessages([]); setError('') }}>
            Nouvelle discussion
          </button>
        )}
      </header>

      <main className="chat" aria-live="polite">
        {empty ? (
          <section className="welcome">
            <h2>Parlons de ta peau.</h2>
            <p>
              Pose une question sur un ingrédient, demande une routine adaptée à ton type de peau,
              ou envoie une photo pour une première observation.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.label} className="chip" onClick={() => onSuggestion(s)}>
                  {s.label}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <ul className="messages">
            {messages.map((m, i) => (
              <li key={i} className={`msg ${m.role}`}>
                {m.image && <img src={m.image} alt="Photo envoyée" className="msg-photo" />}
                {m.text && (m.role === 'assistant'
                  ? <div className="md"><Markdown>{m.text}</Markdown></div>
                  : <p>{m.text}</p>)}
                {m.tools?.length > 0 && (
                  <div className="tools">
                    {[...new Set(m.tools.map((t) => t.name))].map((name) => (
                      <span key={name} className="tool">{TOOL_LABELS[name] ?? name}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {loading && (
              <li className="msg assistant typing" aria-label="Bechra écrit">
                <span /><span /><span />
              </li>
            )}
          </ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div ref={endRef} />
      </main>

      <footer className="composer-wrap">
        {image && (
          <div className="preview">
            <img src={image.url} alt="Aperçu de la photo" />
            <span>Photo prête à être envoyée</span>
            <button className="ghost small" onClick={() => setImage(null)} aria-label="Retirer la photo">Retirer</button>
          </div>
        )}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPickFile} />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Joindre une photo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          </button>
          <label htmlFor="msg" className="sr-only">Ton message</label>
          <textarea
            id="msg"
            ref={inputRef}
            rows={1}
            value={input}
            placeholder="Écris ta question…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="send" disabled={loading || (!input.trim() && !image)} aria-label="Envoyer">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </form>
        <p className="disclaimer">
          Bechra donne des conseils généraux et ne remplace pas un dermatologue. Les photos sont envoyées à Gemini pour l’analyse et ne sont pas enregistrées.
        </p>
      </footer>
    </div>
  )
}
