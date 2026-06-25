import './globals.css'
import type { Metadata } from 'next'
import { BottomBar } from '@/components/BottomBar'
import { TopBar } from '@/components/TopBar'
import { PRODUCT_DESCRIPTION, PRODUCT_TITLE } from '@/lib/brand'
import { Providers } from '@/providers/Providers'

export const metadata: Metadata = {
  title: PRODUCT_TITLE,
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <TopBar />
        <div className="scanline" aria-hidden="true" />
        <Providers>{children}</Providers>
        <BottomBar />
      </body>
    </html>
  )
}
