import type { ReactNode } from 'react';
import PrivateShellChrome from './PrivateShellChrome';
import { PrivateShellProvider } from './PrivateShellContext';
import type { PrivateNavigationItem } from './navigation';
import type { PrivateShellContext, PrivateShellSurface } from '@/server/private-shell';

type PrivateShellProps = {
  surface: PrivateShellSurface;
  context: PrivateShellContext;
  navigation: readonly PrivateNavigationItem[];
  children: ReactNode;
};

export default function PrivateShell({ surface, context, navigation, children }: PrivateShellProps) {
  return (
    <div className={`private-ui-scope private-shell private-shell--${surface}`}>
      <PrivateShellChrome surface={surface} user={context.user} roleLabel={context.roleLabel} navigation={navigation} />
      <PrivateShellProvider>
        <main id="contenido" className="private-shell__content" tabIndex={-1}>{children}</main>
      </PrivateShellProvider>
    </div>
  );
}
