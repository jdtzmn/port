export const metadata = {
  title: 'Port Directory',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0f0f0f;
            color: #fff;
            font-family: system-ui, -apple-system, sans-serif;
            min-height: 100vh;
          }
        `}</style>
        {children}
      </body>
    </html>
  )
}
