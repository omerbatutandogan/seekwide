import Link from 'next/link';

export const metadata = {
  title: 'Blog: notes from Fixture Co',
  description: 'The list of posts on the fixture site, with one link that leads nowhere.',
};

export default function BlogIndex() {
  return (
    <main>
      <h1>Blog</h1>
      <ul>
        <li><Link href="/blog/first-post">The first post</Link></li>
        <li><Link href="/blog/second-post">The second post</Link></li>
        <li><a href="/blog/missing-post">A post that was deleted</a></li>
      </ul>
    </main>
  );
}
