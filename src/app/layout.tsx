import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ritnave · Separa voz e instrumental', description: 'Separa tu audio en una pista de voz y otra instrumental.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
