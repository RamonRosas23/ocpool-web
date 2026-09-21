import type { Metadata } from 'next';
import StaffProjectWorkspacePanel from '@/components/StaffProjectWorkspacePanel';

export const metadata: Metadata = {
  title: 'Proyecto | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ id: string }> };

export default async function StaffProjectPage({ params }: PageProps) {
  const { id } = await params;
  return <StaffProjectWorkspacePanel projectId={id} />;
}
