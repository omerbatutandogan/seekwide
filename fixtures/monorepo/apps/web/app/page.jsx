export const metadata = {
  title: { absolute: 'Monorepo Fixture: a site in apps/web' },
  description: 'The home page of a Next.js site that lives in a subfolder of a monorepo.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <main>
      <h1>A site in a subfolder</h1>
      <p>
        This site is one workspace of a monorepo. Its source is in apps/web, its footer comes from packages/ui, and
        the repository root holds only the workspace settings. An audit run from the root has to be told where the
        site is, and every file it names has to be a path from the root.
      </p>
    </main>
  );
}
