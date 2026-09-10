import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar, Check, AlertCircle, Loader, Package, Truck, Search,
  ChevronRight, ArrowRight, BarChart2, Info, Filter, MessageSquare
} from 'lucide-react';

const formatDateRu = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return dateStr;
};

export default function GpmPage({ api, lang, t, userRole }) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [objects, setObjects] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState('');

  const [activeSubTab, setActiveSubTab] = useState('materials'); // 'materials' | 'machinery'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [estimateType, setEstimateType] = useState('');

  // Validation flags
  const [hasActualEstimate, setHasActualEstimate] = useState(true);
  const [hasGpr, setHasGpr] = useState(true);

  // Materials states — количество и период приходят готовыми с сервера (из сметы и календарного плана)
  const [materials, setMaterials] = useState([]);

  // Machinery states
  const [machinery, setMachinery] = useState([]);
  const [machinerySearch, setMachinerySearch] = useState('');
  const [machineryWorkFilter, setMachineryWorkFilter] = useState('all');
  const [machineryStartDate, setMachineryStartDate] = useState('');
  const [machineryEndDate, setMachineryEndDate] = useState('');

  // 1. Load Projects on mount
  useEffect(() => {
    setLoading(true);
    api.get(`/estimates/projects?lang=${lang}`)
      .then(res => {
        const approvedProj = (res.data || []).filter(p => 
          ['approved', 'active', 'suspended', 'completed'].includes(p.status)
        );
        setProjects(approvedProj);
      })
      .catch(err => {
        setError(err.message || (t.gpmErrLoadProjects || 'Ошибка загрузки проектов'));
      })
      .finally(() => setLoading(false));
  }, [lang]);

  // 2. Load Objects when Project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setObjects([]);
      setSelectedObjectId('');
      setEstimateType('');
      return;
    }
    setLoading(true);
    api.get(`/estimates/projects/${selectedProjectId}/objects`)
      .then(res => {
        setObjects(res.data || []);
        setSelectedObjectId('');
        setEstimateType('');
      })
      .catch(err => {
        setError(err.message || (t.gpmErrLoadObjects || 'Ошибка загрузки объектов'));
      })
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  // 3. Load Materials / Machinery when Project, Object, estimateType or Tab changes
  useEffect(() => {
    if (!selectedProjectId || !selectedObjectId || !estimateType) {
      setMaterials([]);
      setMachinery([]);
      return;
    }
    refreshData();
  }, [selectedProjectId, selectedObjectId, estimateType, activeSubTab]);

  const refreshData = () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');

    const params = {
      project_id: selectedProjectId,
      object_id: selectedObjectId,
      estimate_type: estimateType
    };

    if (activeSubTab === 'materials') {
      // Загружаем материалы — количество и период считаются автоматически на сервере
      api.get('/gpm/materials', { params })
        .then(res => {
          if (!res.data?.doc) {
            setHasActualEstimate(false);
            setMaterials([]);
          } else {
            setHasActualEstimate(true);
            setMaterials(res.data?.resources || []);
          }
        })
        .catch(err => setError(err.response?.data?.error || err.message))
        .finally(() => setLoading(false));
    } else {
      // Загружаем технику
      api.get('/gpm/machinery', { params })
        .then(res => {
          setMachinery(res.data || []);
          setHasGpr(res.data && res.data.length > 0);
        })
        .catch(err => setError(err.response?.data?.error || err.message))
        .finally(() => setLoading(false));
    }
  };


  // Вычисление уникальных работ для фильтрации во вкладке техники
  const uniqueMachineryWorks = useMemo(() => {
    const works = new Set();
    machinery.forEach(item => {
      if (item.work_name) works.add(item.work_name);
    });
    return Array.from(works);
  }, [machinery]);

  // Фильтрация списка техники
  const filteredMachinery = useMemo(() => {
    return machinery.filter(item => {
      const nameMatch = item.name.toLowerCase().includes(machinerySearch.toLowerCase());
      const workMatch = machineryWorkFilter === 'all' || item.work_name === machineryWorkFilter;
      
      let dateMatch = true;
      if (machineryStartDate) {
        dateMatch = dateMatch && item.start_date >= machineryStartDate;
      }
      if (machineryEndDate) {
        dateMatch = dateMatch && item.end_date <= machineryEndDate;
      }

      return nameMatch && workMatch && dateMatch;
    });
  }, [machinery, machinerySearch, machineryWorkFilter, machineryStartDate, machineryEndDate]);

  // Вычисление пиковой потребности (интервалы пересечений)
  const peakDemands = useMemo(() => {
    const resPeak = {};

    const groups = {};
    filteredMachinery.forEach(item => {
      if (!groups[item.name]) groups[item.name] = [];
      groups[item.name].push(item);
    });

    Object.entries(groups).forEach(([name, allocations]) => {
      const events = [];
      allocations.forEach(alloc => {
        events.push({ time: new Date(alloc.start_date).getTime(), type: 1, qty: alloc.quantity });
        const endDayNext = new Date(alloc.end_date);
        endDayNext.setDate(endDayNext.getDate() + 1);
        events.push({ time: endDayNext.getTime(), type: -1, qty: alloc.quantity });
      });

      events.sort((a, b) => {
        if (a.time === b.time) return a.type - b.type;
        return a.time - b.time;
      });

      let currentQty = 0;
      let maxQty = 0;
      let peakStart = null;
      let peakEnd = null;
      let lastTime = null;

      events.forEach(e => {
        if (lastTime !== null && currentQty > 0) {
          if (currentQty === maxQty && maxQty > 0) {
            peakEnd = e.time;
          }
        }

        currentQty += e.type * e.qty;

        if (currentQty > maxQty) {
          maxQty = currentQty;
          peakStart = e.time;
          peakEnd = null;
        } else if (currentQty < maxQty && maxQty > 0 && peakStart !== null && peakEnd === null) {
          peakEnd = e.time;
        }

        lastTime = e.time;
      });

      let peakPeriodStr = '—';
      if (peakStart) {
        const startD = new Date(peakStart).toISOString().split('T')[0];
        const endD = peakEnd ? new Date(peakEnd - 86400000).toISOString().split('T')[0] : startD;
        peakPeriodStr = startD === endD ? formatDateRu(startD) : `${formatDateRu(startD)} – ${formatDateRu(endD)}`;
      }

      resPeak[name] = {
        peak_qty: maxQty,
        period: peakPeriodStr,
        unit: allocations[0]?.unit || 'шт.'
      };
    });

    return resPeak;
  }, [filteredMachinery]);

  const showContent = selectedProjectId !== '' && selectedObjectId !== '' && estimateType !== '';

  const getPageTitle = () => {
    return t.gpmPageTitle || 'График потребности в материалах';
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

  const selectStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    background: 'white',
    fontWeight: '600',
    color: '#1e293b',
    outline: 'none'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '20px 20px 40px 20px', fontFamily: 'inherit' }}>
      
      {/* Page Title */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.5px' }}>
          {getPageTitle()}
        </h1>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '16px',
        padding: '20px',
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
      }}>
        {/* Project Selector */}
        <div>
          <label style={labelStyle}>{t.lblProject || 'Проект'}</label>
          <select
            style={selectStyle}
            value={selectedProjectId}
            onChange={e => {
              setSelectedProjectId(e.target.value);
              setSelectedObjectId('');
              setEstimateType('');
              setMaterials([]);
              setMachinery([]);
            }}
          >
            <option value="">-- {t.lblSelectProject || (lang === 'en' ? 'Select Project' : lang === 'ka' ? 'აირჩიეთ პროექტი' : lang === 'az' ? 'Layihə seçin' : 'Выберите проект')} --</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name}</option>
            ))}
          </select>
        </div>

        {/* Object Selector */}
        <div>
          <label style={labelStyle}>{t.lblObject || (lang === 'en' ? 'Object' : lang === 'ka' ? 'ობიექტი' : lang === 'az' ? 'Obyekt' : 'Объект')}</label>
          <select
            style={selectStyle}
            value={selectedObjectId}
            onChange={e => {
              setSelectedObjectId(e.target.value);
              setEstimateType('');
            }}
            disabled={!selectedProjectId}
          >
            <option value="">-- {t.lblSelectObject || (lang === 'en' ? 'Select Object' : lang === 'ka' ? 'აირჩიეთ ობიექტი' : lang === 'az' ? 'Obyekt seçin' : 'Выберите объект')} --</option>
            {objects.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        {/* Estimate Type Selector */}
        <div>
          <label style={labelStyle}>{t.estimateTypeLabel || (lang === 'en' ? 'Estimate Type' : lang === 'ka' ? 'ხარჯთაღრიცხვის ტიპი' : lang === 'az' ? 'Smeta növü' : 'Тип сметы')}</label>
          <select
            style={selectStyle}
            value={estimateType}
            onChange={e => setEstimateType(e.target.value)}
            disabled={!selectedObjectId}
          >
            <option value="">-- {t.lblSelectEstimateType || (lang === 'en' ? 'Select Type' : lang === 'ka' ? 'აირჩიეთ ტიპი' : lang === 'az' ? 'Növü seçin' : 'Выберите тип сметы')} --</option>
            <option value="planned">{t.estimateTypePlanned || (lang === 'en' ? 'Planned' : lang === 'ka' ? 'გეგმიური' : lang === 'az' ? 'Planlı' : 'Плановая')}</option>
            <option value="actual">{t.estimateTypeActual || (lang === 'en' ? 'Actual' : lang === 'ka' ? 'ფაქტიური' : lang === 'az' ? 'Faktiki' : 'Фактическая')}</option>
          </select>
        </div>
      </div>

      {!showContent ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '100px 40px',
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          textAlign: 'center',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
        }}>
          <Package size={56} color="#3b82f6" style={{ marginBottom: '20px', background: '#eff6ff', padding: '12px', borderRadius: '16px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>
            {t.gpmParamsNotSelected || 'Параметры не выбраны'}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '380px', lineHeight: '1.6' }}>
            {t.gpmParamsNotSelectedHint || 'Пожалуйста, выберите проект, объект и тип сметы в селекторах выше для планирования потребностей.'}
          </p>
        </div>
      ) : (
        <>
          {/* ── ТАБЫ: МАТЕРИАЛЫ / ТЕХНИКА ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
            <button
              onClick={() => setActiveSubTab('materials')}
              style={{
                padding: '10px 20px', borderRadius: 12, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                border: 'none',
                background: activeSubTab === 'materials' ? '#3b82f6' : 'transparent',
                color: activeSubTab === 'materials' ? '#fff' : '#64748b',
                transition: 'all .2s'
              }}
            >
              <Package size={16} />
              {t.gpmTabMaterials || 'Планирование потребности'}
            </button>

            <button
              onClick={() => setActiveSubTab('machinery')}
              style={{
                padding: '10px 20px', borderRadius: 12, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                border: 'none',
                background: activeSubTab === 'machinery' ? '#3b82f6' : 'transparent',
                color: activeSubTab === 'machinery' ? '#fff' : '#64748b',
                transition: 'all .2s'
              }}
            >
              <Truck size={16} />
              {t.gpmTabMachinery || 'Планирование техники'}
            </button>
          </div>

          {/* Сообщения об ошибках и успехе */}
          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 14, padding: '14px 18px', marginBottom: 20, color: '#dc2626', fontSize: 14, display: 'flex', gap: 8 }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {successMsg && (
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 14, padding: '14px 18px', marginBottom: 20, color: '#059669', fontSize: 14, display: 'flex', gap: 8 }}>
              <Check size={18} /> {successMsg}
            </div>
          )}

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 80, color: '#94a3b8' }}>
              <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} /> {t.gpmLoadingData || 'Загрузка данных...'}
            </div>
          ) : (
            <>
              {/* ── ВКЛАДКА 1: ПЛАНИРОВАНИЕ ПОТРЕБНОСТИ ── */}
              {activeSubTab === 'materials' && (
                <div>
                  {!hasActualEstimate ? (
                    /* Плейсхолдер: Фактическая смета не найдена */
                    <div style={{ 
                      textAlign: 'center', 
                      padding: '60px 20px', 
                      background: '#fff', 
                      borderRadius: 24, 
                      boxShadow: '0 4px 20px rgba(0,0,0,.04)', 
                      border: '1px solid #fca5a5',
                      marginBottom: 24
                    }}>
                      <AlertCircle size={48} style={{ color: '#dc2626', marginBottom: 16, opacity: 0.8 }} />
                      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>
                        {estimateType === 'planned' ? (t.gpmPlannedEstimateNotFound || 'Плановая смета не найдена') : (t.gpmActualEstimateNotFound || 'Фактическая смета не найдена')}
                      </h3>
                      <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
                        {estimateType === 'planned'
                          ? (t.gpmPlannedEstimateNotFoundHint || 'Для выбранного объекта отсутствует утвержденная плановая смета!')
                          : (t.gpmActualEstimateNotFoundHint || 'Для выбранного объекта отсутствует утвержденная фактическая смета!')}
                      </p>
                    </div>
                  ) : (
                    <div style={{ background: '#fff', borderRadius: 24, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,.04)', border: '1px solid #f1f5f9' }}>
                      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>
                        {t.gpmMaterialsTitle || 'Планирование потребности в материалах'}
                      </h3>

                      {materials.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                          <Info size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                          <div>{t.gpmNoMaterials || 'В смете отсутствуют материалы или смета не создана'}</div>
                        </div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', borderBottom: '2px solid #e2e8f0', textTransform: 'uppercase' }}>
                                <th style={{ padding: '12px', textAlign: 'left' }}>{t.gpmColResourceName || 'Материал'}</th>
                                <th style={{ padding: '12px', textAlign: 'center', width: 130 }}>{t.gpmColSource || 'Источник'}</th>
                                {estimateType === 'actual' && (
                                  <th style={{ padding: '12px', textAlign: 'right', width: 120 }}>{t.gpmColTransferred || 'Передано в план'}</th>
                                )}
                                <th style={{ padding: '12px', textAlign: 'right', width: 120 }}>{t.gpmColQuantity || 'Количество'}</th>
                                <th style={{ padding: '12px', textAlign: 'center', width: 80 }}>{t.gpmColUnit || 'Ед. изм.'}</th>
                                <th style={{ padding: '12px', textAlign: 'center', width: 220 }}>{t.gpmColPeriod || 'Период использования'}</th>
                                <th style={{ padding: '12px', textAlign: 'left' }}>{t.gpmColWork || 'Работа'}</th>
                                <th style={{ padding: '12px', textAlign: 'left' }}>{t.gpmColObject || 'Объект'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {materials.map(item => {
                                const isManual = item.source === 'manual';
                                return (
                                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '14px 12px', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                      {item.name}
                                    </td>
                                    <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                                      {isManual ? (
                                        <span style={{ background: '#fff7ed', color: '#ea580c', border: '1px solid #ffedd5', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
                                          {t.gpmSourceManual || 'Добавлен вручную'}
                                        </span>
                                      ) : (
                                        <span style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #dcfce7', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
                                          {t.gpmSourceNormative || 'Из нормы'}
                                        </span>
                                      )}
                                    </td>
                                    {estimateType === 'actual' && (
                                      <td style={{ padding: '14px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#475569' }}>
                                        {item.plan_quantity.toLocaleString('ru-RU')}
                                      </td>
                                    )}
                                    <td style={{ padding: '14px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                      {item.quantity.toLocaleString('ru-RU')}
                                    </td>
                                    <td style={{ padding: '14px 12px', textAlign: 'center', fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                      {item.unit}
                                    </td>
                                    <td style={{ padding: '14px 12px', textAlign: 'center', fontSize: 12, color: '#2563eb', fontWeight: 700 }}>
                                      {item.work_start_date ? `${formatDateRu(item.work_start_date)} – ${formatDateRu(item.work_end_date)}` : '—'}
                                    </td>
                                    <td style={{ padding: '14px 12px', fontSize: 12, color: '#475569' }}>
                                      {item.work_name}
                                    </td>
                                    <td style={{ padding: '14px 12px', fontSize: 12, color: '#64748b' }}>
                                      {objects.find(o => o.id === selectedObjectId)?.name || (t.gpmObjectFallback || 'Объект')}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── ВКЛАДКА 2: ПЛАНИРОВАНИЕ ТЕХНИКИ ── */}
              {activeSubTab === 'machinery' && (
                <div>
                  {!hasGpr ? (
                    /* Плейсхолдер: Календарный план не найден */
                    <div style={{ 
                      textAlign: 'center', 
                      padding: '60px 20px', 
                      background: '#fff', 
                      borderRadius: 24, 
                      boxShadow: '0 4px 20px rgba(0,0,0,.04)', 
                      border: '1px solid #fca5a5',
                      marginBottom: 24
                    }}>
                      <Calendar size={48} style={{ color: '#dc2626', marginBottom: 16, opacity: 0.8 }} />
                      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{t.gpmCalendarPlanNotFound || 'Календарный план не найден'}</h3>
                      <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
                        {t.gpmCalendarPlanNotFoundHint || 'Для выбранного объекта не заполнен календарный план (ГПР) или в нем не используется спецтехника!'}
                      </p>
                    </div>
                  ) : (
                    <>


                      {/* Фильтры и таблица */}
                      <div style={{ background: '#fff', borderRadius: 24, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,.04)', border: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                          <div>
                            <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>
                              {t.gpmMachineryTitle || 'Планирование потребности в технике'}
                            </h3>
                            <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
                              {t.gpmMachineryDesc || 'Календарное распределение строительных машин и механизмов по датам работ.'}
                            </p>
                          </div>
                        </div>

                        {/* Блок фильтров */}
                        <div style={{ 
                          background: '#f8fafc', 
                          borderRadius: 16, 
                          padding: '16px 20px', 
                          marginBottom: 20, 
                          display: 'flex', 
                          flexWrap: 'wrap', 
                          gap: 16,
                          alignItems: 'center'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, fontWeight: 700 }}>
                            <Filter size={16} /> {t.gpmFiltersLabel || 'Фильтры:'}
                          </div>

                          {/* Поиск техники */}
                          <div style={{ position: 'relative', flex: '0 0 160px' }}>
                            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                              type="text"
                              placeholder={t.gpmFilterMachinery || 'Фильтр техники...'}
                              value={machinerySearch}
                              onChange={e => setMachinerySearch(e.target.value)}
                              style={{
                                padding: '8px 12px 8px 34px',
                                fontSize: 13,
                                borderRadius: 10,
                                border: '1px solid #cbd5e1',
                                width: '100%',
                                outline: 'none',
                                boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          {/* Фильтр по работе */}
                          <select
                            value={machineryWorkFilter}
                            onChange={e => setMachineryWorkFilter(e.target.value)}
                            style={{
                              padding: '8px 12px',
                              fontSize: 13,
                              borderRadius: 10,
                              border: '1px solid #cbd5e1',
                              outline: 'none',
                              flex: '0 0 180px',
                              maxWidth: '180px',
                              background: '#fff',
                              boxSizing: 'border-box'
                            }}
                          >
                            <option value="all">{t.gpmAllWorksOption || 'Все работы'}</option>
                            {uniqueMachineryWorks.map(w => (
                              <option key={w} value={w}>{w}</option>
                            ))}
                          </select>

                          {/* Фильтр по датам */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="date"
                              value={machineryStartDate}
                              onChange={e => setMachineryStartDate(e.target.value)}
                              style={{ padding: '7px 10px', fontSize: 12, borderRadius: 10, border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                            />
                            <span style={{ color: '#cbd5e1' }}>–</span>
                            <input
                              type="date"
                              value={machineryEndDate}
                              onChange={e => setMachineryEndDate(e.target.value)}
                              style={{ padding: '7px 10px', fontSize: 12, borderRadius: 10, border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        </div>

                        {/* Таблица техники */}
                        {filteredMachinery.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                            <Info size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                            <div>{t.gpmNoMachinery || 'В календарном плане объекта отсутствуют работы с техникой'}</div>
                          </div>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', borderBottom: '2px solid #e2e8f0', textTransform: 'uppercase' }}>
                                  <th style={{ padding: '12px', textAlign: 'left' }}>{t.gpmColMachinery || 'Техника'}</th>
                                  <th style={{ padding: '12px', textAlign: 'center', width: 130 }}>{t.gpmColSource || 'Источник'}</th>
                                  {estimateType === 'actual' && (
                                    <th style={{ padding: '12px', textAlign: 'right', width: 120 }}>{t.gpmColTransferred || 'Передано в план'}</th>
                                  )}
                                  <th style={{ padding: '12px', textAlign: 'right', width: 120 }}>{t.gpmColQuantity || 'Количество'}</th>
                                  <th style={{ padding: '12px', textAlign: 'center', width: 80 }}>{t.gpmColUnit || 'Ед. изм.'}</th>
                                  <th style={{ padding: '12px', textAlign: 'center', width: 220 }}>{t.gpmColPeriod || 'Период использования'}</th>
                                  <th style={{ padding: '12px', textAlign: 'left' }}>{t.gpmColWork || 'Работа'}</th>
                                  <th style={{ padding: '12px', textAlign: 'left' }}>{t.gpmColObject || 'Объект'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredMachinery.map(item => (
                                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '14px 12px', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <Truck size={16} color="#64748b" />
                                        {item.name}
                                      </div>
                                    </td>
                                    <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                                      {item.source === 'manual' ? (
                                        <span style={{ background: '#fff7ed', color: '#ea580c', border: '1px solid #ffedd5', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
                                          {t.gpmSourceManual || 'Добавлен вручную'}
                                        </span>
                                      ) : (
                                        <span style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #dcfce7', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
                                          {t.gpmSourceNormative || 'Из нормы'}
                                        </span>
                                      )}
                                    </td>
                                    {estimateType === 'actual' && (
                                      <td style={{ padding: '14px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#475569' }}>
                                        {item.plan_quantity}
                                      </td>
                                    )}
                                    <td style={{ padding: '14px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                      {item.quantity}
                                    </td>
                                    <td style={{ padding: '14px 12px', textAlign: 'center', fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                      {item.unit}
                                    </td>
                                    <td style={{ padding: '14px 12px', textAlign: 'center', fontSize: 12, color: '#2563eb', fontWeight: 700 }}>
                                      {formatDateRu(item.start_date)} – {formatDateRu(item.end_date)}
                                    </td>
                                    <td style={{ padding: '14px 12px', fontSize: 12, color: '#475569' }}>
                                      {item.work_name}
                                    </td>
                                    <td style={{ padding: '14px 12px', fontSize: 12, color: '#64748b' }}>
                                      {objects.find(o => o.id === selectedObjectId)?.name || (t.gpmObjectFallback || 'Объект')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

    </div>
  );
}
