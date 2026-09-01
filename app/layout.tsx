import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://loveca-card-list.pages.dev'),
  title: 'ラブカ 全カードリスト',
  description: 'ラブライブ！オフィシャルカードゲームのメンバーカード・ライブカードを横断検索できる非公式カードリスト。',
  openGraph: {
    title: 'ラブカ 全カードリスト',
    description: 'グループを横断して探せる、メンバー＋ライブカードの共通データベース。',
    type: 'website',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'ラブカ 全カードリスト' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ラブカ 全カードリスト',
    description: 'グループを横断して探せる、メンバー＋ライブカードの共通データベース。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
