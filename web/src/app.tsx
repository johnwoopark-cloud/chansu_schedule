import { useEffect } from 'preact/hooks';
import { db } from './db/database';
import { runAutoTaken } from './lib/autoTaken';
import { BottomNav } from './components/BottomNav';
import { useRoute } from './router';
import { TodayPage } from './pages/TodayPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { MorePage } from './pages/MorePage';
import { SlotsPage } from './pages/SlotsPage';
import { MedicinesPage } from './pages/MedicinesPage';
import { MedicineEditPage } from './pages/MedicineEditPage';
import { ScheduleEditPage } from './pages/ScheduleEditPage';
import { SymptomsPage } from './pages/SymptomsPage';
import { RecordSettingsPage } from './pages/RecordSettingsPage';
import { ToastHost } from './components/Toast';
import { PrescriptionsPage } from './pages/PrescriptionsPage';
import { MedicineCalendarPage } from './pages/MedicineCalendarPage';
import { PrescriptionEditPage } from './pages/PrescriptionEditPage';

export function App() {
  const route = useRoute();
  useEffect(() => {
    const run = () => runAutoTaken(db).catch((err) => console.error('auto-taken failed', err));
    run();
    const id = setInterval(run, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return (
    <div class="app">
      <main class="content">
        {route.page === 'today' && <TodayPage />}
        {route.page === 'medicines' && <MedicinesPage />}
        {route.page === 'medicine' && <MedicineEditPage key={route.id} id={route.id} />}
        {route.page === 'medicine-calendar' && <MedicineCalendarPage key={route.id} id={route.id} />}
        {route.page === 'schedule' && (
          <ScheduleEditPage key={`${route.medicineId}-${route.id}`} medicineId={route.medicineId} id={route.id} />
        )}
        {route.page === 'prescriptions' && <PrescriptionsPage />}
        {route.page === 'prescription' && <PrescriptionEditPage key={route.id} id={route.id} />}
        {route.page === 'analysis' && (
          <PlaceholderPage title="분석" stage={6} description="복용률 차트, 기록 표, 달력, 체내 농도 추정 그래프를 봅니다." />
        )}
        {route.page === 'more' && <MorePage />}
        {route.page === 'slots' && <SlotsPage />}
        {route.page === 'symptoms' && <SymptomsPage />}
        {route.page === 'record-settings' && <RecordSettingsPage />}
      </main>
      <ToastHost />
      <BottomNav route={route} />
    </div>
  );
}
