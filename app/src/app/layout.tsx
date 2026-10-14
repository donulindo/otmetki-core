import {PRODUCT_TITLE,PRODUCT_DESCRIPTION} from '@/lib/brand';
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import 'katex/dist/katex.min.css';

export const metadata: Metadata = {
  title: PRODUCT_TITLE,
  description: PRODUCT_DESCRIPTION,
  icons:{icon:'/mark.svg'},
  robots: {index: false, follow: false}
};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="ru" suppressHydrationWarning><body>{children}
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
  </body></html>;
}
