export const metadata = {
  title: 'ACQ Advisor',
  description: 'Cloud-only ACQ-style Advisor'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.puter.com/puter.js"></script>
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}