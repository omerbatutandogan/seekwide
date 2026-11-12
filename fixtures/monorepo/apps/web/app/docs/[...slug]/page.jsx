import { notFound } from 'next/navigation';

const DOCS = {
  install: 'Install the packages with npm install at the repository root. The workspaces are linked together, so the web app finds the UI package without a release.',
  configure: 'There is nothing to configure. The page exists so that a catch-all route has more than one address to answer.',
};

// Deliberate problem: every docs page gets the same title and no description
// of its own, because generateMetadata ignores the route's params.
export async function generateMetadata() {
  return { title: 'Docs' };
}

export default async function DocsPage({ params }) {
  const { slug } = await params;
  const text = DOCS[slug.join('/')];
  if (!text) notFound();
  return (
    <main>
      <h1>{slug.join(' / ')}</h1>
      <p>{text}</p>
      <p>
        Both docs pages are answered by this one file. Their title is the same because the metadata does not use
        the address, which an audit reports as a duplicate title on two pages that share one source file.
      </p>
    </main>
  );
}
