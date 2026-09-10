import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, AlertCircle, Search, X, ChevronDown, Download } from 'lucide-react';
import SchedulingTab from './objects/SchedulingTab';
import GeneralSchedulingTab from './objects/GeneralSchedulingTab';

export default function CalendarPlanningPage({ api, lang = 'ru', t = {}, initialTarget = null, onInitialTargetConsumed }) {
  const [projects, setProjects] = useState([]);
  const [objects, setObjects] = useState([]);
  const [rawEstimates, setRawEstimates] = useState([]);
  const [estimateType, setEstimateType] = useState(''); // '', 'work', 'planned', 'actual'

  const [showKpModal, setShowKpModal] = useState(false);
  const [kpStep, setKpStep] = useState(1);
  const schedulingTabRef = useRef(null);

  const estimates = useMemo(() => {
    return rawEstimates.filter(est => {
      const type = est.estimate_type || 'work';
      if (estimateType === 'planned') {
        return type === 'planned' && est.status === 'planned_approved';
      }
      if (estimateType === 'actual') {
        return type === 'actual' && est.status === 'actual_formed';
      }
      return false;
    });
  }, [rawEstimates, estimateType]);

  useEffect(() => {
    setSelectedEstimateId('');
    setSelectedEstimateLabel('');
    setEstimateSearch('');
  }, [estimateType]);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [selectedEstimateId, setSelectedEstimateId] = useState('');
  const [selectedEstimateLabel, setSelectedEstimateLabel] = useState('');

  const [estimateSearch, setEstimateSearch] = useState('');
  const [estimateDropdownOpen, setEstimateDropdownOpen] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const estimateDropdownRef = useRef(null);
  // Holds the object/estimate we still need to auto-select once their fetches land.
  // Cleared once fully applied (or once we hit data that doesn't match).
  const pendingTargetRef = useRef(null);

  // Preselect project/object/estimate when navigated here with a specific target
  // (e.g. from the "Все сметы" list or from inside a smeta editor).
  useEffect(() => {
    if (initialTarget && initialTarget.projectId) {
      pendingTargetRef.current = { objectId: initialTarget.objectId, estimateId: initialTarget.estimateId };
      setSelectedProjectId(initialTarget.projectId);
      if (onInitialTargetConsumed) onInitialTargetConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (estimateDropdownRef.current && !estimateDropdownRef.current.contains(e.target)) {
        setEstimateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 1. Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  // 2. Fetch objects when project changes
  useEffect(() => {
    if (selectedProjectId) {
      fetchObjects(selectedProjectId);
      if (!pendingTargetRef.current) {
        setSelectedObjectId('');
        setSelectedEstimateId('');
        setSelectedEstimateLabel('');
        setEstimateSearch('');
      }
    } else {
      setObjects([]);
      setRawEstimates([]);
    }
  }, [selectedProjectId]);

  // 3. Fetch estimates when object changes
  useEffect(() => {
    if (selectedObjectId) {
      fetchEstimates(selectedProjectId, selectedObjectId);
      if (!pendingTargetRef.current) {
        setSelectedEstimateId('');
        setSelectedEstimateLabel('');
        setEstimateSearch('');
      }
    } else {
      setRawEstimates([]);
    }
  }, [selectedObjectId]);

  const fetchProjects = async () => {
    setLoadingOptions(true);
    try {
      const res = await api.get('/estimates/projects');
      setProjects(res.data || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchObjects = async (projId) => {
    setLoadingOptions(true);
    try {
      const res = await api.get(`/estimates/projects/${projId}/objects`);
      const list = res.data || [];
      setObjects(list);

      const pending = pendingTargetRef.current;
      if (pending) {
        const matched = pending.objectId && list.find(o => o.id === pending.objectId);
        if (matched) {
          setSelectedObjectId(matched.id);
        } else {
          // Target object not found under this project — abandon the pending auto-select.
          pendingTargetRef.current = null;
          setSelectedObjectId('');
          setSelectedEstimateId('');
          setSelectedEstimateLabel('');
        }
      }
    } catch (err) {
      console.error('Error fetching objects:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchEstimates = async (projId, objId) => {
    setLoadingOptions(true);
    try {
      const res = await api.get('/estimates/all-test');
      const filtered = (res.data || []).filter(est =>
        (est.project_uuid === projId || est.project_id === projId) &&
        est.object_id === objId
      );
      setRawEstimates(filtered);

      const pending = pendingTargetRef.current;
      if (pending) {
        const idx = pending.estimateId ? filtered.findIndex(e => e.id === pending.estimateId) : -1;
        if (idx !== -1) {
          const est = filtered[idx];
          const type = est.estimate_type || 'work';
          setEstimateType(type);
          const label = buildEstimateLabel(est, idx, filtered.length);
          setSelectedEstimateId(est.id);
          setSelectedEstimateLabel(label);
        }
        pendingTargetRef.current = null;
      }
    } catch (err) {
      console.error('Error fetching estimates:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  // Понятная подпись версии сметы (Рабочая / Плановая версия N / Фактическая)
  const getVersionLabel = (est) => {
    if (!est) return '—';
    const type = est.estimate_type || 'work';
    if (type === 'actual') {
      if (lang === 'ka') return 'ფაქტობრივი ვერსია';
      if (lang === 'az') return 'Faktiki versiya';
      if (lang === 'en') return 'Actual Version';
      return 'Фактическая версия';
    }
    if (type === 'planned') {
      const verStr = est.plan_version ? ` ${est.plan_version}` : '';
      if (lang === 'ka') return `საგეგმო ვერსია${verStr}`;
      if (lang === 'az') return `Planlaşdırılmış versiya${verStr}`;
      if (lang === 'en') return `Planned Version${verStr}`;
      return `Плановая версия${verStr}`;
    }
    if (lang === 'ka') return 'სამუშაო ვერსია';
    if (lang === 'az') return 'İşçi versiya';
    if (lang === 'en') return 'Working Version';
    return 'Рабочая версия';
  };

  const getVersionBadgeColors = (est) => {
    const type = est?.estimate_type || 'work';
    if (type === 'actual') return { bg: '#ffedd5', color: '#c2410c' };
    if (type === 'planned') return { bg: '#e0e7ff', color: '#4338ca' };
    return { bg: '#f1f5f9', color: '#475569' };
  };

  // Build human-readable label for an estimate (same format as EstimatesPage)
  const buildEstimateLabel = (est, idx, totalOverride) => {
    const total = totalOverride != null ? totalOverride : estimates.length;
    const seqNum = total - idx;  // descending like EstimatesPage
    const numCode = `СМ-000${10 + seqNum}`;
    const estName = est.project_id && typeof est.project_id === 'string' ? est.project_id : '';
    const details = [est.zone, est.phase, est.discipline].filter(Boolean).join(' / ');
    return [numCode, estName, details ? `(${details})` : '', `[${getVersionLabel(est)}]`].filter(Boolean).join(' · ');
  };

  const filteredEstimates = estimates.filter((est, idx) => {
    const total = estimates.length;
    const seqNum = total - idx;
    const numCode = `СМ-000${10 + seqNum}`;
    const estName = est.project_id || '';
    const q = estimateSearch.toLowerCase();
    return (
      numCode.toLowerCase().includes(q) ||
      estName.toLowerCase().includes(q) ||
      (est.zone || '').toLowerCase().includes(q) ||
      (est.phase || '').toLowerCase().includes(q) ||
      (est.discipline || '').toLowerCase().includes(q) ||
      String(seqNum).includes(q)
    );
  });

  const selectEstimate = (est, idx) => {
    const label = buildEstimateLabel(est, idx);
    setSelectedEstimateId(est.id);
    setSelectedEstimateLabel(label);
    setEstimateSearch('');
    setEstimateDropdownOpen(false);
  };

  const clearEstimate = () => {
    setSelectedEstimateId('');
    setSelectedEstimateLabel('');
    setEstimateSearch('');
  };

  const selectStyle = {
    width: '100%',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
    background: 'white',
    fontWeight: '600',
    color: '#1e293b',
    outline: 'none'
  };

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '800',
    color: '#475569',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '10px 0 20px 0' }}>

      {/* HEADER INFO STRIP OR PLACEHOLDER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>
            {selectedEstimateId ? `📅 КП: ${selectedEstimateLabel}` : (lang === 'ru' ? 'Календарное планирование' : 'Scheduling')}
          </h2>
          {selectedEstimateId && (
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', display: 'flex', gap: '12px' }}>
              <span>📁 {projects.find(p => p.id === selectedProjectId)?.name}</span>
              <span>📍 {objects.find(o => o.id === selectedObjectId)?.name}</span>
              <span>⚙️ {estimateType === 'planned' ? 'Плановая смета' : 'Фактическая смета'}</span>
              {(() => {
                const est = rawEstimates.find(e => e.id === selectedEstimateId);
                const bits = [est?.zone, est?.phase, est?.discipline].filter(Boolean);
                return bits.length > 0 ? <span>🏗️ {bits.join(' / ')}</span> : null;
              })()}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {selectedEstimateId && (
            <button
              onClick={() => schedulingTabRef.current?.exportPDF()}
              title={t.gprBtnExport || (lang === 'ru' ? 'Экспорт ГПР в PDF' : 'Export Schedule to PDF')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px',
                background: '#ffffff',
                color: '#16a34a',
                border: '1px solid #16a34a',
                borderRadius: '12px',
                fontWeight: '800',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              <Download size={16} /> {lang === 'ru' ? 'Экспорт ГПР' : 'Export Schedule'}
            </button>
          )}
          <button
            onClick={() => {
              setKpStep(1);
              setShowKpModal(true);
            }}
            style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontWeight: '800',
              cursor: 'pointer',
              fontSize: '13px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
            }}
          >
            {selectedEstimateId ? (lang === 'ru' ? 'Сменить / Создать КП' : 'Change / Create Schedule') : (lang === 'ru' ? 'Создать КП' : 'Create Schedule')}
          </button>
        </div>
      </div>

      {/* KP CREATION STEP MODAL */}
      {showKpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ width: '90%', maxWidth: '520px', background: 'white', padding: '24px', borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column', gap: '16px', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '900', color: '#1e293b' }}>
                {lang === 'ru' ? `Создание КП · Шаг ${kpStep} из 4` : `Create Schedule · Step ${kpStep} of 4`}
              </h3>
              <button onClick={() => setShowKpModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={20} />
              </button>
            </div>

            {/* STEP 1: PROJECT */}
            {kpStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>{t.lblProject || 'Проект'}</label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    disabled={loadingOptions}
                    style={selectStyle}
                  >
                    <option value="">-- {t.lblSelectProject || 'Выберите проект'} --</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button
                    onClick={() => setKpStep(2)}
                    disabled={!selectedProjectId}
                    style={{
                      padding: '10px 20px',
                      background: selectedProjectId ? '#2563eb' : '#94a3b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      cursor: selectedProjectId ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Далее →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: OBJECT */}
            {kpStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', background: '#f8fafc', padding: '10px', borderRadius: '8px' }}>
                  <strong>Проект:</strong> {projects.find(p => p.id === selectedProjectId)?.name}
                </div>
                <div>
                  <label style={labelStyle}>{t.lblObject || 'Объект'}</label>
                  <select
                    value={selectedObjectId}
                    onChange={(e) => setSelectedObjectId(e.target.value)}
                    disabled={loadingOptions}
                    style={selectStyle}
                  >
                    <option value="">-- {t.lblSelectObject || 'Выберите объект'} --</option>
                    {objects.map(obj => (
                      <option key={obj.id} value={obj.id}>{obj.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                  <button
                    onClick={() => setKpStep(1)}
                    style={{
                      padding: '10px 20px',
                      background: '#f1f5f9',
                      color: '#475569',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      cursor: 'pointer'
                    }}
                  >
                    ← Назад
                  </button>
                  <button
                    onClick={() => setKpStep(3)}
                    disabled={!selectedObjectId}
                    style={{
                      padding: '10px 20px',
                      background: selectedObjectId ? '#2563eb' : '#94a3b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      cursor: selectedObjectId ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Далее →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ESTIMATE TYPE */}
            {kpStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', background: '#f8fafc', padding: '10px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div><strong>Проект:</strong> {projects.find(p => p.id === selectedProjectId)?.name}</div>
                  <div><strong>Объект:</strong> {objects.find(o => o.id === selectedObjectId)?.name}</div>
                </div>
                <div>
                  <label style={labelStyle}>{t.schedEstType || 'Тип сметы'}</label>
                  <select
                    value={estimateType}
                    onChange={(e) => setEstimateType(e.target.value)}
                    disabled={loadingOptions}
                    style={selectStyle}
                  >
                    <option value="">-- {t.schedSelectType || 'Выберите тип сметы'} --</option>
                    <option value="planned">{t.schedTypePlanned || 'Плановая'}</option>
                    <option value="actual">{t.schedTypeActual || 'Фактическая'}</option>
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                  <button
                    onClick={() => setKpStep(2)}
                    style={{
                      padding: '10px 20px',
                      background: '#f1f5f9',
                      color: '#475569',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      cursor: 'pointer'
                    }}
                  >
                    ← Назад
                  </button>
                  <button
                    onClick={() => setKpStep(4)}
                    disabled={!estimateType}
                    style={{
                      padding: '10px 20px',
                      background: estimateType ? '#2563eb' : '#94a3b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      cursor: estimateType ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Далее →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: ESTIMATE */}
            {kpStep === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', background: '#f8fafc', padding: '10px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div><strong>Проект:</strong> {projects.find(p => p.id === selectedProjectId)?.name}</div>
                  <div><strong>Объект:</strong> {objects.find(o => o.id === selectedObjectId)?.name}</div>
                  <div><strong>Тип:</strong> {estimateType === 'planned' ? 'Плановая' : 'Фактическая'}</div>
                </div>

                {estimates.length === 0 ? (
                  <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '12px', textAlign: 'center' }}>
                    <AlertCircle size={28} color="#ef4444" style={{ margin: '0 auto 8px auto' }} />
                    <div style={{ fontSize: '13px', fontWeight: '850', color: '#991b1b', lineHeight: '1.5' }}>
                      {estimateType === 'planned' 
                        ? 'Нет утвержденных плановых смет для данного объекта. Календарное планирование не может быть создано.' 
                        : 'Нет сформированных фактических смет для данного объекта.'}
                    </div>
                  </div>
                ) : (
                  <div ref={estimateDropdownRef} style={{ position: 'relative' }}>
                    <label style={labelStyle}>Смета</label>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '11px 12px',
                        borderRadius: '12px',
                        border: `2px solid ${estimateDropdownOpen ? '#3b82f6' : '#cbd5e1'}`,
                        background: 'white',
                        cursor: 'pointer',
                        boxShadow: estimateDropdownOpen ? '0 0 0 3px rgba(59,130,246,0.12)' : 'none',
                        transition: 'border-color 0.15s, box-shadow 0.15s'
                      }}
                      onClick={() => setEstimateDropdownOpen(v => !v)}
                    >
                      <Search size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
                      <span style={{
                        flex: 1,
                        fontSize: '13px',
                        fontWeight: selectedEstimateId ? '600' : '400',
                        color: selectedEstimateId ? '#1e293b' : '#94a3b8',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {selectedEstimateId ? selectedEstimateLabel : '-- Выберите смету --'}
                      </span>
                      {selectedEstimateId ? (
                        <X
                          size={14}
                          color="#94a3b8"
                          style={{ flexShrink: 0, cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); clearEstimate(); }}
                        />
                      ) : (
                        <ChevronDown size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
                      )}
                    </div>

                    {estimateDropdownOpen && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
                        zIndex: 9999,
                        overflow: 'hidden'
                      }}>
                        <div style={{ padding: '10px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Search size={14} color="#64748b" />
                          <input
                            autoFocus
                            type="text"
                            placeholder="Поиск по номеру, зоне, фазе..."
                            value={estimateSearch}
                            onChange={(e) => setEstimateSearch(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              border: 'none',
                              outline: 'none',
                              flex: 1,
                              fontSize: '13px',
                              color: '#1e293b',
                              background: 'transparent'
                            }}
                          />
                          {estimateSearch && (
                            <X size={13} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => setEstimateSearch('')} />
                          )}
                        </div>

                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                          {filteredEstimates.map((est) => {
                            const realIdx = estimates.indexOf(est);
                            const label = buildEstimateLabel(est, realIdx);
                            const isSelected = est.id === selectedEstimateId;
                            return (
                              <div
                                key={est.id}
                                onClick={() => {
                                  selectEstimate(est, realIdx);
                                  setEstimateDropdownOpen(false);
                                }}
                                style={{
                                  padding: '10px 14px',
                                  cursor: 'pointer',
                                  background: isSelected ? '#eff6ff' : 'transparent',
                                  borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                                  transition: 'background 0.12s'
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '700', color: isSelected ? '#2563eb' : '#1e293b' }}>
                                    СМ-000{10 + (estimates.length - realIdx)}{est.project_id ? ` · ${est.project_id}` : ''}
                                  </div>
                                  <span style={{
                                    fontSize: '10px',
                                    fontWeight: '800',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    whiteSpace: 'nowrap',
                                    background: getVersionBadgeColors(est).bg,
                                    color: getVersionBadgeColors(est).color
                                  }}>
                                    {getVersionLabel(est)}
                                  </span>
                                </div>
                                {[est.zone, est.phase, est.discipline].filter(Boolean).length > 0 && (
                                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                    {[est.zone, est.phase, est.discipline].filter(Boolean).join(' / ')}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                  <button
                    onClick={() => setKpStep(3)}
                    style={{
                      padding: '10px 20px',
                      background: '#f1f5f9',
                      color: '#475569',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      cursor: 'pointer'
                    }}
                  >
                    ← Назад
                  </button>
                  {estimates.length > 0 && (
                    <button
                      onClick={() => setShowKpModal(false)}
                      disabled={!selectedEstimateId}
                      style={{
                        padding: '10px 20px',
                        background: selectedEstimateId ? '#2563eb' : '#94a3b8',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: '800',
                        cursor: selectedEstimateId ? 'pointer' : 'not-allowed'
                      }}
                    >
                      Открыть КП →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GANTT TIMELINE DISPLAY OR PLACEHOLDER */}
      {!selectedEstimateId ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 40px',
          background: '#ffffff',
          borderRadius: '20px',
          border: '1px solid #e2e8f0',
          textAlign: 'center',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
        }}>
          <Calendar size={56} color="#3b82f6" style={{ marginBottom: '20px', background: '#eff6ff', padding: '12px', borderRadius: '16px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a', marginBottom: '6px' }}>
            {lang === 'ru' ? 'Календарный план не выбран' : 'Calendar Schedule Not Selected'}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '380px', lineHeight: '1.6', marginBottom: '20px' }}>
            {lang === 'ru' ? 'Нажмите кнопку ниже, чтобы запустить пошаговый мастер создания или смены календарного планирования (КП).' : 'Click the button below to start the step-by-step wizard for schedule creation.'}
          </p>
          <button
            onClick={() => {
              setKpStep(1);
              setShowKpModal(true);
            }}
            style={{
              padding: '12px 28px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontWeight: '800',
              cursor: 'pointer',
              fontSize: '14px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
            }}
          >
            {lang === 'ru' ? 'Создать КП' : 'Create КП'}
          </button>
        </div>
      ) : (
        <SchedulingTab
          ref={schedulingTabRef}
          docId={selectedEstimateId}
          api={api}
          lang={lang}
          t={t}
          projectNameOverride={projects.find(p => p.id === selectedProjectId)?.name || ''}
          objectNameOverride={objects.find(o => o.id === selectedObjectId)?.name || ''}
        />
      )}
    </div>
  );
}
