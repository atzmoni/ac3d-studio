import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AC3D Studio — Parametric Fold Systems',
  description: 'Parametric architectural folding patterns for digital fabrication.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
