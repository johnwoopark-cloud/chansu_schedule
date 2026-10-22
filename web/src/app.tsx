import { BottomNav } from './components/BottomNav';
import { useRoute } from './router';
import { TodayPage } from './pages/TodayPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { MorePage } from './pages/MorePage';
import { SlotsPage } from './pages/SlotsPage';
import { MedicinesPage } from './pages/MedicinesPage';
import { MedicineEditPage } from './pages/MedicineEditPage';
import { ScheduleEditPage } from './pages/ScheduleEditPage';

export function App() {
  const route = useRoute();
  return (
    <div class="app">
      <main class="content">
        {route.page === 'today' && <TodayPage />}
        {route.page === 'medicines' && <MedicinesPage />}
        {route.page === 'medicine' && <MedicineEditPage key={route.id} id={route.id} />}
        {route.page === 'schedule' && (
          <ScheduleEditPage key={`${route.medicineId}-${route.id}`} medicineId={route.medicineId} id={route.id} />
        )}
        {route.page === 'prescriptions' && (
          <PlaceholderPage title="조제" stage={4} description="약을 받아 온 날짜, 병원·약국, 처방 일수와 약봉투 수를 기록합니다." />
        )}
        {route.page === 'analysis' && (
          <PlaceholderPage title="분석" stage={6} description="복용률 차트, 기록 표, 달력, 체내 농도 추정 그래프를 봅니다." />
        )}
        {route.page === 'more' && <MorePage />}
        {route.page === 'slots' && <SlotsPage />}
      </main>
      <BottomNav route={route} />
    </div>
  );
}
