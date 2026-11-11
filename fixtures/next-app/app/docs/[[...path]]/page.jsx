export async function generateMetadata({ params }) {
  const { path = [] } = await params;
  const name = path.length === 0 ? 'Documentation' : path.join(' / ');
  return { title: `${name} | Fixture Co docs`, description: `Documentation page "${name}" of the fixture site.` };
}

export default async function DocsPage({ params }) {
  const { path = [] } = await params;
  return (
    <main>
      <h1>{path.length === 0 ? 'Documentation' : path.join(' / ')}</h1>
      <p>
        Every address under /docs is answered by this one file, through an optional catch-all segment. The page
        shows which part of the documentation was asked for and links to one page below it.
      </p>
      {path.length === 0 ? <a href="/docs/getting-started">Getting started</a> : <a href="/docs">Back to the documentation</a>}
    </main>
  );
}
