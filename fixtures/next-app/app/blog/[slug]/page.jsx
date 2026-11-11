import { notFound } from 'next/navigation';

const POSTS = {
  'first-post': {
    title: 'The first post',
    body: 'This post has a title that is made when the page is requested, so it can only be seen in the page the server sends. Reading this file does not tell an audit what the title is, and that is the reason the audit looks at the served page and uses the file only to say where a fix belongs.',
  },
  'second-post': { title: 'The second post', body: 'A very short post.' },
};

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = POSTS[slug];
  if (!post) return {};
  return {
    title: `${post.title} | Fixture Co blog`,
    description: `${post.title}: a post on the fixture site, with a description made at request time.`,
    alternates: { canonical: `/blog/${slug}` },
  };
}

export default async function BlogPost({ params }) {
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
