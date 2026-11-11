// Deliberate problems: the same title as /about, and no h1.
export const metadata = {
  title: 'Fixture Co',
  description: 'Plans and prices of a company that does not exist. This page has no main heading.',
};

export default function PricingPage() {
  return (
    <main>
      <h2>Plans</h2>
      <p>
        There are three plans, and none of them can be bought. The page has a second-level heading and no
        first-level heading, which is one of the problems an audit should report for it.
      </p>
    </main>
  );
}
