import Image from 'next/image';
import Link from 'next/link';

type WorkspaceBrandProps = {
  className: 'auth-brand' | 'client-brand' | 'staff-brand';
  subtitle: string;
  href?: string;
  ariaLabel?: string;
};

export default function WorkspaceBrand({ className, subtitle, href = '/', ariaLabel = 'OCPOOL, volver al sitio público' }: WorkspaceBrandProps) {
  return (
    <Link className={`${className} workspace-brand`} href={href} aria-label={ariaLabel}>
      <Image className="workspace-brand__logo" src="/brand/ocpool-logo-white.png" alt="OCPOOL" width={1448} height={1086} priority />
      <small>{subtitle}</small>
    </Link>
  );
}
