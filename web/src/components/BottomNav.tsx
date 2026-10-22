import { href, type Route } from '../router';
import { Icon, type IconName } from './Icon';

const TABS: { page: Route['page']; label: string; icon: IconName }[] = [
  { page: 'today', label: '오늘', icon: 'today' },
  { page: 'medicines', label: '약', icon: 'medicines' },
  { page: 'prescriptions', label: '조제', icon: 'prescriptions' },
  { page: 'analysis', label: '분석', icon: 'analysis' },
  { page: 'more', label: '더보기', icon: 'more' },
];

/** Sub-pages that highlight their parent tab. */
const PARENT: Partial<Record<Route['page'], Route['page']>> = {
  slots: 'more',
  symptoms: 'more',
  'record-settings': 'more',
  medicine: 'medicines',
  schedule: 'medicines',
  prescription: 'prescriptions',
};

export function BottomNav({ route }: { route: Route }) {
  const active = PARENT[route.page] ?? route.page;
  return (
    <nav class="bottom-nav" aria-label="주요 메뉴">
      {TABS.map((tab) => (
        <a
          key={tab.page}
          href={href({ page: tab.page } as Route)}
          class={tab.page === active ? 'active' : undefined}
          aria-current={tab.page === active ? 'page' : undefined}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}
