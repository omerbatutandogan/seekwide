// Deliberate problems: no description of its own (the layout's is used) and
// no canonical link.
export const metadata = {
  title: 'Pricing',
};

export default function PricingPage() {
  return (
    <main>
      <h1>Pricing</h1>
      <p>
        There is one plan and it is free. The page sets a title of its own but no description, so it shows the
        description of the layout, and it has no canonical link. The footer below links to a page that does not
        exist; that link lives in packages/ui, outside the web app's own folder.
      </p>
    </main>
  );
}
