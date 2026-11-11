export const metadata = {
  title: 'Fixture Co: tools for testing audits',
  description: 'The home page of the fixture site. It has a title, a description and one main heading.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <main>
      <h1>Tools for testing audits</h1>
      <p>
        This site exists so that an audit has something to find. Each page has a known set of problems, and the
        audit is expected to report exactly those and to name the file each one comes from.
      </p>
      <p>
        The home page itself is in good shape: it has a title of its own, a meta description, one main heading
        and enough text to count as real content for the checks that look at the amount of text on a page.
      </p>
    </main>
  );
}
