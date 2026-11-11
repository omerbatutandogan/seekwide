import Link from 'next/link';

export default function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link> <Link href="/about">About</Link> <Link href="/pricing">Pricing</Link>{' '}
      <Link href="/blog">Blog</Link> <Link href="/docs">Docs</Link> <a href="/legacy.html">Legacy page</a>
    </nav>
  );
}
