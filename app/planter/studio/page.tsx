import type { Metadata } from 'next';
import StudioWorkspace from '@/components/garden/StudioWorkspace';
// The garden sheet carries the light studio theme and the RTL corrections; this
// page adds the application chrome on top of it.
import '../garden.css';
import './studio-app.css';

export const metadata: Metadata = {
  title: 'סטודיו העריכה — DXF.TLV',
  description: 'עריכת אדניות ON-LINE: מידות, גאומטריה, גוון וחומר, עם בדיקת ייצור חיה וייצוא SVG / DXF בקנה מידה 1:1.',
};

export default function StudioPage() {
  return <StudioWorkspace />;
}
