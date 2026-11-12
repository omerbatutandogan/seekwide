import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Nav from '@/components/nav';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.example.com'),
  title: { default: 'Acme Fixture', template: '%s | Acme Fixture' },
  description: 'Acme Fixture makes widgets. This site is a test fixture with deliberate SEO problems.',
  openGraph: { title: 'Acme Fixture', images: ['/og.png'] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
