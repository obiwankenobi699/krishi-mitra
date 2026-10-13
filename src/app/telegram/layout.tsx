import type * as React from 'react';
import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('Telegram Crop Assistant', 'Link your Krishi Mitra account and analyze crops from the Telegram camera flow.', '/telegram');

export default function TelegramLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
