import React, { useState } from 'react';
import { X, User, MapPin } from 'lucide-react';
import AddressMapModal from '../AddressMapModal';

export default function ObjectCreateModal({
  isOpen,
  onClose,
  onSave,
  objectForm,
  setObjectForm,
  t,
  lang,
  isSaving,
  managers = [],
  objectResponsibleSearch,
  setObjectResponsibleSearch,
  showObjectResponsibleDropdown,
  setShowObjectResponsibleDropdown,
  setObjectResponsibleId
}) {
  const [isMapOpen, setIsMapOpen] = useState(false);
  if (!isOpen) return null;

  const filteredManagers = managers.filter(m =>
    `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes((objectResponsibleSearch || '').toLowerCase())
  );

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px'
    }}>
      <div className="animate-scale-in" style={{
        background: 'white', padding: '32px', borderRadius: '24px',
        width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '20px',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #cbd5e1'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>
            {t.modalAddObjectTitle || 'Добавить новый объект (этап)'}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
              {(t.lblObjectName || 'Название объекта').toUpperCase()} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={objectForm.name}
              onChange={(e) => setObjectForm({ ...objectForm, name: e.target.value })}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              placeholder={t.placeholderObjectName || "Например, Корпус 1 или Земляные работы"}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
              {(t.lblDescription || 'Описание').toUpperCase()}
            </label>
            <textarea
              rows={3}
              value={objectForm.description}
              onChange={(e) => setObjectForm({ ...objectForm, description: e.target.value })}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', fontFamily: 'inherit' }}
              placeholder={t.placeholderObjectDesc || "Краткое описание этапа или объекта..."}
            />
          </div>

          {/* Responsible Autocomplete Dropdown */}
          <div style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
              {(t.lblResponsible || 'Ответственный').toUpperCase()} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={objectResponsibleSearch}
                onFocus={() => setShowObjectResponsibleDropdown(true)}
                onChange={(e) => {
                  setObjectResponsibleSearch(e.target.value);
                  setShowObjectResponsibleDropdown(true);
                }}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                placeholder={t.placeholderResponsible || "Выберите ответственного..."}
              />
              <User size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            </div>

            {showObjectResponsibleDropdown && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '10px',
                marginTop: '4px', maxHeight: '180px', overflowY: 'auto', zIndex: 10, boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
              }}>
                {filteredManagers.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      setObjectResponsibleId(m.id);
                      setObjectResponsibleSearch(`${m.first_name || ''} ${m.last_name || ''}`.trim());
                      setShowObjectResponsibleDropdown(false);
                    }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: '#334155', borderBottom: '1px solid #f1f5f9' }}
                    className="dropdown-item"
                  >
                    👤 {m.first_name} {m.last_name} ({m.email})
                  </div>
                ))}
                {filteredManagers.length === 0 && (
                  <div style={{ padding: '10px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
                    Сотрудники не найдены
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
              {(t.lblAddress || 'Адрес').toUpperCase()}
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={objectForm.address}
                onChange={(e) => setObjectForm({ ...objectForm, address: e.target.value })}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                placeholder={t.placeholderObjectAddress || "Улица, город..."}
              />
              <button
                type="button"
                onClick={() => setIsMapOpen(true)}
                title="Показать на карте"
                style={{
                  padding: '10px 14px',
                  background: '#eff6ff',
                  border: '2px solid #3b82f6',
                  borderRadius: '10px',
                  color: '#3b82f6',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#3b82f6'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#3b82f6'; }}
              >
                <MapPin size={18} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                {(t.lblLatitude || 'Широта (Lat)').toUpperCase()}
              </label>
              <input
                type="text"
                value={objectForm.latitude}
                onChange={(e) => setObjectForm({ ...objectForm, latitude: e.target.value })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                placeholder="40.4093"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                {(t.lblLongitude || 'Долгота (Lng)').toUpperCase()}
              </label>
              <input
                type="text"
                value={objectForm.longitude}
                onChange={(e) => setObjectForm({ ...objectForm, longitude: e.target.value })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                placeholder="49.8671"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
              disabled={isSaving}
            >
              {t.btnCancel || 'Отмена'}
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: 1, padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}
              disabled={isSaving}
            >
              {isSaving ? (t.btnSaving || 'Сохранение...') : (t.btnAdd || 'Добавить')}
            </button>
          </div>
        </form>
      </div>
      <AddressMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        onSelect={(coords) => {
          setObjectForm({
            ...objectForm,
            address: coords.address,
            latitude: coords.latitude,
            longitude: coords.longitude
          });
        }}
        initialAddress={objectForm.address}
        initialLatitude={objectForm.latitude}
        initialLongitude={objectForm.longitude}
        lang={lang}
      />
    </div>
  );
}
