import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

type WaybackSnapshot = {
  available: boolean
  timestamp?: string
  url?: string
}

type WaybackResponse = {
  archived_snapshots?: {
    closest?: WaybackSnapshot
  }
}

type OpenAlexLocation = {
  pdf_url?: string | null
  landing_page_url?: string | null
}

type OpenAlexWork = {
  id: string
  display_name: string
  publication_year?: number
  open_access?: {
    oa_url?: string | null
    oa_status?: string | null
  }
  locations?: OpenAlexLocation[]
}

type OpenAlexResponse = {
  results?: OpenAlexWork[]
}

type DoajResponse = {
  total?: number
}

type CrossrefSearchResponse = {
  message?: {
    items?: Array<{
      DOI?: string
      title?: string[]
    }>
  }
}

type SemanticScholarPaper = {
  title?: string
  url?: string
  openAccessPdf?: {
    url?: string
  }
}

type SemanticScholarResponse = {
  data?: SemanticScholarPaper[]
}

type CheckStatus = 'working' | 'not_working' | 'unknown'

type CheckLink = {
  label: string
  href: string
}

type CheckResult = {
  id: string
  title: string
  status: CheckStatus
  summary: string
  links: CheckLink[]
}

type CheckContext = {
  url: string
  doi: string | null
  titleHint: string
  host: string
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
    throw new Error('Use uma URL HTTP/HTTPS valida.')
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

function toWaybackIframe(snapshotUrl: string): string {
  const timestampMatch = snapshotUrl.match(/\/web\/(\d+)\//)
  if (!timestampMatch) {
    return snapshotUrl
  }

  const timestamp = timestampMatch[1]
  return snapshotUrl.replace(`/web/${timestamp}/`, `/web/${timestamp}if_/`)
}

function formatSnapshotDate(timestamp: string): string {
  const year = timestamp.slice(0, 4)
  const month = timestamp.slice(4, 6)
  const day = timestamp.slice(6, 8)
  const hour = timestamp.slice(8, 10)
  const minute = timestamp.slice(10, 12)

  return `${day}/${month}/${year} ${hour}:${minute}`
}

function normalizeDoi(doi: string): string {
  return doi.toLowerCase().trim()
}

function pickOpenAccessUrl(work: OpenAlexWork): string | null {
  if (work.open_access?.oa_url) {
    return work.open_access.oa_url
  }

  if (!work.locations) {
    return null
  }

  for (const location of work.locations) {
    if (location.pdf_url) {
      return location.pdf_url
    }
    if (location.landing_page_url) {
      return location.landing_page_url
    }
  }

  return null
}

async function checkWaybackClosest(context: CheckContext): Promise<CheckResult> {
  const title = 'Wayback snapshot'

  try {
    const response = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(context.url)}`)
    if (!response.ok) {
      return {
        id: 'wayback-closest',
        title,
        status: 'not_working',
        summary: 'API do Internet Archive nao respondeu com sucesso.',
        links: [{ label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` }],
      }
    }

    const data = (await response.json()) as WaybackResponse
    const snapshot = data.archived_snapshots?.closest
    if (!snapshot?.available || !snapshot.url) {
      return {
        id: 'wayback-closest',
        title,
        status: 'not_working',
        summary: 'Sem snapshot proximo retornado pela API.',
        links: [{ label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` }],
      }
    }

    const dateText = snapshot.timestamp ? formatSnapshotDate(snapshot.timestamp) : 'data indisponivel'
    return {
      id: 'wayback-closest',
      title,
      status: 'working',
      summary: `Snapshot encontrado em ${dateText}.`,
      links: [
        { label: 'Abrir snapshot', href: snapshot.url },
        { label: 'Modo sem barra', href: toWaybackNoToolbar(snapshot.url) },
        { label: 'Modo iframe', href: toWaybackIframe(snapshot.url) },
        { label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` },
      ],
    }
  } catch {
    return {
      id: 'wayback-closest',
      title,
      status: 'not_working',
      summary: 'Falha de rede ao consultar Wayback.',
      links: [{ label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` }],
    }
  }
}

async function checkWaybackCdx(context: CheckContext): Promise<CheckResult> {
  const title = 'Wayback capturas'

  try {
    const endpoint = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(context.url)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=5`
    const response = await fetch(endpoint)

    if (!response.ok) {
      return {
        id: 'wayback-cdx',
        title,
        status: 'not_working',
        summary: 'Busca de capturas via CDX nao retornou sucesso.',
        links: [{ label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` }],
      }
    }

    const rows = (await response.json()) as string[][]
    if (!rows || rows.length <= 1) {
      return {
        id: 'wayback-cdx',
        title,
        status: 'not_working',
        summary: 'Nenhuma captura 200 encontrada no CDX para esta URL.',
        links: [{ label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` }],
      }
    }

    const topLinks = rows.slice(1, 4).map((row) => {
      const timestamp = row[0]
      return {
        label: `Captura ${timestamp}`,
        href: `https://web.archive.org/web/${timestamp}/${context.url}`,
      }
    })

    return {
      id: 'wayback-cdx',
      title,
      status: 'working',
      summary: `${rows.length - 1} captura(s) encontradas na consulta CDX (amostra).`,
      links: topLinks,
    }
  } catch {
    return {
      id: 'wayback-cdx',
      title,
      status: 'not_working',
      summary: 'Falha de rede ao consultar capturas CDX.',
      links: [{ label: 'Timeline Wayback', href: `https://web.archive.org/web/*/${encodeURIComponent(context.url)}` }],
    }
  }
}

async function checkOpenAlex(context: CheckContext): Promise<CheckResult> {
  const title = 'OpenAlex'

  try {
    let endpoint = `https://api.openalex.org/works?search=${encodeURIComponent(context.titleHint || context.url)}&filter=is_oa:true&per-page=6`
    if (context.doi) {
      endpoint = `https://api.openalex.org/works?filter=doi:${encodeURIComponent(normalizeDoi(context.doi))}&per-page=6`
    }

    const response = await fetch(endpoint)
    if (!response.ok) {
      return {
        id: 'openalex',
        title,
        status: 'not_working',
        summary: 'API OpenAlex nao retornou sucesso.',
        links: [{ label: 'Busca OpenAlex', href: `https://openalex.org/works?search=${encodeURIComponent(context.titleHint || context.url)}` }],
      }
    }

    const data = (await response.json()) as OpenAlexResponse
    const works = (data.results ?? []).filter((work) => Boolean(pickOpenAccessUrl(work))).slice(0, 3)

    if (!works.length) {
      return {
        id: 'openalex',
        title,
        status: 'not_working',
        summary: 'Nenhum link open access direto encontrado nesta consulta.',
        links: [{ label: 'Busca OpenAlex', href: `https://openalex.org/works?search=${encodeURIComponent(context.titleHint || context.url)}` }],
      }
    }

    return {
      id: 'openalex',
      title,
      status: 'working',
      summary: `${works.length} resultado(s) com URL aberta encontrada(s).`,
      links: works
        .map((work) => {
          const href = pickOpenAccessUrl(work)
          if (!href) {
            return null
          }

          const year = work.publication_year ? ` (${work.publication_year})` : ''
          return { label: `${work.display_name}${year}`, href }
        })
        .filter((item): item is CheckLink => Boolean(item)),
    }
  } catch {
    return {
      id: 'openalex',
      title,
      status: 'not_working',
      summary: 'Falha de rede ao consultar OpenAlex.',
      links: [{ label: 'Busca OpenAlex', href: `https://openalex.org/works?search=${encodeURIComponent(context.titleHint || context.url)}` }],
    }
  }
}

async function checkDoaj(context: CheckContext): Promise<CheckResult> {
  const title = 'DOAJ'
  const query = context.titleHint || context.host || context.url

  try {
    const endpoint = `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?page=1&pageSize=3`
    const response = await fetch(endpoint)

    if (!response.ok) {
      return {
        id: 'doaj',
        title,
        status: 'not_working',
        summary: 'API DOAJ nao retornou sucesso.',
        links: [{ label: 'Busca DOAJ', href: `https://doaj.org/search/articles/${encodeURIComponent(query)}` }],
      }
    }

    const data = (await response.json()) as DoajResponse
    const total = data.total ?? 0

    if (total <= 0) {
      return {
        id: 'doaj',
        title,
        status: 'not_working',
        summary: 'DOAJ nao retornou artigos para esta consulta.',
        links: [{ label: 'Busca DOAJ', href: `https://doaj.org/search/articles/${encodeURIComponent(query)}` }],
      }
    }

    return {
      id: 'doaj',
      title,
      status: 'working',
      summary: `DOAJ retornou ${total} resultado(s) para a consulta.`,
      links: [{ label: 'Abrir resultados DOAJ', href: `https://doaj.org/search/articles/${encodeURIComponent(query)}` }],
    }
  } catch {
    return {
      id: 'doaj',
      title,
      status: 'not_working',
      summary: 'Falha de rede ao consultar DOAJ.',
      links: [{ label: 'Busca DOAJ', href: `https://doaj.org/search/articles/${encodeURIComponent(query)}` }],
    }
  }
}

async function checkCrossref(context: CheckContext): Promise<CheckResult> {
  const title = 'Crossref'

  try {
    if (context.doi) {
      const endpoint = `https://api.crossref.org/works/${encodeURIComponent(context.doi)}`
      const response = await fetch(endpoint)

      if (!response.ok) {
        return {
          id: 'crossref',
          title,
          status: 'not_working',
          summary: 'Crossref nao confirmou metadado para o DOI informado.',
          links: [{ label: 'Busca Crossref', href: `https://search.crossref.org/?q=${encodeURIComponent(context.doi)}` }],
        }
      }

      return {
        id: 'crossref',
        title,
        status: 'working',
        summary: 'DOI confirmado no Crossref.',
        links: [
          { label: 'Abrir DOI', href: `https://doi.org/${context.doi}` },
          { label: 'Busca Crossref', href: `https://search.crossref.org/?q=${encodeURIComponent(context.doi)}` },
        ],
      }
    }

    const endpoint = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(context.titleHint || context.url)}&rows=3`
    const response = await fetch(endpoint)

    if (!response.ok) {
      return {
        id: 'crossref',
        title,
        status: 'not_working',
        summary: 'Busca Crossref nao retornou sucesso.',
        links: [{ label: 'Busca Crossref', href: `https://search.crossref.org/?q=${encodeURIComponent(context.titleHint || context.url)}` }],
      }
    }

    const data = (await response.json()) as CrossrefSearchResponse
    const count = data.message?.items?.length ?? 0

    if (!count) {
      return {
        id: 'crossref',
        title,
        status: 'not_working',
        summary: 'Crossref nao retornou itens para este titulo.',
        links: [{ label: 'Busca Crossref', href: `https://search.crossref.org/?q=${encodeURIComponent(context.titleHint || context.url)}` }],
      }
    }

    return {
      id: 'crossref',
      title,
      status: 'working',
      summary: `Crossref retornou ${count} item(ns) para o titulo.`,
      links: [{ label: 'Abrir busca Crossref', href: `https://search.crossref.org/?q=${encodeURIComponent(context.titleHint || context.url)}` }],
    }
  } catch {
    return {
      id: 'crossref',
      title,
      status: 'not_working',
      summary: 'Falha de rede ao consultar Crossref.',
      links: [{ label: 'Busca Crossref', href: `https://search.crossref.org/?q=${encodeURIComponent(context.titleHint || context.url)}` }],
    }
  }
}

async function checkSemanticScholar(context: CheckContext): Promise<CheckResult> {
  const title = 'Semantic Scholar'

  try {
    const query = context.titleHint || context.url
    const endpoint = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=3&fields=title,url,openAccessPdf`
    const response = await fetch(endpoint)

    if (!response.ok) {
      return {
        id: 'semantic-scholar',
        title,
        status: 'not_working',
        summary: 'API Semantic Scholar nao retornou sucesso.',
        links: [{ label: 'Busca Semantic Scholar', href: `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}` }],
      }
    }

    const data = (await response.json()) as SemanticScholarResponse
    const papers = (data.data ?? []).slice(0, 3)
    if (!papers.length) {
      return {
        id: 'semantic-scholar',
        title,
        status: 'not_working',
        summary: 'Semantic Scholar nao retornou resultados para esta consulta.',
        links: [{ label: 'Busca Semantic Scholar', href: `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}` }],
      }
    }

    const links: CheckLink[] = []
    for (const paper of papers) {
      const href = paper.openAccessPdf?.url || paper.url
      if (href) {
        links.push({ label: paper.title || 'Resultado', href })
      }
    }

    return {
      id: 'semantic-scholar',
      title,
      status: links.length ? 'working' : 'not_working',
      summary: links.length
        ? `${links.length} link(s) encontrado(s) no Semantic Scholar.`
        : 'Resultados encontrados, mas sem URL aberta direta no payload.',
      links: links.length
        ? links
        : [{ label: 'Busca Semantic Scholar', href: `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}` }],
    }
  } catch {
    return {
      id: 'semantic-scholar',
      title,
      status: 'not_working',
      summary: 'Falha de rede ao consultar Semantic Scholar.',
      links: [{ label: 'Busca Semantic Scholar', href: `https://www.semanticscholar.org/search?q=${encodeURIComponent(context.titleHint || context.url)}` }],
    }
  }
}

async function checkArchiveToday(context: CheckContext): Promise<CheckResult> {
  const title = 'Archive.today / Archive.ph'
  const query = context.url
  const searchLink = `https://archive.ph/search/?q=${encodeURIComponent(query)}`
  const submitLink = `https://archive.ph/submit/?url=${encodeURIComponent(query)}`
  const directLookup = `https://archive.ph/${query}`
  const directLookupToday = `https://archive.today/${query}`

  try {
    const response = await fetch(searchLink)
    if (response.ok) {
      return {
        id: 'archive-today',
        title,
        status: 'working',
        summary: 'Consulta ao Archive.today respondeu com sucesso.',
        links: [
          { label: 'Buscar no archive.ph', href: searchLink },
          { label: 'Abrir lookup direto', href: directLookup },
          { label: 'Abrir em archive.today', href: directLookupToday },
          { label: 'Salvar snapshot agora', href: submitLink },
        ],
      }
    }

    return {
      id: 'archive-today',
      title,
      status: 'unknown',
      summary: 'Fonte adicionada, mas o navegador nao confirmou a consulta automaticamente.',
      links: [
        { label: 'Buscar no archive.ph', href: searchLink },
        { label: 'Abrir lookup direto', href: directLookup },
        { label: 'Abrir em archive.today', href: directLookupToday },
        { label: 'Salvar snapshot agora', href: submitLink },
      ],
    }
  } catch {
    return {
      id: 'archive-today',
      title,
      status: 'unknown',
      summary: 'Fonte adicionada; validacao automatica pode falhar por restricao de CORS.',
      links: [
        { label: 'Buscar no archive.ph', href: searchLink },
        { label: 'Abrir lookup direto', href: directLookup },
        { label: 'Abrir em archive.today', href: directLookupToday },
        { label: 'Salvar snapshot agora', href: submitLink },
      ],
    }
  }
}

function buildUnknownChecks(context: CheckContext): CheckResult[] {
  const query = context.titleHint || context.url

  return [
    {
      id: 'google-scholar-manual',
      title: 'Google Scholar (manual)',
      status: 'unknown',
      summary: 'Navegador nao permite validar automaticamente esta fonte sem interacao/captcha.',
      links: [{ label: 'Abrir Google Scholar', href: `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}` }],
    },
    {
      id: 'base-manual',
      title: 'BASE (manual)',
      status: 'unknown',
      summary: 'Fonte adicionada como fallback manual para ampliar cobertura open access.',
      links: [
        {
          label: 'Abrir BASE',
          href: `https://www.base-search.net/Search/Results?lookfor=${encodeURIComponent(query)}&type=all&oaboost=1`,
        },
      ],
    },
  ]
}

function App() {
  const [input, setInput] = useState('')
  const [submittedUrl, setSubmittedUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [results, setResults] = useState<CheckResult[]>([])

  const summary = useMemo(() => {
    const working = results.filter((result) => result.status === 'working').length
    const notWorking = results.filter((result) => result.status === 'not_working').length
    const unknown = results.filter((result) => result.status === 'unknown').length

    return { working, notWorking, unknown }
  }, [results])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setValidationError('')
    setResults([])

    try {
      const normalized = normalizeUrl(input)
      const context: CheckContext = {
        url: normalized,
        doi: extractDoi(normalized),
        titleHint: extractTitleHint(normalized),
        host: extractHost(normalized),
      }

      setSubmittedUrl(normalized)
      setLoading(true)

      const checks: Array<Promise<CheckResult>> = [
        checkWaybackClosest(context),
        checkWaybackCdx(context),
        checkOpenAlex(context),
        checkDoaj(context),
        checkCrossref(context),
        checkSemanticScholar(context),
        checkArchiveToday(context),
      ]

      const settled = await Promise.allSettled(checks)
      const asyncResults: CheckResult[] = settled.map((item, index) => {
        if (item.status === 'fulfilled') {
          return item.value
        }

        const fallbackTitles = [
          'Wayback snapshot',
          'Wayback capturas',
          'OpenAlex',
          'DOAJ',
          'Crossref',
          'Semantic Scholar',
          'Archive.today / Archive.ph',
        ]
        return {
          id: `check-${index}`,
          title: fallbackTitles[index] || `Fonte ${index + 1}`,
          status: 'not_working',
          summary: 'A verificacao falhou antes de retornar resultado.',
          links: [],
        }
      })

      const unknownChecks = buildUnknownChecks(context)
      setResults([...asyncResults, ...unknownChecks])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado.'
      setValidationError(message)
      setSubmittedUrl('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <section className="hero card">
        <p className="kicker">Acesso aberto</p>
        <h1>Verificacao paralela de fontes publicas</h1>
        <p className="subtitle">
          Envie uma URL e o sistema tenta todas as opcoes ao mesmo tempo (incluindo archive.ph/archive.today). O
          resultado mostra o que funcionou, nao funcionou ou ficou indefinido no navegador.
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
          <button type="submit" disabled={loading}>
            {loading ? 'Testando fontes...' : 'Enviar'}
          </button>
        </form>

        {validationError && <p className="error">{validationError}</p>}
      </section>

      {submittedUrl && (
        <section className="results" aria-live="polite">
          <article className="card">
            <h2>Resumo</h2>
            <p className="target-url">{submittedUrl}</p>
            <div className="summary-grid">
              <div className="summary-item ok">
                <span>{summary.working}</span>
                <p>funcionaram</p>
              </div>
              <div className="summary-item fail">
                <span>{summary.notWorking}</span>
                <p>nao funcionaram</p>
              </div>
              <div className="summary-item unknown">
                <span>{summary.unknown}</span>
                <p>indefinidas</p>
              </div>
            </div>
          </article>

          <article className="card">
            <h2>Resultado por fonte</h2>
            <ul className="result-list">
              {results.map((result) => (
                <li key={result.id} className="result-item">
                  <div className="result-head">
                    <h3>{result.title}</h3>
                    <span className={`badge ${result.status}`}>
                      {result.status === 'working' && 'funcionou'}
                      {result.status === 'not_working' && 'nao funcionou'}
                      {result.status === 'unknown' && 'indefinido'}
                    </span>
                  </div>
                  <p>{result.summary}</p>
                  {result.links.length > 0 && (
                    <div className="chip-list">
                      {result.links.map((link) => (
                        <a key={`${result.id}-${link.href}`} href={link.href} target="_blank" rel="noreferrer">
                          {link.label}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </article>
        </section>
      )}

      <footer>
        <p>O site testa fontes publicas e acesso aberto; nao executa bypass de paywall.</p>
      </footer>
    </main>
  )
}

export default App
