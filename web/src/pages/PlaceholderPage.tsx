import { PageHeader } from '../components/PageHeader';

export function PlaceholderPage({ title, stage, description }: { title: string; stage: number; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <section class="placeholder">
        <p class="badge">{stage}단계에서 추가 예정</p>
        <p>{description}</p>
      </section>
    </>
  );
}
