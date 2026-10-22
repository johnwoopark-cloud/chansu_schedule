import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

export function PageHeader({ title, back, children }: { title: string; back?: string; children?: ComponentChildren }) {
  return (
    <header class="page-header">
      {back && (
        <a class="icon-button" href={back} aria-label="뒤로">
          <Icon name="back" />
        </a>
      )}
      <h1>{title}</h1>
      {children && <div class="page-header-actions">{children}</div>}
    </header>
  );
}
