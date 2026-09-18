import type { Metadata } from 'next';
import GardenSite from '@/components/garden/GardenSite';
import './garden.css';

export const metadata: Metadata = {
  title: 'DXF.TLV — סטודיו לעיצוב אדניות גאומטריות',
  description:
    'מעצבים אדנית אונליין ומקבלים קובץ כרסום 1:1. אדניות מקופלות מלוח ACM / אלובונד אחד, '
    + 'עם חיתוך V ועיצוב מיקשה אחת — למעצבי פנים, אמנים, בעלי מלאכה ולקוחות פרטיים.',
};

export default function PlanterPage() {
  return <GardenSite />;
}
