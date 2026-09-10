import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  FileText,
  ChevronRight,
  ChevronLeft,
  X,
  CheckCircle,
  FolderOpen,
  Trash2,
  Calendar,
  Copy
} from 'lucide-react';
import EstimateEditor from './EstimateEditor';

export default function EstimatesPage({ api, lang = 'ru', setLang, t = {}, userRole, onOpenScheduling, highlightEstimateId, onHighlightConsumed, onEstimateOpenChange }) {
  const [estimates, setEstimates] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [creatingEstimate, setCreatingEstimate] = useState(false);
  const [estimateTypeTab, setEstimateTypeTab] = useState('work'); // 'work' | 'planned' | 'actual'

  // Opened estimate in-place
  const [openedEstimateId, setOpenedEstimateId] = useState(null);

  useEffect(() => {
    if (onEstimateOpenChange) {
      onEstimateOpenChange(!!openedEstimateId);
    }
  }, [openedEstimateId, onEstimateOpenChange]);

  useEffect(() => {
    if (highlightEstimateId || userRole === 'financial_director') {
      setEstimateTypeTab('planned');
    }
  }, [highlightEstimateId, userRole]);

  useEffect(() => {
    api.get('/estimates/profile')
      .then(res => {
        if (res.data?.id) {
          setCurrentUserId(res.data.id);
        }
      })
      .catch(err => console.error('Error fetching profile:', err));
  }, [api]);

  // Filters state
  const [filterProject, setFilterProject] = useState('');
  const [filterObject, setFilterObject] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterPhase, setFilterPhase] = useState('');
  const [filterDiscipline, setFilterDiscipline] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Extract unique values from loaded estimates for filters
  const uniqueProjects = useMemo(() => {
    const list = new Set();
    estimates.forEach(est => {
      const name = est.projects?.name || est.project_id;
      if (name) list.add(name);
    });
    return Array.from(list).sort();
  }, [estimates]);

  const uniqueObjects = useMemo(() => {
    const list = new Set();
    estimates.forEach(est => {
      if (filterProject) {
        const projName = est.projects?.name || est.project_id;
        if (projName !== filterProject) return;
      }
      const name = est.project_objects?.name || est.object_id;
      if (name) list.add(name);
    });
    return Array.from(list).sort();
  }, [estimates, filterProject]);

  const uniqueZones = useMemo(() => {
    const list = new Set();
    estimates.forEach(est => {
      if (filterProject) {
        const projName = est.projects?.name || est.project_id;
        if (projName !== filterProject) return;
      }
      if (filterObject) {
        const objName = est.project_objects?.name || est.object_id;
        if (objName !== filterObject) return;
      }
      const zoneVal = est[`zone_${lang}`] || est.zone;
      if (zoneVal) list.add(zoneVal);
    });
    return Array.from(list).sort();
  }, [estimates, filterProject, filterObject, lang]);

  const uniquePhases = useMemo(() => {
    const list = new Set();
    estimates.forEach(est => {
      if (filterProject) {
        const projName = est.projects?.name || est.project_id;
        if (projName !== filterProject) return;
      }
      if (filterObject) {
        const objName = est.project_objects?.name || est.object_id;
        if (objName !== filterObject) return;
      }
      const zoneVal = est[`zone_${lang}`] || est.zone;
      if (filterZone && zoneVal !== filterZone) return;
      const phaseVal = est[`phase_${lang}`] || est.phase;
      if (phaseVal) list.add(phaseVal);
    });
    return Array.from(list).sort();
  }, [estimates, filterProject, filterObject, filterZone, lang]);

  const uniqueDisciplines = useMemo(() => {
    const list = new Set();
    estimates.forEach(est => {
      if (filterProject) {
        const projName = est.projects?.name || est.project_id;
        if (projName !== filterProject) return;
      }
      if (filterObject) {
        const objName = est.project_objects?.name || est.object_id;
        if (objName !== filterObject) return;
      }
      const zoneVal = est[`zone_${lang}`] || est.zone;
      if (filterZone && zoneVal !== filterZone) return;
      const phaseVal = est[`phase_${lang}`] || est.phase;
      if (filterPhase && phaseVal !== filterPhase) return;
      const discVal = est[`discipline_${lang}`] || est.discipline;
      if (discVal) list.add(discVal);
    });
    return Array.from(list).sort();
  }, [estimates, filterProject, filterObject, filterZone, filterPhase, lang]);

  // Reset dependent filters cascades
  useEffect(() => {
    setFilterObject('');
    setFilterZone('');
    setFilterPhase('');
    setFilterDiscipline('');
  }, [filterProject]);

  useEffect(() => {
    setFilterZone('');
    setFilterPhase('');
    setFilterDiscipline('');
  }, [filterObject]);

  useEffect(() => {
    setFilterPhase('');
    setFilterDiscipline('');
  }, [filterZone]);

  useEffect(() => {
    setFilterDiscipline('');
  }, [filterPhase]);

  // Computed filtered list of estimates
  const filteredEstimates = useMemo(() => {
    return estimates.filter(est => {
      if (userRole === 'financial_director') {
        if (est.estimate_type !== 'planned') return false;
        if (est.plan_approver_id !== currentUserId) return false;
        if (est.status !== 'planned_review') return false;
      } else {
        if (estimateTypeTab === 'work' && est.parent_doc_id) return false;
        if (estimateTypeTab === 'planned' && est.estimate_type !== 'planned') return false;
        if (estimateTypeTab === 'actual' && est.estimate_type !== 'actual') return false;
      }
      if (filterProject) {
        const name = est.projects?.name || est.project_id;
        if (name !== filterProject) return false;
      }
      if (filterObject) {
        const name = est.project_objects?.name || est.object_id;
        if (name !== filterObject) return false;
      }
      const zoneVal = est[`zone_${lang}`] || est.zone;
      if (filterZone && zoneVal !== filterZone) return false;
      const phaseVal = est[`phase_${lang}`] || est.phase;
      if (filterPhase && phaseVal !== filterPhase) return false;
      const discVal = est[`discipline_${lang}`] || est.discipline;
      if (filterDiscipline && discVal !== filterDiscipline) return false;
      if (filterStatus && String(est.status).toLowerCase() !== filterStatus.toLowerCase()) return false;
      if (filterDateFrom) {
        const estDate = new Date(est.date || est.created_at || est.created_at_original);
        const fromDate = new Date(filterDateFrom);
        fromDate.setHours(0, 0, 0, 0);
        if (estDate < fromDate) return false;
      }
      if (filterDateTo) {
        const estDate = new Date(est.date || est.created_at || est.created_at_original);
        const toDate = new Date(filterDateTo);
        toDate.setHours(23, 59, 59, 999);
        if (estDate > toDate) return false;
      }
      return true;
    });
  }, [estimates, estimateTypeTab, userRole, currentUserId, filterProject, filterObject, filterZone, filterPhase, filterDiscipline, filterStatus, filterDateFrom, filterDateTo, lang]);

  // Строка, на которую перешли по клику на уведомление, поднимается наверх списка
  const displayEstimates = useMemo(() => {
    if (!highlightEstimateId) return filteredEstimates;
    return [...filteredEstimates].sort((a, b) => {
      if (a.id === highlightEstimateId) return -1;
      if (b.id === highlightEstimateId) return 1;
      return 0;
    });
  }, [filteredEstimates, highlightEstimateId]);



  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [selectedZone, setSelectedZone] = useState('');
  const [selectedPhase, setSelectedPhase] = useState('');
  const [selectedDiscipline, setSelectedDiscipline] = useState('');

  const [objects, setObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);

  // DB templates dropdown states
  const [dbZones, setDbZones] = useState([]);
  const [dbPhases, setDbPhases] = useState([]);
  const [dbDisciplines, setDbDisciplines] = useState([]);

  const [selectedZoneId, setSelectedZoneId] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [selectedDisciplineId, setSelectedDisciplineId] = useState('');

  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [loadingDisciplines, setLoadingDisciplines] = useState(false);

  useEffect(() => {
    fetchEstimates();
    fetchProjects();
  }, [openedEstimateId]); // Refresh list when returning from editor

  useEffect(() => {
    if (selectedProjectId) {
      fetchObjects(selectedProjectId);
    } else {
      setObjects([]);
      setSelectedObjectId('');
    }
  }, [selectedProjectId]);

  // Cascade WBS dropdowns
  useEffect(() => {
    if (showWizard) {
      fetchZones();
    }
  }, [showWizard]);

  useEffect(() => {
    if (selectedZoneId) {
      fetchPhases(selectedZoneId);
    } else {
      setDbPhases([]);
      setSelectedPhaseId('');
      setSelectedPhase('');
    }
  }, [selectedZoneId]);

  useEffect(() => {
    if (selectedPhaseId) {
      fetchDisciplines(selectedPhaseId);
    } else {
      setDbDisciplines([]);
      setSelectedDisciplineId('');
      setSelectedDiscipline('');
    }
  }, [selectedPhaseId]);

  const fetchEstimates = async () => {
    setLoading(true);
    try {
      const res = await api.get('/estimates/all-test');
      setEstimates(res.data || []);
    } catch (err) {
      console.error('Ошибка загрузки смет:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await api.get('/estimates/projects');
      // Only approved projects
      const approved = (res.data || []).filter(p => p.status === 'approved');
      setProjects(approved);
    } catch (err) {
      console.error('Ошибка загрузки проектов:', err);
    }
  };

  const fetchObjects = async (projId) => {
    setLoadingObjects(true);
    try {
      const res = await api.get(`/estimates/projects/${projId}/objects`);
      setObjects(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedObjectId(res.data[0].id);
      } else {
        setSelectedObjectId('');
      }
    } catch (err) {
      console.error('Ошибка загрузки объектов:', err);
      setObjects([]);
      setSelectedObjectId('');
    } finally {
      setLoadingObjects(false);
    }
  };

  const fetchZones = async () => {
    setLoadingZones(true);
    try {
      const res = await api.get('/estimates/wbs-templates/zones');
      setDbZones(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedZoneId(res.data[0].id);
        const nameField = `name_${lang}`;
        setSelectedZone(res.data[0][nameField] || res.data[0].name_ru);
      } else {
        setSelectedZoneId('');
        setSelectedZone('');
      }
    } catch (err) {
      console.error('Error fetching zones:', err);
    } finally {
      setLoadingZones(false);
    }
  };

  const fetchPhases = async (zoneId) => {
    setLoadingPhases(true);
    try {
      const res = await api.get(`/estimates/wbs-templates/children?parent_id=${zoneId}`);
      setDbPhases(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedPhaseId(res.data[0].id);
        const nameField = `name_${lang}`;
        setSelectedPhase(res.data[0][nameField] || res.data[0].name_ru);
      } else {
        setSelectedPhaseId('');
        setSelectedPhase('');
      }
    } catch (err) {
      console.error('Error fetching phases:', err);
    } finally {
      setLoadingPhases(false);
    }
  };

  const fetchDisciplines = async (phaseId) => {
    setLoadingDisciplines(true);
    try {
      const res = await api.get(`/estimates/wbs-templates/children?parent_id=${phaseId}`);
      setDbDisciplines(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedDisciplineId(res.data[0].id);
        const nameField = `name_${lang}`;
        setSelectedDiscipline(res.data[0][nameField] || res.data[0].name_ru);
      } else {
        setSelectedDisciplineId('');
        setSelectedDiscipline('');
      }
    } catch (err) {
      console.error('Error fetching disciplines:', err);
    } finally {
      setLoadingDisciplines(false);
    }
  };

  const handleZoneChange = (zoneId) => {
    setSelectedZoneId(zoneId);
    const zNode = dbZones.find(z => z.id === zoneId);
    const nameField = `name_${lang}`;
    setSelectedZone(zNode ? (zNode[nameField] || zNode.name_ru) : '');
  };

  const handlePhaseChange = (phaseId) => {
    setSelectedPhaseId(phaseId);
    const pNode = dbPhases.find(p => p.id === phaseId);
    const nameField = `name_${lang}`;
    setSelectedPhase(pNode ? (pNode[nameField] || pNode.name_ru) : '');
  };

  const handleDisciplineChange = (discId) => {
    setSelectedDisciplineId(discId);
    if (!discId) {
      setSelectedDiscipline('');
    } else {
      const dNode = dbDisciplines.find(d => d.id === discId);
      const nameField = `name_${lang}`;
      setSelectedDiscipline(dNode ? (dNode[nameField] || dNode.name_ru) : '');
    }
  };

  const handleStartWizard = () => {
    setSelectedProjectId(projects[0]?.id || '');
    setSelectedObjectId('');
    setSelectedZoneId('');
    setSelectedPhaseId('');
    setSelectedDisciplineId('');
    setSelectedZone('');
    setSelectedPhase('');
    setSelectedDiscipline('');
    setWizardStep(1);
    setShowWizard(true);
  };

  const handleCreateDetailedEstimate = async () => {
    if (creatingEstimate) return;
    if (!selectedProjectId || !selectedObjectId || !selectedZoneId || !selectedPhaseId) {
      alert('Заполните все обязательные поля');
      return;
    }

    // Resolve display names from IDs dynamically
    const nameField = `name_${lang}`;
    const zNode = dbZones.find(z => z.id === selectedZoneId);
    const resolvedZone = zNode ? (zNode[nameField] || zNode.name_ru) : '';

    const pNode = dbPhases.find(p => p.id === selectedPhaseId);
    const resolvedPhase = pNode ? (pNode[nameField] || pNode.name_ru) : '';

    const dNode = dbDisciplines.find(d => d.id === selectedDisciplineId);
    const resolvedDiscipline = dNode ? (dNode[nameField] || dNode.name_ru) : '';

    if (!resolvedZone || !resolvedPhase) {
      alert('Ошибка: не удалось определить название зоны или фазы');
      return;
    }

    setCreatingEstimate(true);
    try {
      // Use existing endpoint
      const res = await api.post(`/estimates/projects/${selectedProjectId}/create-estimate`, {
        objectId: selectedObjectId === 'legacy' ? null : selectedObjectId,
        zone: resolvedZone,
        phase: resolvedPhase,
        discipline: resolvedDiscipline || null,
        lang: lang
      });

      if (res.data && res.data.id) {
        const estId = res.data.id;
        setShowWizard(false);
        setOpenedEstimateId(estId);
      }
    } catch (err) {
      alert('Ошибка создания сметы: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreatingEstimate(false);
    }
  };

  const PLAN_STATUS_STYLES = {
    planned_formed: { bg: '#eff6ff', color: '#2563eb', label: 'Сформирована' },
    planned_review: { bg: '#fff7ed', color: '#ea580c', label: 'На утверждении' },
    planned_approved: { bg: '#ecfdf5', color: '#16a34a', label: 'Утверждена' },
    planned_rejected: { bg: '#fef2f2', color: '#dc2626', label: 'Отклонена' },
    planned_inactive: { bg: '#f8fafc', color: '#94a3b8', label: 'Деактивирована' }
  };

  const getStatusBadge = (status, planVersion) => {
    const s = String(status).toLowerCase();
    if (s === 'approved') {
      return (
        <span style={{ background: '#ecfdf5', color: '#059669', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
          {(t.estPageStatusApproved || 'Утверждено').toUpperCase()}
        </span>
      );
    } else if (s === 'pending') {
      return (
        <span style={{ background: '#fffbeb', color: '#d97706', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
          {t.estPageStatusPending || 'На согласовании'}
        </span>
      );
    } else if (PLAN_STATUS_STYLES[s]) {
      const { bg, color, label } = PLAN_STATUS_STYLES[s];
      return (
        <span style={{ background: bg, color, padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      );
    } else {
      return (
        <span style={{ background: '#f1f5f9', color: '#64748b', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
          {(t.estPageStatusDraft || 'Черновик').toUpperCase()}
        </span>
      );
    }
  };

  const renderWizardContent = () => {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
      }}>
        <div style={{
          background: '#ffffff', borderRadius: '24px', width: '850px', maxWidth: '95%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
          display: 'flex', overflow: 'hidden', border: '1px solid #e2e8f0', minHeight: '480px'
        }}>
          {/* Left Main Form */}
          <div style={{ flex: 1, padding: '40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>{t.estWizardTitle || 'Создание сметы'}</h3>
                <button onClick={() => setShowWizard(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  <X size={20} />
                </button>
              </div>

              {/* STEP 1: PROJECT */}
              {wizardStep === 1 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>{t.estWizardStepProject || 'Проект'} *</label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* STEP 2: OBJECT */}
              {wizardStep === 2 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>{t.estWizardStepObject || 'Объект'} *</label>
                  {loadingObjects ? (
                    <div style={{ padding: '10px', color: '#64748b', fontSize: '14px' }}>{t.estWizardLoadingObjects || 'Загрузка объектов...'}</div>
                  ) : objects.length === 0 ? (
                    <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', fontSize: '14px' }}>
                      {t.estWizardNoObjects || 'В выбранном проекте нет объектов. Пожалуйста, сначала создайте объект в деталях проекта.'}
                    </div>
                  ) : (
                    <select
                      value={selectedObjectId}
                      onChange={(e) => setSelectedObjectId(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
                    >
                      {objects.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* STEP 3: ZONE */}
              {wizardStep === 3 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>{t.estWizardStepZone || 'Зона'} *</label>
                  {loadingZones ? (
                    <div style={{ padding: '10px', color: '#64748b', fontSize: '14px' }}>{t.estWizardLoadingZones || 'Загрузка зон...'}</div>
                  ) : dbZones.length === 0 ? (
                    <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', fontSize: '14px' }}>
                      {t.estWizardNoZones || 'Шаблоны зон не найдены в базе данных.'}
                    </div>
                  ) : (
                    <select
                      value={selectedZoneId}
                      onChange={(e) => handleZoneChange(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
                    >
                      {dbZones.map(z => {
                        const nameField = `name_${lang}`;
                        return (
                          <option key={z.id} value={z.id}>{z[nameField] || z.name_ru}</option>
                        );
                      })}
                    </select>
                  )}
                </div>
              )}

              {/* STEP 4: PHASE */}
              {wizardStep === 4 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>{t.estWizardStepPhase || 'Фаза'} *</label>
                  {loadingPhases ? (
                    <div style={{ padding: '10px', color: '#64748b', fontSize: '14px' }}>{t.estWizardLoadingPhases || 'Загрузка фаз...'}</div>
                  ) : dbPhases.length === 0 ? (
                    <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', fontSize: '14px' }}>
                      {t.estWizardNoPhases || 'В выбранной зоне нет фаз в шаблоне.'}
                    </div>
                  ) : (
                    <select
                      value={selectedPhaseId}
                      onChange={(e) => handlePhaseChange(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
                    >
                      {dbPhases.map(p => {
                        const nameField = `name_${lang}`;
                        return (
                          <option key={p.id} value={p.id}>{p[nameField] || p.name_ru}</option>
                        );
                      })}
                    </select>
                  )}
                </div>
              )}

              {/* STEP 5: DISCIPLINE */}
              {wizardStep === 5 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>{t.estWizardStepDiscipline || 'Дисциплина (необязательно)'}</label>
                  {loadingDisciplines ? (
                    <div style={{ padding: '10px', color: '#64748b', fontSize: '14px' }}>{t.estWizardLoadingDisciplines || 'Загрузка дисциплин...'}</div>
                  ) : (
                    <select
                      value={selectedDisciplineId}
                      onChange={(e) => handleDisciplineChange(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
                    >
                      <option value="">{t.estWizardSelectDisciplinePlaceholder || '-- Все дисциплины --'}</option>
                      {dbDisciplines.map(d => {
                        const nameField = `name_${lang}`;
                        return (
                          <option key={d.id} value={d.id}>{d[nameField] || d.name_ru}</option>
                        );
                      })}
                    </select>
                  )}
                  <p style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>{t.estWizardDisciplineNote || 'Можно оставить пустым, чтобы включить все дисциплины в смету.'}</p>
                </div>
              )}

              {/* STEP 6: CONFIRMATION */}
              {wizardStep === 6 && (
                <div>
                  <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
                      <div><strong style={{ color: '#475569' }}>{t.estWizardStepProject || 'Проект'}:</strong> <span style={{ color: '#0f172a', fontWeight: '600' }}>{projects.find(p => p.id === selectedProjectId)?.name}</span></div>
                      <div><strong style={{ color: '#475569' }}>{t.estWizardStepObject || 'Объект'}:</strong> <span style={{ color: '#0f172a', fontWeight: '600' }}>{objects.find(o => o.id === selectedObjectId)?.name}</span></div>
                      <div><strong style={{ color: '#475569' }}>{t.estWizardStepZone || 'Зона'}:</strong> <span style={{ color: '#0f172a', fontWeight: '600' }}>{selectedZone}</span></div>
                      <div><strong style={{ color: '#475569' }}>{t.estWizardStepPhase || 'Фаза'}:</strong> <span style={{ color: '#0f172a', fontWeight: '600' }}>{selectedPhase}</span></div>
                      <div><strong style={{ color: '#475569' }}>{t.estWizardStepDiscipline || 'Дисциплина'}:</strong> <span style={{ color: '#0f172a', fontWeight: '600' }}>{selectedDiscipline || (t.estWizardSelectDisciplinePlaceholder ? t.estWizardSelectDisciplinePlaceholder.replace(/[^\w\sа-яёА-ЯЁ\-]/g, '').trim() : 'Все дисциплины')}</span></div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb', background: '#eff6ff', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                    <CheckCircle size={16} />
                    <span>{t.estWizardConfirmText || 'Будет создана смета для выбранной зоны, фазы и дисциплины.'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '30px' }}>
              <div>
                {wizardStep > 1 && (
                  <button
                    onClick={() => setWizardStep(prev => prev - 1)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '10px 18px', borderRadius: '8px', border: '1px solid #cbd5e1',
                      background: '#ffffff', color: '#475569', fontSize: '14px', fontWeight: '600', cursor: 'pointer'
                    }}
                  >
                    <ChevronLeft size={16} /> {t.estWizardBtnBack || 'Назад'}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowWizard(false)}
                  style={{
                    padding: '10px 18px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    background: '#ffffff', color: '#64748b', fontSize: '14px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  {t.btnCancel || 'Отмена'}
                </button>
                
                {wizardStep < 6 ? (
                  <button
                    onClick={() => setWizardStep(prev => prev + 1)}
                    disabled={
                      (wizardStep === 2 && objects.length === 0) ||
                      (wizardStep === 3 && dbZones.length === 0) ||
                      (wizardStep === 4 && dbPhases.length === 0)
                    }
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '10px 18px', borderRadius: '8px', border: 'none',
                      background: (
                        (wizardStep === 2 && objects.length === 0) ||
                        (wizardStep === 3 && dbZones.length === 0) ||
                        (wizardStep === 4 && dbPhases.length === 0)
                      ) ? '#cbd5e1' : '#2563eb',
                      color: '#ffffff', fontSize: '14px', fontWeight: '600', cursor: 'pointer'
                    }}
                  >
                    {t.estWizardBtnNext || 'Далее'} <ChevronRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={handleCreateDetailedEstimate}
                    disabled={creatingEstimate}
                    style={{
                      padding: '10px 22px', borderRadius: '8px', border: 'none',
                      background: creatingEstimate ? '#94a3b8' : '#2563eb', color: '#ffffff', fontSize: '14px', fontWeight: '700', cursor: 'pointer'
                    }}
                  >
                    {creatingEstimate ? (t.estEdSavingText || 'Обработка...') : (t.estWizardBtnCreate || 'Создать')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar Steps Indicator */}
          <div style={{ width: '240px', background: '#f8fafc', borderLeft: '1px solid #e2e8f0', padding: '40px 24px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '20px', letterSpacing: '0.05em' }}>{t.estWizardStepsTitle || 'Шаги создания сметы'}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {[
                { step: 1, label: t.estWizardStepProject || 'Проект' },
                { step: 2, label: t.estWizardStepObject || 'Объект' },
                { step: 3, label: t.estWizardStepZone || 'Зона' },
                { step: 4, label: t.estWizardStepPhase || 'Фаза' },
                { step: 5, label: t.estWizardStepDiscipline || 'Дисциплина (необязательно)' },
                { step: 6, label: t.estWizardStepConfirm || 'Подтверждение' }
              ].map(s => {
                const isActive = wizardStep === s.step;
                const isCompleted = wizardStep > s.step;
                
                return (
                  <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: '700',
                      background: isActive ? '#2563eb' : isCompleted ? '#eff6ff' : '#e2e8f0',
                      color: isActive ? '#ffffff' : isCompleted ? '#2563eb' : '#64748b',
                      border: isActive ? 'none' : isCompleted ? '1.5px solid #2563eb' : 'none'
                    }}>
                      {s.step}
                    </div>
                    <span style={{
                      fontSize: '13px',
                      fontWeight: isActive ? '700' : '500',
                      color: isActive ? '#0f172a' : isCompleted ? '#475569' : '#94a3b8'
                    }}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (openedEstimateId) {
    return (
      <div style={{ marginTop: '10px' }}>
        <EstimateEditor
          docId={openedEstimateId}
          userRole={userRole}
          currentUserId={currentUserId}
          resourceLanguage={lang}
          setResourceLanguage={setLang}
          onBack={() => setOpenedEstimateId(null)}
          onOpenScheduling={onOpenScheduling}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minHeight: '600px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>{t.estPageTitle || 'Сметы'}</h2>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>{t.estPageSubtitle || 'Управление сметными расчетами и пошаговое создание'}</p>
        </div>
        {userRole !== 'financial_director' && (
          <button
            onClick={handleStartWizard}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 18px', background: '#2563eb', color: '#ffffff',
              border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700',
              cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.15)'
            }}
          >
            <Plus size={16} /> {t.estPageCreateBtn || 'Создать смету'}
          </button>
        )}
      </div>

      {userRole !== 'financial_director' && (
        <div style={{ display: 'flex', gap: '6px', background: '#f1f5f9', padding: '4px', borderRadius: '12px', width: 'fit-content' }}>
          {[
            { id: 'work', label: t.estPageTabWork || 'Рабочая версия' },
            { id: 'planned', label: t.estPageTabPlanned || 'Плановая версия' },
            { id: 'actual', label: t.estPageTabActual || 'Фактическая версия' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setEstimateTypeTab(tab.id)}
              style={{
                padding: '8px 16px',
                borderRadius: '9px',
                border: 'none',
                background: estimateTypeTab === tab.id ? '#2563eb' : 'transparent',
                color: estimateTypeTab === tab.id ? 'white' : '#475569',
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: '#64748b' }}>{t.loadingEstimate || 'Загрузка смет...'}</div>
      ) : estimates.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '80px 40px', background: '#ffffff', borderRadius: '16px', border: '1px dashed #cbd5e1', textAlign: 'center'
        }}>
          <FolderOpen size={48} color="#94a3b8" style={{ marginBottom: '16px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '6px' }}>{t.dictNotFound || 'Нет данных'}</h3>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '320px', marginBottom: '20px' }}>
            {t.estPageNoData || 'В системе еще не создано ни одной сметы. Нажмите «Создать смету», чтобы запустить пошаговый мастер.'}
          </p>
        </div>
      ) : (
        <>
          {/* Filters Card */}
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1.5px solid #cbd5e1',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            marginBottom: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: '800', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🔍 {t.estPageFiltersTitle || 'Фильтрация списка смет'}
              </span>
              {(filterProject || filterObject || filterZone || filterPhase || filterDiscipline || filterStatus || filterDateFrom || filterDateTo) && (
                <button
                  onClick={() => {
                    setFilterProject('');
                    setFilterObject('');
                    setFilterZone('');
                    setFilterPhase('');
                    setFilterDiscipline('');
                    setFilterStatus('');
                    setFilterDateFrom('');
                    setFilterDateTo('');
                  }}
                  style={{
                    background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                  }}
                >
                  <X size={14} /> {t.estPageBtnReset || 'Сбросить фильтры'}
                </button>
              )}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
              {/* Project */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageColProject || 'Проект'}</label>
                <select
                  value={filterProject}
                  onChange={(e) => setFilterProject(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                >
                  <option value="">{t.estPageFilterAllProjects || 'Все проекты'}</option>
                  {uniqueProjects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Object */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageColObject || 'Объект'}</label>
                <select
                  value={filterObject}
                  onChange={(e) => setFilterObject(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                >
                  <option value="">{t.estPageFilterAllObjects || 'Все объекты'}</option>
                  {uniqueObjects.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>

              {/* Zone */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageColZone || 'Зона'}</label>
                <select
                  value={filterZone}
                  onChange={(e) => setFilterZone(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                >
                  <option value="">{t.estPageFilterAllZones || 'Все зоны'}</option>
                  {uniqueZones.map(z => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>

              {/* Phase */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageColPhase || 'Фаза'}</label>
                <select
                  value={filterPhase}
                  onChange={(e) => setFilterPhase(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                >
                  <option value="">{t.estPageFilterAllPhases || 'Все фазы'}</option>
                  {uniquePhases.map(ph => (
                    <option key={ph} value={ph}>{ph}</option>
                  ))}
                </select>
              </div>

              {/* Discipline */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageColDiscipline || 'Дисциплина'}</label>
                <select
                  value={filterDiscipline}
                  onChange={(e) => setFilterDiscipline(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                >
                  <option value="">{t.estPageFilterAllDisciplines || 'Все дисциплины'}</option>
                  {uniqueDisciplines.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageColStatus || 'Статус'}</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                >
                  <option value="">{t.estPageFilterAllStatuses || 'Все статусы'}</option>
                  <option value="draft">{t.estPageStatusDraft || 'Черновик'}</option>
                  <option value="pending">{t.estPageStatusPending || 'На согласовании'}</option>
                  <option value="approved">{t.estPageStatusApproved || 'Утверждено'}</option>
                </select>
              </div>

              {/* Date From */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageFilterDateFrom || 'Дата создания (от)'}</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  style={{ width: '100%', padding: '7px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none', color: '#334155' }}
                />
              </div>

              {/* Date To */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '4px' }}>{t.estPageFilterDateTo || 'Дата создания (до)'}</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  style={{ width: '100%', padding: '7px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none', color: '#334155' }}
                />
              </div>
            </div>
          </div>

          {filteredEstimates.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '60px 40px', background: '#ffffff', borderRadius: '16px', border: '1px dashed #cbd5e1', textAlign: 'center', marginTop: '10px'
            }}>
              <FolderOpen size={40} color="#cbd5e1" style={{ marginBottom: '12px' }} />
              <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>{t.dictNotFound || 'Нет результатов'}</h3>
              <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '340px', marginBottom: '16px' }}>
                {t.estPageNoResults || 'По выбранным параметрам фильтрации не найдено ни одной сметы.'}
              </p>
              <button
                onClick={() => {
                  setFilterProject('');
                  setFilterObject('');
                  setFilterZone('');
                  setFilterPhase('');
                  setFilterDiscipline('');
                  setFilterStatus('');
                  setFilterDateFrom('');
                  setFilterDateTo('');
                }}
                style={{
                  padding: '8px 16px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer'
                }}
              >
                {t.estPageBtnReset || 'Сбросить фильтры'}
              </button>
            </div>
          ) : (
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569', width: '50px' }}>{t.estPageColNo || '№'}</th>
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColName || 'Наименование сметы'}</th>
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColProject || 'Проект'}</th>
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColObject || 'Объект'}</th>
                    {estimateTypeTab !== 'planned' && (
                      <>
                        <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColZone || 'Зона'}</th>
                        <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColPhase || 'Фаза'}</th>
                        <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColDiscipline || 'Дисциплина'}</th>
                      </>
                    )}
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>
                      {estimateTypeTab === 'planned' ? (t.estPageColSubmittedDate || 'Дата отправки') : (t.estPageColDate || 'Дата создания')}
                    </th>
                    {estimateTypeTab === 'planned' && (
                      <>
                        <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569', textAlign: 'center' }}>{t.estPageColVersion || 'Версия'}</th>
                        <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>{t.estPageColAuthor || 'Ответственный'}</th>
                        <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569', textAlign: 'right' }}>{t.estPageColTotalAmount || 'Итог. стоимость'}</th>
                      </>
                    )}
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569', textAlign: 'center' }}>{t.estPageColStatus || 'Статус'}</th>
                    <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '800', color: '#475569', textAlign: 'center', width: '100px' }}>{t.estPageColActions || 'Действия'}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayEstimates.map((est, index) => {
                    const meta = {
                      zone: est[`zone_${lang}`] || est.zone || '—',
                      phase: est[`phase_${lang}`] || est.phase || '—',
                      discipline: est[`discipline_${lang}`] || est.discipline || '—'
                    };

                    const projectCode = est.projects?.code || '—';
                    const projectName = est.projects?.name || est.project_id || '—';
                    const objectName = est.project_objects?.name || '—';

                    const rawDate = estimateTypeTab === 'planned'
                      ? est.plan_submitted_at
                      : (est.date || est.created_at || est.created_at_original);
                    const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('ru-RU') : '—';

                    const submitterName = est.plan_submitted_by_user
                      ? `${est.plan_submitted_by_user.first_name || ''} ${est.plan_submitted_by_user.last_name || ''}`.trim()
                      : '—';
                    const totalAmountFormatted = est.total_amount
                      ? `${new Intl.NumberFormat('ru-RU').format(est.total_amount)}`
                      : '—';

                    const estimateLabelWord = lang === 'en' ? 'Estimate' : lang === 'ka' ? 'ხარჯთაღრიცხვა' : lang === 'az' ? 'Smeta' : 'Смета';

                    const activePlan = estimates.find(p =>
                      p.parent_doc_id === est.id &&
                      ['planned_formed', 'planned_review', 'planned_approved'].includes(p.status)
                    );

                    const isHighlighted = est.id === highlightEstimateId;

                    return (
                      <tr
                        key={est.id}
                        onClick={() => {
                          if (isHighlighted && onHighlightConsumed) onHighlightConsumed();
                          setOpenedEstimateId(est.id);
                        }}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                          background: isHighlighted ? '#fef9c3' : 'transparent',
                          boxShadow: isHighlighted ? 'inset 0 0 0 2px #eab308' : 'none'
                        }}
                        onMouseEnter={(e) => { if (!isHighlighted) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isHighlighted ? '#fef9c3' : 'transparent'; }}
                      >
                        <td style={{ padding: '14px 20px', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                          {filteredEstimates.length - index}
                        </td>
                        <td style={{ padding: '14px 20px', fontSize: '13px', color: '#2563eb', fontWeight: '700' }}>
                          {estimateLabelWord} №СМ-000{10 + (filteredEstimates.length - index)}
                        </td>
                        <td style={{ padding: '14px 20px', fontSize: '13px', color: '#0f172a', fontWeight: '600' }}>
                          <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#64748b', padding: '2px 6px', borderRadius: '4px', marginRight: '6px', fontWeight: '700' }}>{projectCode}</span>
                          {projectName}
                        </td>
                        <td style={{ padding: '14px 20px', fontSize: '13px', color: '#475569' }}>
                          {objectName}
                        </td>
                        {estimateTypeTab !== 'planned' && (
                          <>
                            <td style={{ padding: '14px 20px', fontSize: '13px', color: '#475569' }}>
                              {meta.zone}
                            </td>
                            <td style={{ padding: '14px 20px', fontSize: '13px', color: '#475569' }}>
                              {meta.phase}
                            </td>
                            <td style={{ padding: '14px 20px', fontSize: '13px', color: '#475569' }}>
                              {meta.discipline}
                            </td>
                          </>
                        )}
                        <td style={{ padding: '14px 20px', fontSize: '13px', color: '#475569' }}>
                          {formattedDate}
                        </td>
                        {estimateTypeTab === 'planned' && (
                          <>
                            <td style={{ padding: '14px 20px', textAlign: 'center', fontSize: '13px', color: '#475569', fontWeight: '700' }}>
                              {est.plan_version ? `${t.estEdVersionShort || 'вер.'} ${est.plan_version}` : '—'}
                            </td>
                            <td style={{ padding: '14px 20px', fontSize: '13px', color: '#475569' }}>
                              {submitterName}
                            </td>
                            <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '13px', color: '#0f172a', fontWeight: '700' }}>
                              {totalAmountFormatted}
                            </td>
                          </>
                        )}
                        <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                          {getStatusBadge(est.status, est.plan_version)}
                        </td>
                        <td style={{ padding: '14px 20px', display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenedEstimateId(est.id);
                            }}
                            style={{
                              padding: '6px 12px', background: '#2563eb', color: 'white',
                              border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold',
                              cursor: 'pointer', transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#1d4ed8'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#2563eb'}
                          >
                            {t.estPageBtnOpen || 'Открыть'}
                          </button>
                          {onOpenScheduling && !est.parent_doc_id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenScheduling({
                                  projectId: est.project_uuid || est.projects?.id || null,
                                  objectId: est.object_id || null,
                                  estimateId: est.id
                                });
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '6px', background: '#16a34a', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s'
                              }}
                              title={t.tabScheduling || 'Календарное планирование'}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#15803d'}
                              onMouseLeave={(e) => e.currentTarget.style.background = '#16a34a'}
                            >
                              <Calendar size={14} />
                            </button>
                          )}
                          {activePlan && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenedEstimateId(activePlan.id);
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '6px', background: '#8b5cf6', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s'
                              }}
                              title={`${t.estEdPlanVersionLabel || 'Плановая ver.'} ${activePlan.plan_version}`}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#7c3aed'}
                              onMouseLeave={(e) => e.currentTarget.style.background = '#8b5cf6'}
                            >
                              <Copy size={14} />
                            </button>
                          )}
                          {est.status === 'draft' && (userRole === 'admin' || (est.created_by && est.created_by === currentUserId)) && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (window.confirm(t.deleteConfirm || 'Вы уверены, что хотите удалить смету НАВСЕГДА?')) {
                                  try {
                                    const delRes = await api.delete(`/estimates/${est.id}`);
                                    if (delRes.data?.success) {
                                      alert(t.deleteSuccess || 'Смета успешно удалена');
                                      fetchEstimates();
                                    } else {
                                      alert(t.deleteError || 'Ошибка при удалении сметы');
                                    }
                                  } catch (err) {
                                    console.error('Delete error:', err);
                                    alert(err.response?.data?.error || t.deleteError || 'Ошибка при удалении сметы');
                                  }
                                }
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '6px', background: '#ef4444', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s'
                              }}
                              title="Удалить смету"
                              onMouseEnter={(e) => e.currentTarget.style.background = '#dc2626'}
                              onMouseLeave={(e) => e.currentTarget.style.background = '#ef4444'}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {showWizard && renderWizardContent()}
    </div>
  );
}
