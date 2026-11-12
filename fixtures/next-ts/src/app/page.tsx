import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Acme Fixture: widgets for testing audits' },
  description: 'The home page of the Acme Fixture widget shop, a TypeScript test site for Seekwide.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <main>
      <h1>Widgets for testing audits</h1>
      <p>
        This site exists so that an audit has something to find. It is written in TypeScript, keeps its routes in
        src/app, and makes the metadata of its product and blog pages at request time with generateMetadata.
      </p>
      <p>
        The home page itself is in good shape: it has a title of its own, a meta description, a canonical link, one
        main heading and enough text to count as real content for the checks that measure the text on a page.
      </p>
    </main>
  );
}
