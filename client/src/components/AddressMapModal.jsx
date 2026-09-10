import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Navigation, Search, Maximize2, Minimize2 } from 'lucide-react';

export default function AddressMapModal({
  isOpen,
  onClose,
  onSelect,
  initialAddress = '',
  initialLatitude = '',
  initialLongitude = '',
  lang = 'ru'
}) {
  const [mapAddress, setMapAddress] = useState(initialAddress);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCoords, setSelectedCoords] = useState(null);
  const [isLoadingGeolocation, setIsLoadingGeolocation] = useState(false);
  const [geolocated, setGeolocated] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const mapInstanceRef = useRef(null);
  const markerInstanceRef = useRef(null);

  // Вызываем invalidateSize при изменении полноэкранного режима, чтобы Leaflet правильно пересчитал размеры контейнера
  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        try {
          mapInstanceRef.current.invalidateSize();
        } catch (e) {
          console.error(e);
        }
      }, 150);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (isOpen) {
      setMapAddress(initialAddress);
      setSearchQuery('');
      setSelectedCoords(
        initialLatitude && initialLongitude
          ? [parseFloat(initialLatitude), parseFloat(initialLongitude)]
          : null
      );
      setGeolocated(false);
    }
  }, [isOpen, initialAddress, initialLatitude, initialLongitude]);

  const selectLocationAndClose = async (lat, lng) => {
    setIsLoadingGeolocation(true);
    let address = '';
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=${lang}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          address = data.display_name;
        }
      }
    } catch (err) {
      console.error('OSM Nominatim geocoding error:', err);
    } finally {
      setIsLoadingGeolocation(false);
    }

    onSelect({
      address: address || `${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}`,
      latitude: parseFloat(lat).toFixed(6),
      longitude: parseFloat(lng).toFixed(6)
    });
    onClose();
  };

  const geocodeCoords = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=${lang}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          setMapAddress(data.display_name);
        }
      }
    } catch (err) {
      console.error('OSM Nominatim geocoding error:', err);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsLoadingGeolocation(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}&accept-language=${lang}`
      );
      setIsLoadingGeolocation(false);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const first = data[0];
          const lat = parseFloat(first.lat);
          const lon = parseFloat(first.lon);
          await selectLocationAndClose(lat, lon);
        } else {
          alert(lang === 'ru' ? 'Место не найдено' : 'Location not found');
        }
      }
    } catch (e) {
      setIsLoadingGeolocation(false);
      console.error('Search error:', e);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const initLeafletMap = () => {
      const container = document.getElementById('leaflet-map-select');
      if (!container) return;

      // Очищаем контейнер
      container.innerHTML = '';

      let lat = parseFloat(initialLatitude);
      let lng = parseFloat(initialLongitude);
      const hasInitialCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
      const defaultCenter = [41.7151, 44.8271]; // Тбилиси, Грузия
      const initialCenter = hasInitialCoords ? [lat, lng] : defaultCenter;

      try {
        if (!window.L) {
          console.error('Leaflet is not loaded');
          return;
        }

        // Создаем карту Leaflet с зумированием колесиком мыши (scrollWheelZoom: true)
        const map = window.L.map('leaflet-map-select', {
          center: initialCenter,
          zoom: 15,
          zoomControl: true,
          scrollWheelZoom: true,
          attributionControl: false
        });
        mapInstanceRef.current = map;

        // Язык для гугл-карт
        const googleLang = lang === 'ka' ? 'ka' : lang === 'az' ? 'az' : lang;

        // 1. Google Схема (яркая цветная с домами, улицами и номерами на нужном языке)
        const googleMap = window.L.tileLayer(
          `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=${googleLang}`, 
          { maxZoom: 20 }
        );

        // 2. Google Спутник (Гибрид с наложением улиц на нужном языке)
        const googleHybrid = window.L.tileLayer(
          `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=${googleLang}`,
          { maxZoom: 20 }
        );

        // 3. Альтернативная цветная схема CartoDB Voyager (работает по всему миру без блокировок)
        const voyagerMap = window.L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', 
          { maxZoom: 20 }
        );

        // 4. CartoDB Light (светлый минималистичный вариант)
        const cartoLight = window.L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', 
          { maxZoom: 20 }
        );

        // Устанавливаем по умолчанию сочную Google Схему, на которой прекрасно видны все дома, улицы и номера на языке пользователя
        googleMap.addTo(map);

        // Настройка переключателя слоев (Схема Google, Спутник Google, Схема Voyager, Светлая CartoDB)
        const baseMaps = {
          "Схема (Google)": googleMap,
          "Спутник (Google)": googleHybrid,
          "Схема (Voyager)": voyagerMap,
          "Светлая (Carto)": cartoLight
        };
        window.L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

        // Создаем маркер
        const marker = window.L.marker(initialCenter, {
          draggable: true
        }).addTo(map);
        markerInstanceRef.current = marker;

        // Если начальные координаты уже есть - геокодируем их
        if (hasInitialCoords) {
          setSelectedCoords(initialCenter);
          geocodeCoords(lat, lng);
        } else {
          // Иначе запрашиваем геологическое положение
          setIsLoadingGeolocation(true);
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                setIsLoadingGeolocation(false);
                setGeolocated(true);
                const userCenter = [position.coords.latitude, position.coords.longitude];
                map.setView(userCenter, 15);
                marker.setLatLng(userCenter);
                setSelectedCoords(userCenter);
                geocodeCoords(position.coords.latitude, position.coords.longitude);
              },
              () => {
                setIsLoadingGeolocation(false);
                setSelectedCoords(defaultCenter);
                geocodeCoords(defaultCenter[0], defaultCenter[1]);
              },
              { timeout: 6000, enableHighAccuracy: true }
            );
          } else {
            setIsLoadingGeolocation(false);
            setSelectedCoords(defaultCenter);
            geocodeCoords(defaultCenter[0], defaultCenter[1]);
          }
        }

        // Клик по карте
        map.on('click', (e) => {
          const { lat, lng } = e.latlng;
          marker.setLatLng([lat, lng]);
          setSelectedCoords([lat, lng]);
          selectLocationAndClose(lat, lng);
        });

        // Перетаскивание маркера
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          setSelectedCoords([lat, lng]);
          selectLocationAndClose(lat, lng);
        });

      } catch (err) {
        console.error('Error initializing Leaflet map:', err);
      }
    };

    if (window.L) {
      const timer = setTimeout(initLeafletMap, 150);
      return () => clearTimeout(timer);
    }

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // Игнорируем ошибки удаления
        }
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen, initialLatitude, initialLongitude, lang]);

  if (!isOpen) return null;

  const requestMyLocation = () => {
    if (navigator.geolocation && mapInstanceRef.current && markerInstanceRef.current) {
      setIsLoadingGeolocation(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setIsLoadingGeolocation(false);
          setGeolocated(true);
          const coords = [position.coords.latitude, position.coords.longitude];
          mapInstanceRef.current.setView(coords, 15);
          markerInstanceRef.current.setLatLng(coords);
          setSelectedCoords(coords);
          selectLocationAndClose(position.coords.latitude, position.coords.longitude);
        },
        () => {
          setIsLoadingGeolocation(false);
          alert(lang === 'ru' ? 'Не удалось определить ваше местоположение.' : 'Failed to determine your location.');
        },
        { enableHighAccuracy: true }
      );
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: isFullscreen ? 'center' : 'flex-start', justifyContent: 'center', zIndex: 2000, 
      padding: isFullscreen ? '0' : '40px 20px 20px 20px',
      overflowY: 'auto'
    }}>
      <div className="animate-scale-in" style={{
        background: 'white', 
        padding: isFullscreen ? '24px 32px' : '24px', 
        borderRadius: isFullscreen ? '0px' : '20px',
        width: '100%', 
        maxWidth: isFullscreen ? '100vw' : '640px', 
        height: isFullscreen ? '100vh' : 'auto',
        display: 'flex', 
        flexDirection: 'column', 
        gap: '14px',
        boxShadow: isFullscreen ? 'none' : '0 25px 50px -12px rgba(0,0,0,0.25)', 
        border: isFullscreen ? 'none' : '1px solid #cbd5e1',
        maxHeight: isFullscreen ? '100vh' : 'calc(100vh - 80px)', 
        overflowY: 'auto',
        boxSizing: 'border-box'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '850', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin size={20} color="#3b82f6" />
            {lang === 'ru' ? 'Выбор местоположения на карте' : 'Select location on map'}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? (lang === 'ru' ? 'Свернуть' : 'Minimize') : (lang === 'ru' ? 'Развернуть на весь экран' : 'Fullscreen')}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
            >
              {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Global Search Bar */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              style={{
                width: '100%',
                padding: '10px 14px 10px 38px',
                borderRadius: '10px',
                border: '2px solid #e2e8f0',
                outline: 'none',
                fontSize: '13px',
                fontWeight: '600',
                boxSizing: 'border-box'
              }}
              placeholder={lang === 'ru' ? 'Поиск городов, стран, улиц по всему миру...' : 'Search cities, countries, streets...'}
            />
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            style={{
              padding: '10px 18px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontWeight: '700',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#2563eb'}
            onMouseLeave={e => e.currentTarget.style.background = '#3b82f6'}
          >
            {lang === 'ru' ? 'Найти' : 'Find'}
          </button>
        </div>

        {/* Info or loading bar */}
        {isLoadingGeolocation && (
          <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: '8px', color: '#2563eb', fontSize: '12px', fontWeight: '750', textAlign: 'center' }}>
            ⏳ {lang === 'ru' ? 'Поиск и определение геопозиции...' : 'Searching & locating...'}
          </div>
        )}

        {/* Map container */}
        <div style={{ position: 'relative' }}>
          <div
            id="leaflet-map-select"
            style={{
              width: '100%',
              height: isFullscreen ? 'calc(100vh - 280px)' : '320px',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              zIndex: 1
            }}
          />
          
          {/* Quick geolocation button */}
          <button
            type="button"
            onClick={requestMyLocation}
            title={lang === 'ru' ? 'Мое местоположение' : 'My location'}
            style={{
              position: 'absolute',
              bottom: '20px',
              right: '20px',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'white',
              border: '1px solid #cbd5e1',
              boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 100,
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'white'}
          >
            <Navigation size={18} color="#2563eb" fill={geolocated ? "#2563eb" : "none"} />
          </button>
        </div>

        {/* Selected Address field */}
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
            {lang === 'ru' ? 'Выбранный адрес' : 'Selected Address'}
          </label>
          <input
            type="text"
            value={mapAddress}
            onChange={(e) => setMapAddress(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '2px solid #e2e8f0',
              outline: 'none',
              fontSize: '13px',
              fontWeight: '600',
              boxSizing: 'border-box'
            }}
            placeholder={lang === 'ru' ? 'Кликните на карту для автоматического определения адреса...' : 'Click on the map to define the address...'}
          />
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
          >
            {lang === 'ru' ? 'Закрыть' : 'Close'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
