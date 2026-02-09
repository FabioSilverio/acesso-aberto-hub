import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

type WaybackSnapshot = {
  available: boolean
  status?: string
  timestamp?: string
  url?: string
}

type WaybackResponse = {
  archived_snapshots?: {
    closest?: WaybackSnapshot
  }
}

type ResourceLink = {
  title: string
  description: string
  href: string
}

const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i

function normalizeUrl(rawUrl: string): string {
  const value = rawUrl.trim()
  if (!value) {
    throw new Error('Informe uma URL para continuar.')
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const parsed = new URL(withProtocol)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Use uma URL HTTP/HTTPS válida.')
  }

  return parsed.toString()
}

function extractDoi(text: string): string | null {
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    decoded = text
  }

  const match = decoded.match(DOI_REGEX)
  return match?.[0] ?? null
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function extractTitleHint(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const lastPart = parts[parts.length - 1] ?? parsed.hostname
    const decoded = decodeURIComponent(lastPart)
    const cleaned = decoded
      .replace(/\.[a-z0-9]{2,8}$/i, '')
      .replace(/\d{2,}/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return cleaned || parsed.hostname
  } catch {
    return ''
  }
}

function toWaybackNoToolbar(snapshotUrl: string): string {
  const timestampMatch = snapshotUrl.match(/\/web\/(\d+)\//)
  if (!timestampMatch) {
    return snapshotUrl
  }

  const timestamp = timestampMatch[1]
  return snapshotUrl.replace(`/web/${timestamp}/`, `/web/${timestamp}id_/`)
}

function formatSnapshotDate(timestamp: string): string {
  const year = timestamp.slice(0, 4)
  const month = timestamp.slice(4, 6)
  const day = timestamp.slice(6, 8)
  const hour = timestamp.slice(8, 10)
  const minute = timestamp.slice(10, 12)

  return `${day}/${month}/${year} ${hour}:${minute}`
}

function buildResourceLinks(url: string, doi: string | null, titleHint: string, host: string): ResourceLink[] {
  const query = titleHint || url

  const links: ResourceLink[] = [
    {
      title: 'Wayback Machine (timeline)',
      description: 'Veja versões históricas públicas da página no Internet Archive.',
      href: `https://web.archive.org/web/*/${encodeURIComponent(url)}`,
    },
    {
      title: 'Archive.org (busca geral)',
      description: 'Procure cópias públicas e itens relacionados pelo título da página.',
      href: `https://archive.org/search?query=${encodeURIComponent(query)}`,
    },
    {
      title: 'Google Scholar',
      description: 'Busque versões acadêmicas, citações e manuscritos relacionados.',
      href: `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`,
    },
    {
      title: 'OpenAlex (busca por obra)',
      description: 'Encontre metadados e links para versões abertas quando existirem.',
      href: `https://openalex.org/works?search=${encodeURIComponent(query)}`,
    },
    {
      title: 'Semantic Scholar',
      description: 'Outra base para localizar versões de trabalho, preprints e citações.',
      href: `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}`,
    },
    {
      title: 'BASE (Open Access)',
      description: 'Metabuscador de repositórios institucionais e periódicos abertos.',
      href: `https://www.base-search.net/Search/Results?lookfor=${encodeURIComponent(query)}&type=all&oaboost=1`,
    },
    {
      title: 'CORE',
      description: 'Repositório de artigos em acesso aberto do mundo todo.',
      href: `https://core.ac.uk/search?q=${encodeURIComponent(query)}`,
    },
    {
      title: 'DOAJ',
      description: 'Base de periódicos e artigos open access.',
      href: `https://doaj.org/search/articles/${encodeURIComponent(query)}`,
    },
    {
      title: 'Zenodo',
      description: 'Repositório aberto para preprints, datasets e publicações.',
      href: `https://zenodo.org/search?page=1&size=20&q=${encodeURIComponent(query)}`,
    },
  ]

  if (host) {
    links.push({
      title: `Busca aberta em ${host}`,
      description: 'Ajuda a localizar páginas do mesmo domínio marcadas como free/open.',
      href: `https://www.google.com/search?q=${encodeURIComponent(`site:${host} "${query}" ("open access" OR "free article" OR pdf)`)}`,
    })
  }

  if (doi) {
    links.unshift({
      title: 'DOI / Publisher',
      description: 'URL canônica via DOI (pode oferecer opções de acesso aberto).',
      href: `https://doi.org/${doi}`,
    })

    links.push({
      title: 'OpenAlex (por DOI)',
      description: 'Metadados e possíveis links para versões acessíveis.',
      href: `https://openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
    })

    links.push({
      title: 'Crossref (por DOI)',
      description: 'Metadados oficiais da publicação para encontrar versões relacionadas.',
      href: `https://search.crossref.org/?q=${encodeURIComponent(doi)}`,
    })
  }

  return links
}

function App() {
  const [input, setInput] = useState('')
  const [submittedUrl, setSubmittedUrl] = useState('')
  const [snapshot, setSnapshot] = useState<WaybackSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState('')
  const [validationError, setValidationError] = useState('')
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)

  const doi = useMemo(() => extractDoi(submittedUrl), [submittedUrl])
  const host = useMemo(() => extractHost(submittedUrl), [submittedUrl])
  const titleHint = useMemo(() => extractTitleHint(submittedUrl), [submittedUrl])
  const links = useMemo(() => {
    if (!submittedUrl) {
      return []
    }
    return buildResourceLinks(submittedUrl, doi, titleHint, host)
  }, [submittedUrl, doi, titleHint, host])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setValidationError('')
    setSnapshotError('')
    setSnapshot(null)

    try {
      const normalized = normalizeUrl(input)
      setSubmittedUrl(normalized)
      setLoadingSnapshot(true)

      const response = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(normalized)}`)
      if (!response.ok) {
        throw new Error('Falha ao consultar o Internet Archive.')
      }

      const data = (await response.json()) as WaybackResponse
      setSnapshot(data.archived_snapshots?.closest ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado.'
      if (message.includes('URL')) {
        setValidationError(message)
      } else {
        setSnapshotError(message)
      }
    } finally {
      setLoadingSnapshot(false)
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="kicker">Acesso aberto, sem atalhos ilegais</p>
        <h1>Portal de alternativas legais para leitura online</h1>
        <p className="subtitle">
          Cole o link de um artigo e receba caminhos públicos: snapshots arquivados, buscadores acadêmicos e
          repositórios open access.
        </p>

        <form className="search" onSubmit={handleSubmit}>
          <label htmlFor="article-url" className="sr-only">
            URL do artigo
          </label>
          <input
            id="article-url"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="https://exemplo.com/artigo"
            autoComplete="off"
          />
          <button type="submit" disabled={loadingSnapshot}>
            {loadingSnapshot ? 'Buscando...' : 'Encontrar alternativas'}
          </button>
        </form>

        {validationError && <p className="error">{validationError}</p>}

        <div className="examples">
          <span>Exemplos:</span>
          <code>nature.com/... </code>
          <code>doi.org/10.xxxx/xxxx</code>
        </div>
      </section>

      {submittedUrl && (
        <section className="results" aria-live="polite">
          <article className="panel">
            <h2>URL analisada</h2>
            <a href={submittedUrl} target="_blank" rel="noreferrer">
              {submittedUrl}
            </a>
            {host && <p>Domínio: {host}</p>}
            {titleHint && <p>Título sugerido: {titleHint}</p>}
            {doi && <p>DOI detectado: {doi}</p>}
          </article>

          <article className="panel">
            <h2>Snapshot no Internet Archive</h2>
            {!loadingSnapshot && snapshot?.available && snapshot.url && snapshot.timestamp && (
              <p>
                Encontrado em {formatSnapshotDate(snapshot.timestamp)}.{' '}
                <a href={snapshot.url} target="_blank" rel="noreferrer">
                  Abrir snapshot
                </a>
              </p>
            )}
            {!loadingSnapshot && snapshot?.available && snapshot.url && (
              <p>
                Se o clique travar no overlay, tente a variante{' '}
                <a href={toWaybackNoToolbar(snapshot.url)} target="_blank" rel="noreferrer">
                  sem barra da Wayback
                </a>
                .
              </p>
            )}
            {!loadingSnapshot && !snapshot?.available && !snapshotError && (
              <p>Nenhum snapshot próximo encontrado. Use a timeline para explorar outras datas.</p>
            )}
            {snapshotError && <p className="error">{snapshotError}</p>}
          </article>

          <article className="panel">
            <h2>Quando abrir bloqueio de cookies no snapshot</h2>
            <ol className="tip-list">
              <li>Tente outra captura na timeline. Algumas datas carregam sem o mesmo bloqueio.</li>
              <li>Use a versão sem barra da Wayback para evitar conflito de clique com overlays.</li>
              <li>Busque o mesmo título/DOI em repositórios de acesso aberto abaixo.</li>
            </ol>
            <div className="quick-links">
              <a href={`https://web.archive.org/web/*/${encodeURIComponent(submittedUrl)}`} target="_blank" rel="noreferrer">
                Explorar outras datas
              </a>
              {snapshot?.url && (
                <a href={toWaybackNoToolbar(snapshot.url)} target="_blank" rel="noreferrer">
                  Abrir sem barra Wayback
                </a>
              )}
            </div>
          </article>

          <article className="panel">
            <h2>Fontes públicas recomendadas</h2>
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.title}
                  </a>
                  <p>{link.description}</p>
                </li>
              ))}
            </ul>
          </article>
        </section>
      )}

      <footer>
        <p>
          Este projeto não contorna paywalls. Ele só aponta para fontes públicas, arquivos históricos e acesso aberto.
        </p>
      </footer>
    </main>
  )
}

export default App
