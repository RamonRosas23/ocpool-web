import type { Metadata } from 'next';
import EmployeeLoginPanel from '@/components/EmployeeLoginPanel';

export const metadata: Metadata = {
  title: 'Acceso interno | OCPOOL',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <EmployeeLoginPanel />;
}

