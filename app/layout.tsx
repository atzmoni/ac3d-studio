import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Rubik, Secular_One } from 'next/font/google';
import './globals.css';

// The stylesheet has always referenced --font-inter / --font-jetbrains; until now
// nothing defined them, so every measurement fell back to a different system face.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains', display: 'swap' });
// Inter carries no Hebrew, so the Hebrew storefront on /planter needs its own
// pair. Rubik is a geometric grotesque whose Hebrew was drawn alongside its
// Latin rather than bolted on, and its softened corners sit well against a
// faceted metal product. Secular One is display-only — one weight, wide
// apertures, built to be set large — and carries the oversized headlines the
// template's layout depends on without the muddiness a text face gets at
// 100px. Neither is the Heebo/Assistant default every Hebrew site reaches for.
const rubik = Rubik({ subsets: ['hebrew', 'latin'], weight: ['300', '400', '500', '600', '700'], variable: '--font-rubik', display: 'swap' });
const secular = Secular_One({ subsets: ['hebrew', 'latin'], weight: ['400'], variable: '--font-secular', display: 'swap' });

export const metadata: Metadata = {
  title: 'DXF.AC3D Studio - Parametric Fold Systems',
  description: 'Parametric architectural folding patterns for digital fabrication.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} ${rubik.variable} ${secular.variable}`}>
      <body>{children}</body>
    </html>
  );
}
