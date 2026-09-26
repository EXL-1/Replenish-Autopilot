import type { ReactNode } from 'react';
import { Montserrat } from 'next/font/google';
import './panel.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
});

export const metadata = { title: 'Replenish Autopilot' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className={montserrat.className}>{children}</body>
    </html>
  );
}
