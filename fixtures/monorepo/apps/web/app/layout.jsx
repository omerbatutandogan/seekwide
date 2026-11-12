import { Footer } from '@seekwide-fixture/ui';

export const metadata = {
  metadataBase: new URL('https://www.example.org'),
  title: { default: 'Monorepo Fixture', template: '%s | Monorepo Fixture' },
  description: 'A site that lives in apps/web of a monorepo, used to test Seekwide.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/docs/install">Install</a>{' '}
          <a href="/docs/configure">Configure</a>
        </nav>
        {children}
        <Footer />
      </body>
    </html>
  );
}
