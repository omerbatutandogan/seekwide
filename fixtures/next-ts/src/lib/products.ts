export type Product = {
  id: string;
  name: string;
  summary: string;
};

export const PRODUCTS: Product[] = [
  {
    id: 'alpha',
    name: 'Alpha Widget',
    summary:
      'The Alpha Widget is the small one. It fits on a desk, runs on a single battery for a month and is the widget most people start with when they first try the range.',
  },
  {
    id: 'beta',
    name: 'Beta Widget',
    summary:
      'The Beta Widget is the large one. It is built for workshops, takes mains power and has twice the reach of the Alpha, which makes it the choice for teams that share one.',
  },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}
