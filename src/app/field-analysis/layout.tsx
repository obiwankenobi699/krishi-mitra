import type * as React from 'react';
import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('Field Analysis', 'Upload one field photo: detect zones, then get a per-zone crop plan — grow this, consider that, or leave it fallow.', '/field-analysis');

export default function FieldAnalysisLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
