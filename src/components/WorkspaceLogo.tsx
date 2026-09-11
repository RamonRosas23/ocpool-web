import Image from 'next/image';

type WorkspaceLogoProps = {
  tone?: 'dark' | 'light';
  className?: string;
};

export default function WorkspaceLogo({ tone = 'dark', className = '' }: WorkspaceLogoProps) {
  const source = tone === 'light' ? '/brand/ocpool-logo-white.png' : '/brand/ocpool-logo.png';
  return <Image className={`workspace-logo workspace-logo--${tone} ${className}`.trim()} src={source} alt="OCPOOL" width={1448} height={1086} />;
}
