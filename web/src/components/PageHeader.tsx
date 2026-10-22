import type { ComponentChildren } from 'preact';
import { goBackTo, type Route } from '../router';
import { Icon } from './Icon';

export function PageHeader({ title, back, children }: { title: string; back?: Route; children?: ComponentChildren }) {
  return (
    <header class="page-header">
      {back && (
        <button type="button" class="icon-button" aria-label="뒤로" onClick={() => goBackTo(back)}>
          <Icon name="back" />
        </button>
      )}
      <h1>{title}</h1>
      {children && <div class="page-header-actions">{children}</div>}
    </header>
  );
}
