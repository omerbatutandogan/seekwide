import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type Props = { params: Promise<{ slug: string }> };

const POSTS: Record<string, { title: string; body: string }> = {
  'hello-widgets': {
    title: 'Hello, widgets',
    body: 'The first post on the blog. Its title, description and canonical link are made when the page is requested, so they exist only in the page the server sends. An audit reads that page and uses this file only to say where a fix would belong.',
  },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS[slug];
  if (!post) return {};
  return {
    title: post.title,
    description: `${post.title}: a post on the Acme Fixture blog, with metadata made at request time.`,
    alternates: { canonical: `/blog/${slug}` },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = POSTS[slug];
  if (!post) notFound();
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  );
}
