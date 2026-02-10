import Link from "next/link";
import { redirect } from "next/navigation";
import { getDocsBrowserResult, type DocsSourceFilter } from "@/lib/docs-browser";
import { requireDbUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type SearchParams = {
  source?: string;
  q?: string;
  doc?: string;
};

export default async function DocsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  try {
    await requireDbUser();
  } catch {
    redirect("/signin");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const source = resolveSourceFilter(resolvedSearchParams?.source);
  const query = resolvedSearchParams?.q?.trim() ?? "";
  const selectedDocId = resolvedSearchParams?.doc;

  const data = await getDocsBrowserResult({
    source,
    query,
    selectedDocId,
  });

  return (
    <div className="docs-shell">
      <header className="docs-header panel">
        <div>
          <p className="eyebrow">Dataset Browser</p>
          <h1>Support + Dev Docs</h1>
          <p className="subtitle">
            This page shows the same chunk data used by retrieval from <code>{data.chunksPath}</code>.
          </p>
        </div>

        <div className="docs-header-actions">
          <Link href="/" className="ghost-link">
            Back To Chat
          </Link>
          {data.selectedDoc ? (
            <a href={data.selectedDoc.url} target="_blank" rel="noreferrer" className="ghost-link">
              Open Source Of Truth
            </a>
          ) : null}
        </div>
      </header>

      <section className="docs-filters panel">
        <form method="GET" className="docs-filter-grid">
          <label className="field-label" htmlFor="source">
            Source
          </label>
          <select id="source" name="source" defaultValue={source} className="field-input">
            <option value="all">All</option>
            <option value="support">Support Docs</option>
            <option value="dev">Dev Docs</option>
          </select>

          <label className="field-label" htmlFor="q">
            Search Title / URL / Section
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="e.g. API v3, rostering, oauth"
            className="field-input"
          />

          <button type="submit" className="primary-button docs-apply-button">
            Apply Filters
          </button>
        </form>

        <div className="docs-stat-row">
          <span>{data.filteredCount.toLocaleString()} docs in current view</span>
          <span>{data.totalDocCount.toLocaleString()} docs total</span>
          <span>{data.totalChunkCount.toLocaleString()} chunks total</span>
          <span>
            Support: {String(data.sourceDocCounts.support ?? 0)} docs / {String(data.sourceChunkCounts.support ?? 0)} chunks
          </span>
          <span>
            Dev: {String(data.sourceDocCounts.dev ?? 0)} docs / {String(data.sourceChunkCounts.dev ?? 0)} chunks
          </span>
        </div>
      </section>

      <main className="docs-workspace">
        <aside className="panel docs-list-panel">
          <h2>Documents</h2>
          {data.docs.length === 0 ? <p className="muted">No docs match this filter.</p> : null}

          <ul className="docs-list">
            {data.docs.map((doc) => {
              const isActive = data.selectedDoc?.docId === doc.docId;
              const href = buildDocHref({ source, query, docId: doc.docId });

              return (
                <li key={doc.docId} className={isActive ? "doc-item active" : "doc-item"}>
                  <a href={href} className="doc-item-link">
                    <span className="doc-item-title">{doc.title}</span>
                    <span className="doc-item-meta">
                      {doc.source} | {doc.chunkCount} chunks
                    </span>
                    <span className="doc-item-url">{doc.url}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="panel docs-detail-panel">
          {data.selectedDoc ? (
            <>
              <div className="docs-detail-header">
                <h2>{data.selectedDoc.title}</h2>
                <p className="muted">
                  {data.selectedDoc.sourceHost} | {data.selectedDoc.chunkCount} chunks | {data.selectedDoc.sectionCount} sections
                </p>
                <p className="docs-detail-links">
                  <a href={data.selectedDoc.url} target="_blank" rel="noreferrer">
                    {data.selectedDoc.url}
                  </a>
                </p>
              </div>

              <div className="chunk-list">
                {data.selectedDoc.chunks.map((chunk) => (
                  <article key={chunk.chunkId} className="chunk-card">
                    <div className="chunk-card-header">
                      <strong>{chunk.section ?? "(no section label)"}</strong>
                      <span>{chunk.chunkId}</span>
                    </div>
                    {chunk.headingPath.length > 0 ? <p className="chunk-heading-path">{chunk.headingPath.join(" > ")}</p> : null}
                    <pre>{chunk.text}</pre>
                  </article>
                ))}
              </div>
            </>
          ) : data.selectedDocMissing ? (
            <p className="muted">The requested doc is not in the current filtered view.</p>
          ) : (
            <p className="muted">Choose a document from the left panel.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function resolveSourceFilter(value: string | undefined): DocsSourceFilter {
  if (value === "support" || value === "dev") {
    return value;
  }
  return "all";
}

function buildDocHref(input: { source: DocsSourceFilter; query: string; docId: string }): string {
  const params = new URLSearchParams();
  if (input.source !== "all") {
    params.set("source", input.source);
  }
  if (input.query.trim()) {
    params.set("q", input.query);
  }
  params.set("doc", input.docId);
  return `/docs?${params.toString()}`;
}
