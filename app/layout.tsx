import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// The stylesheet has always referenced --font-inter / --font-jetbrains; until now
// nothing defined them, so every measurement fell back to a different system face.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'DXF.AC3D Studio - Parametric Fold Systems',
  description: 'Parametric architectural folding patterns for digital fabrication.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
