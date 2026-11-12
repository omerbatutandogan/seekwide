import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findProduct } from '@/lib/products';

type Props = { params: Promise<{ id: string }> };

// Deliberate problems: the title is made per product, but there is no
// description (the layout's default is used on every product) and no
// canonical link.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = findProduct(id);
  if (!product) return {};
  return { title: product.name };
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  const product = findProduct(id);
  if (!product) notFound();
  return (
    <main>
      <h1>{product.name}</h1>
      <p>{product.summary}</p>
      <p>
        Every product page is answered by the same file. A fixed title or description in that file would repeat on
        every product, so a fix belongs in generateMetadata, built from the product the page shows.
      </p>
    </main>
  );
}
