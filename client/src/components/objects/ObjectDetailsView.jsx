import React, { useState, useEffect } from 'react';
import { ArrowLeft, Edit2, Plus, Trash2, Layers, Calendar, Clock, User, FileText, MapPin } from 'lucide-react';
import EstimateEditor from '../EstimateEditor';
import SchedulingTab from './SchedulingTab';
import GeneralSchedulingTab from './GeneralSchedulingTab';
import AddressMapModal from '../AddressMapModal';

export default function ObjectDetailsView({
  currentObj,
  onBack,
  objectActiveTab,
  setObjectActiveTab,
  isEditable,
  isEditingInfo,
  setIsEditingInfo,
  editObjectName,
  setEditObjectName,
  editObjectDescription,
  setEditObjectDescription,
  editObjectAddress,
  setEditObjectAddress,
  editObjectLatitude,
  setEditObjectLatitude,
  editObjectLongitude,
  setEditObjectLongitude,
  editObjectResponsibleId,
  setEditObjectResponsibleId,
  editObjectResponsibleSearch,
  setEditObjectResponsibleSearch,
  showEditObjectResponsibleDropdown,
  setShowEditObjectResponsibleDropdown,
  handleSaveInfo,
  psdDocs,
  loadingPsdDocs,
  handleOpenAddPsd,
  handleEditPsd,
  handleDeletePsd,
  getDocTypeName,
  getCleanFilename,
  userRole,
  lang,
  setLang,
  t,
  getEstimateStatusBadgeStyle,
  api,
  selectedProjectId,
  setProjectObjects,
  setSelectedObject,
  schedulingData,
  loadingScheduling,
  managers = []
}) {
  const [isMapOpen, setIsMapOpen] = useState(false);
  useEffect(() => {
    if (currentObj) {
      if (setEditObjectName) setEditObjectName(currentObj.name || '');
      if (setEditObjectDescription) setEditObjectDescription(currentObj.description || '');
      if (setEditObjectAddress) setEditObjectAddress(currentObj.address || '');
      if (setEditObjectLatitude) setEditObjectLatitude(currentObj.latitude != null ? String(currentObj.latitude) : '');
      if (setEditObjectLongitude) setEditObjectLongitude(currentObj.longitude != null ? String(currentObj.longitude) : '');
      if (setEditObjectResponsibleId) setEditObjectResponsibleId(currentObj.responsible_id || '');
      if (setEditObjectResponsibleSearch) setEditObjectResponsibleSearch(currentObj.responsible_name || '');
    }
    if (setIsEditingInfo) setIsEditingInfo(false);
  }, [currentObj?.id]);

  if (!currentObj) return null;

  const isInfoTab = objectActiveTab === 'info';
  const isPsdTab = objectActiveTab === 'psd';
  const isEstimatesTab = objectActiveTab === 'estimate' || objectActiveTab === 'estimates';
  const isSchedulingTab = objectActiveTab === 'scheduling';

  const isPsdEditable = isEditable && (!currentObj.estimate || currentObj.estimate.status === 'draft');

  const filteredManagers = managers.filter(m =>
    `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes((editObjectResponsibleSearch || '').toLowerCase())
  );

  const getLocalizedEstimateStatus = (status, estimateStatuses = []) => {
    if (!status) status = 'not_started';
    const foundInDb = (estimateStatuses || []).find(s => s.code === status || s.id === status);
    if (foundInDb && foundInDb[`name_${lang}`]) {
      return foundInDb[`name_${lang}`].toUpperCase();
    }
    switch (status) {
      case 'not_started': return (t.estStatusNotStarted || t.estimateMissing || 'Не начато').toUpperCase();
      case 'draft': return (t.estStatusDraft || 'Черновик').toUpperCase();
      case 'pending':
      case 'under_approval': return (t.estStatusPending || 'На согласовании').toUpperCase();
      case 'approved': return (t.estStatusApproved || 'Утверждено').toUpperCase();
      case 'rejected': return (t.estStatusRejected || 'Отклонено').toUpperCase();
      default: return String(status).toUpperCase();
    }
  };

  const renderInfoTab = () => {
    if (isEditingInfo) {
      return (
        <form onSubmit={handleSaveInfo} style={{ background: 'white', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.lblObjectName || 'Название объекта'} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={editObjectName}
              onChange={(e) => setEditObjectName(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              placeholder={t.placeholderObjectName || "Например, Корпус 1..."}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.lblDescription || 'Описание объекта'}
            </label>
            <textarea
              rows={3}
              value={editObjectDescription}
              onChange={(e) => setEditObjectDescription(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', fontFamily: 'inherit' }}
              placeholder={t.placeholderObjectDesc || "Краткое описание..."}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.lblResponsible || 'Ответственный'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={editObjectResponsibleSearch}
                onFocus={() => setShowEditObjectResponsibleDropdown(true)}
                onChange={(e) => {
                  setEditObjectResponsibleSearch(e.target.value);
                  setShowEditObjectResponsibleDropdown(true);
                }}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                placeholder={t.placeholderResponsible || "Выберите ответственного..."}
              />
              <User size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            </div>

            {showEditObjectResponsibleDropdown && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '10px',
                marginTop: '4px', maxHeight: '180px', overflowY: 'auto', zIndex: 10, boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
              }}>
                {filteredManagers.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      setEditObjectResponsibleId(m.id);
                      setEditObjectResponsibleSearch(`${m.first_name || ''} ${m.last_name || ''}`.trim());
                      setShowEditObjectResponsibleDropdown(false);
                    }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: '#334155', borderBottom: '1px solid #f1f5f9' }}
                  >
                    👤 {m.first_name} {m.last_name} ({m.email})
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.lblAddress || 'Адрес'}
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={editObjectAddress}
                onChange={(e) => setEditObjectAddress(e.target.value)}
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
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                {t.lblLatitude || 'Широта (Lat)'}
              </label>
              <input
                type="text"
                value={editObjectLatitude}
                onChange={(e) => setEditObjectLatitude(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                {t.lblLongitude || 'Долгота (Lng)'}
              </label>
              <input
                type="text"
                value={editObjectLongitude}
                onChange={(e) => setEditObjectLongitude(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={() => setIsEditingInfo(false)}
              style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
            >
              {t.btnCancel || 'Отмена'}
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: 1, padding: '10px' }}
            >
              {t.btnSave || 'Сохранить'}
            </button>
          </div>
        </form>
      );
    }

    return (
      <div style={{ background: 'white', padding: '28px', borderRadius: '20px', border: '1px solid #cbd5e1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', position: 'relative' }}>
        {isEditable && (
          <button
            onClick={() => {
              if (setEditObjectName) setEditObjectName(currentObj.name || '');
              if (setEditObjectDescription) setEditObjectDescription(currentObj.description || '');
              if (setEditObjectAddress) setEditObjectAddress(currentObj.address || '');
              if (setEditObjectLatitude) setEditObjectLatitude(currentObj.latitude != null ? String(currentObj.latitude) : '');
              if (setEditObjectLongitude) setEditObjectLongitude(currentObj.longitude != null ? String(currentObj.longitude) : '');
              if (setEditObjectResponsibleId) setEditObjectResponsibleId(currentObj.responsible_id || '');
              if (setEditObjectResponsibleSearch) setEditObjectResponsibleSearch(currentObj.responsible_name || '');
              if (setShowEditObjectResponsibleDropdown) setShowEditObjectResponsibleDropdown(false);
              if (setIsEditingInfo) setIsEditingInfo(true);
            }}
            style={{ position: 'absolute', top: '24px', right: '24px', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '13px' }}
            title={t.btnEdit || "Редактировать объект"}
          >
            <Edit2 size={16} />
            <span>{t.btnEdit || 'Редактировать'}</span>
          </button>
        )}

        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {(t.lblObjectName || 'Название объекта').toUpperCase()}
          </div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#1e293b', marginTop: '6px' }}>{currentObj.name}</div>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {(t.lblDescription || 'Описание').toUpperCase()}
          </div>
          <div style={{ fontSize: '13px', fontWeight: '500', color: '#475569', marginTop: '6px', lineHeight: '1.5' }}>
            {currentObj.description || (t.noDescription || 'Описание отсутствует')}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {(t.lblResponsible || 'Ответственный').toUpperCase()}
          </div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            👤 {currentObj.responsible_name || (t.notAssigned || 'Не назначен')}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {(t.lblAddress || 'Адрес').toUpperCase()}
          </div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            📍 {currentObj.address || (t.notSpecified || 'Не указан')}
          </div>
        </div>

        {currentObj.latitude && currentObj.longitude && (
          <div style={{ gridColumn: 'span 2', display: 'flex', gap: '40px', background: '#f8fafc', padding: '16px 20px', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {(t.lblLatitude || 'Широта (Lat)').toUpperCase()}
              </div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#475569', marginTop: '4px' }}>{currentObj.latitude}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {(t.lblLongitude || 'Долгота (Lng)').toUpperCase()}
              </div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#475569', marginTop: '4px' }}>{currentObj.longitude}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPsdTab = () => {
    return (
      <div style={{ background: 'white', padding: '24px', borderRadius: '20px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#1e293b' }}>
            {t.psdFullTitle || 'Проектно-сметная документация'} ({psdDocs.length})
          </h4>

          {isPsdEditable && (
            <button onClick={handleOpenAddPsd} className="btn-primary" style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} /> {t.addDoc || 'Добавить документ'}
            </button>
          )}
        </div>

        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColName || 'Название'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColType || 'Тип'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569', textAlign: 'center' }}>{t.psdColVersion || 'Версия'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColSource || 'Источник'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColCreatedBy || 'Добавил'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColDate || 'Дата'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColNotes || 'Примечания'}</th>
                {isPsdEditable && <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569', textAlign: 'center' }}>{t.psdColActions || 'Действия'}</th>}
              </tr>
            </thead>
            <tbody>
              {psdDocs.map((doc) => {
                // Build correct file URL using the server's static route
                const fileUrl = doc.file_path
                  ? (doc.file_path.startsWith('http')
                      ? doc.file_path
                      : `${api.defaults.baseURL}/estimates/uploads/${doc.file_path}`)
                  : null;
                const cleanName = getCleanFilename(doc.file_path);
                const creator = doc.created_by_profile ? `${doc.created_by_profile.first_name} ${doc.created_by_profile.last_name}` : (t.estimator || 'Сметчик');

                return (
                  <tr key={doc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: '700', color: '#1e293b' }}>{doc.name}</td>
                    <td style={{ padding: '12px 16px', fontWeight: '600', color: '#475569' }}>{getDocTypeName(doc)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#64748b' }}>{doc.version || '1.0'}</td>
                    <td style={{ padding: '12px 16px', maxWidth: '200px' }}>
                      {fileUrl ? (
                        <a
                          href={fileUrl}
                          target="_blank"
                          download={cleanName}
                          rel="noopener noreferrer"
                          title={cleanName}
                          style={{ textDecoration: 'none', color: '#2563eb', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}
                        >
                          📄 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanName || doc.name}</span>
                        </a>
                      ) : doc.doc_url ? (
                        <a
                          href={doc.doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={doc.doc_url}
                          style={{ textDecoration: 'none', color: '#10b981', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}
                        >
                          🔗 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name || doc.doc_url}</span>
                        </a>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>{t.noSource || 'Нет источника'}</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '600', color: '#475569' }}>{creator}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b' }}>{new Date(doc.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '12px' }}>{doc.notes || '-'}</td>
                    {isPsdEditable && (
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                          <button onClick={() => handleEditPsd(doc)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: '4px' }} title="Редактировать">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDeletePsd(doc.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }} title="Удалить">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}

              {psdDocs.length === 0 && !loadingPsdDocs && (
                <tr>
                  <td colSpan={isPsdEditable ? 8 : 7} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    <Layers size={36} style={{ opacity: 0.3, marginBottom: '10px' }} />
                    <div>{t.noPsdDocs || 'Нет загруженных документов ПСД.'}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderEstimateTab = () => {
    if (currentObj.estimate) {
      return (
        <div style={{ background: '#f8fafc', padding: '0px', borderRadius: '16px', border: 'none' }}>
          <EstimateEditor
            docId={currentObj.estimate.id}
            userRole={userRole}
            resourceLanguage={lang}
            setResourceLanguage={setLang}
            onBack={onBack}
            isReadOnly={false}
            showPlanVersioning={false}
          />
        </div>
      );
    }

    return (
      <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
        <Layers size={48} style={{ opacity: 0.3, marginBottom: '16px', color: '#64748b' }} />
        <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '800', color: '#334155' }}>
          {t.estimateNotCreated || 'Смета для объекта не создана'}
        </h4>
        <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: '#64748b', maxWidth: '380px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.5' }}>
          {t.estimateDescInit || 'Смета инициализирует иерархическую структуру WBS объекта. Сметчик сможет добавлять конструктивы, подконструктивы и работы.'}
        </p>
      </div>
    );
  };

  if (isEstimatesTab) {
    return renderEstimateTab();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Object Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '16px 24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => { if (setIsEditingInfo) setIsEditingInfo(false); onBack(); }}
            style={{
              padding: '9px 18px',
              fontSize: '13px',
              fontWeight: '800',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#ffffff',
              color: '#2563eb',
              border: '1.5px solid #dbeafe',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)',
              transition: 'all 0.2s ease'
            }}
          >
            <ArrowLeft size={16} />
            <span>{t.btnBack || 'Назад'}</span>
          </button>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>
            {t.lblObject || 'Объект'}: {currentObj.name}
          </h3>
        </div>
      </div>

      {/* Segment Tabs Nav */}
      <div style={{
        display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '14px', gap: '2px', alignSelf: 'flex-start', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
      }}>
        {[
          { id: 'info', label: t.tabInfo || 'Информация' },
          { id: 'psd', label: t.tabPsd || 'ПСД' },
          // Временно скрыли по просьбе пользователя (вместе с кнопкой "Открыть WBS")
          // { id: 'estimate', label: t.tabEstimate || 'Структура WBS' },
          // Временно скрыли по просьбе пользователя
          // { id: 'scheduling', label: t.tabScheduling || 'Календарное планирование' },
          { id: 'general_scheduling', label: t.tabGeneralScheduling || 'Общее календарное планирование' }
        ].map(tab => {
          const isActive = objectActiveTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setObjectActiveTab(tab.id)}
              style={{
                padding: '8px 16px', background: isActive ? '#ffffff' : 'transparent', border: 'none', borderRadius: '10px',
                color: isActive ? '#2563eb' : '#64748b', fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: isActive ? '0 4px 10px rgba(0,0,0,0.05)' : 'none'
              }}
              className="segment-tab"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, minHeight: '400px' }}>
        {isInfoTab && renderInfoTab()}
        {isPsdTab && renderPsdTab()}
        {/* Временно скрыли по просьбе пользователя вместе с вкладкой выше */}
        {/* {isEstimatesTab && renderEstimateTab()} */}
        {/* Временно скрыли по просьбе пользователя
        {isSchedulingTab && (
          <div style={{ background: 'white', padding: '24px', borderRadius: '20px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} color="#2563eb" /> {t.tabScheduling || 'Календарное планирование'} (WBS)
              </h4>
            </div>

            {!currentObj.estimate ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                <Calendar size={44} style={{ opacity: 0.3, marginBottom: '12px' }} />
                <h5 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: '800' }}>{t.estimateNotCreated || 'Смета для объекта не создана'}</h5>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{t.schedulingUnavailable || 'Календарное планирование WBS недоступно до создания сметы.'}</p>
              </div>
            ) : (
              <SchedulingTab
                docId={currentObj.estimate.id}
                currentObj={currentObj}
                api={api}
                lang={lang}
                t={t}
              />
            )}
          </div>
        )}
        */}
        {objectActiveTab === 'general_scheduling' && (
          <div style={{ background: 'white', padding: '24px', borderRadius: '20px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} color="#2563eb" /> {t.generalSchedulingHeading || 'Общее календарное планирование'}
              </h4>
            </div>

            <GeneralSchedulingTab
              objectId={currentObj.id}
              currentObj={currentObj}
              api={api}
              lang={lang}
              t={t}
            />
          </div>
        )}
      </div>
      <AddressMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        onSelect={(coords) => {
          if (setEditObjectAddress) setEditObjectAddress(coords.address);
          if (setEditObjectLatitude) setEditObjectLatitude(coords.latitude);
          if (setEditObjectLongitude) setEditObjectLongitude(coords.longitude);
        }}
        initialAddress={editObjectAddress}
        initialLatitude={editObjectLatitude}
        initialLongitude={editObjectLongitude}
        lang={lang}
      />
    </div>
  );
}
