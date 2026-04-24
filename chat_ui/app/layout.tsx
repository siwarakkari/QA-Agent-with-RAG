import './globals.css'
import { ReactNode } from 'react'

export const metadata = { title: 'WWII RAG Chat', description: 'AI-powered WWII knowledge base' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}