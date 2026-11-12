import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Posts about widgets and about testing audits, from the Acme Fixture team.',
  alternates: { canonical: '/blog' },
};

export default function BlogIndex() {
  return (
    <main>
      <h1>Blog</h1>
      <p>
        The blog shows a dynamic route whose metadata is complete: each post gets its own title, description and
        canonical link from generateMetadata. One link below points to a post that was deleted.
      </p>
      <ul>
        <li>
          <Link href="/blog/hello-widgets">Hello, widgets</Link>
        </li>
        <li>
          <Link href="/blog/deleted-post">A deleted post</Link>
        </li>
      </ul>
    </main>
  );
}
