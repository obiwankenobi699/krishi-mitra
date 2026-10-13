import type * as React from 'react';
import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('Crop Doctor', 'Turn a leaf or field photo into a clear, structured crop health assessment.', '/crop-doctor');

export default function CropDoctorLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
