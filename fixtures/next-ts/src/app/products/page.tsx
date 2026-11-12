import Link from 'next/link';
import { PRODUCTS } from '@/lib/products';

// Deliberate problem: no metadata of its own (same title and description as
// /about) and no canonical link.
export default function ProductsPage() {
  return (
    <main>
      <h1>Products</h1>
      <p>
        Two widgets make up the whole range. Each has a page of its own, made from the same template by a dynamic
        route, with a title that comes from the product's name when the page is requested.
      </p>
      <ul>
        {PRODUCTS.map((product) => (
          <li key={product.id}>
            <Link href={`/products/${product.id}`}>{product.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
