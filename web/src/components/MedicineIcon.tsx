import type { Medicine } from '../db/types';
import { MEDICINE_ICONS, type MedicineIcon as IconKey } from '../domain/medicine';
import { Icon } from './Icon';

export function MedicineIcon({ medicine, size = 40 }: { medicine: Pick<Medicine, 'icon' | 'color' | 'useColor'>; size?: number }) {
  const key: IconKey = (MEDICINE_ICONS as readonly string[]).includes(medicine.icon) ? (medicine.icon as IconKey) : 'tablet';
  const style = medicine.useColor ? { background: medicine.color, color: '#fff' } : undefined;
  return (
    <span class="medicine-icon" style={{ width: size, height: size, ...style }} aria-hidden="true">
      <Icon name={`med-${key}`} size={Math.round(size * 0.55)} />
    </span>
  );
}
