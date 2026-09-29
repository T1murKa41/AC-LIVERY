import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { filteredCars, useStore } from '../state/store'

export function CarList() {
  const { t } = useTranslation()
  const cars = useStore((s) => s.cars)
  const status = useStore((s) => s.carsStatus)
  const filter = useStore((s) => s.carFilter)
  const setFilter = useStore((s) => s.setCarFilter)
  const selectCar = useStore((s) => s.selectCar)
  const selected = useStore((s) => s.car?.id)
  const visible = useMemo(() => filteredCars(cars, filter), [cars, filter])

  return (
    <aside className="car-list">
      <div className="search">
        <input
          type="search"
          placeholder={t('cars.search')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t('cars.search')}
        />
      </div>
      <div className="car-items">
        {status === 'loading' && <p className="muted pad">{t('cars.loading')}</p>}
        {status === 'ready' && visible.length === 0 && (
          <p className="muted pad">{t('cars.empty')}</p>
        )}
        {visible.map((car) => (
          <button
            key={car.id}
            className={`car-item ${car.id === selected ? 'selected' : ''}`}
            onClick={() => void selectCar(car.id)}
            title={car.id}
          >
            <span className="car-name">{car.name}</span>
            <span className="car-meta">
              {car.brand && <span>{car.brand}</span>}
              <span>{t('cars.skins', { count: car.skinCount })}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
