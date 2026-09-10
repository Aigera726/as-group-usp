import React, { useState, useEffect, useMemo, useRef } from 'react';
import html2pdf from 'html2pdf.js';
import CalendarPlanningPage from './CalendarPlanningPage';
import { 
  Calendar, CheckCircle2, AlertTriangle, Play, RefreshCw, 
  Download, Plus, Trash2, ChevronDown, ChevronRight, X, Info, FileText, ArrowLeft,
  Table, BarChart3, LayoutGrid
} from 'lucide-react';

const addDaysToDate = (dateStr, days) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  date.setDate(date.getDate() + parseInt(days, 10));
  return date.toISOString().split('T')[0];
};

const formatDateRu = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return dateStr;
};

const getDayOfWeekRu = (dateStr) => {
  if (!dateStr) return '';
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const date = new Date(dateStr);
  return days[date.getDay()];
};

const getDaysBetween = (startStr, endStr) => {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

const getExpectedPeriodsForWork = (work, method) => {
  if (!work || !work.start_date || !work.duration_days) return [];
  const start = new Date(work.start_date);
  const end = new Date(addDaysToDate(work.start_date, work.duration_days - 1));
  const duration = getDaysBetween(work.start_date, addDaysToDate(work.start_date, work.duration_days - 1));
  const periods = [];

  if (method === 'day') {
    for (let i = 0; i < duration; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dStr = d.toISOString().split('T')[0];
      periods.push({
        period_start: dStr,
        period_end: dStr
      });
    }
  } else if (method === 'month') {
    let current = new Date(start);
    while (current <= end) {
      const y = current.getFullYear();
      const m = current.getMonth();
      const mStart = new Date(y, m, 1);
      const mEnd = new Date(y, m + 1, 0);
      const actualStart = mStart < start ? start : mStart;
      const actualEnd = mEnd > end ? end : mEnd;
      periods.push({
        period_start: actualStart.toISOString().split('T')[0],
        period_end: actualEnd.toISOString().split('T')[0]
      });
      current.setMonth(current.getMonth() + 1);
      current.setDate(1);
    }
  } else if (method === 'week') {
    let current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      const daysToSun = day === 0 ? 0 : 7 - day;
      const wEnd = new Date(current);
      wEnd.setDate(current.getDate() + daysToSun);
      const actualEnd = wEnd > end ? end : wEnd;
      periods.push({
        period_start: current.toISOString().split('T')[0],
        period_end: actualEnd.toISOString().split('T')[0]
      });
      current = new Date(wEnd);
      current.setDate(wEnd.getDate() + 1);
    }
  }
  return periods;
};

const isDistributionOutOfSync = (work, distributions) => {
  if (!work) return false;
  const dists = (distributions || []).filter(d => d.work_id === work.id);
  if (dists.length === 0) return false;

  const method = dists[0].period_type;
  
  // Check 1: Are there any periods outside the work borders?
  const wStart = new Date(work.start_date);
  const wEnd = new Date(addDaysToDate(work.start_date, work.duration_days - 1));
  const hasOutOfBounds = dists.some(d => {
    if (!d.period_start || !d.period_end) return true;
    const pStart = new Date(d.period_start);
    const pEnd = new Date(d.period_end);
    return pStart < wStart || pEnd > wEnd;
  });
  if (hasOutOfBounds) return true;

  // Check 2: For deterministic methods, do the dates match the expected generated periods?
  if (method === 'day' || method === 'week' || method === 'month') {
    const expected = getExpectedPeriodsForWork(work, method);
    if (expected.length !== dists.length) return true;
    
    // Check if dates of each period match
    for (let i = 0; i < expected.length; i++) {
      const matching = dists.find(d => d.period_start === expected[i].period_start && d.period_end === expected[i].period_end);
      if (!matching) return true;
    }
  }
  
  return false;
};

const getGanttLinkPath = (x1, y1, x2, y2, type) => {
  if (type === 'FS') {
    if (x2 >= x1 + 10) {
      const xMid = x1 + 8;
      return `M ${x1} ${y1} H ${xMid} V ${y2} H ${x2}`;
    } else {
      const xMid1 = x1 + 8;
      const xMid2 = x2 - 8;
      const yMid = (y1 + y2) / 2;
      return `M ${x1} ${y1} H ${xMid1} V ${yMid} H ${xMid2} V ${y2} H ${x2}`;
    }
  } else if (type === 'SS') {
    const xMin = Math.min(x1, x2) - 8;
    return `M ${x1} ${y1} H ${xMin} V ${y2} H ${x2}`;
  } else if (type === 'FF') {
    const xMax = Math.max(x1, x2) + 8;
    return `M ${x1} ${y1} H ${xMax} V ${y2} H ${x2}`;
  } else if (type === 'SF') {
    if (x2 >= x1 + 10) {
      const xMid = (x1 + x2) / 2;
      return `M ${x1} ${y1} H ${xMid} V ${y2} H ${x2}`;
    } else {
      const xMid1 = x1 - 8;
      const xMid2 = x2 + 8;
      const yMid = (y1 + y2) / 2;
      return `M ${x1} ${y1} H ${xMid1} V ${yMid} H ${xMid2} V ${y2} H ${x2}`;
    }
  }
  return `M ${x1} ${y1} L ${x2} ${y2}`;
};

// Скрыто по просьбе заказчика в таблице "Распределение объемов работ" — при необходимости вернуть, поставить true
const SHOW_GPR_DIST_RESPONSIBLE_COLUMN = false;

export default function GprPage({ userRole, lang, t, api, initialTarget = null, onInitialTargetConsumed }) {
  const currentLang = lang || 'ru';

  const getVersionLabel = (doc) => {
    if (!doc) return '—';
    const type = doc.estimate_type || 'work';
    const status = doc.status || 'draft';
    const planVer = doc.plan_version;

    if (type === 'actual') {
      if (currentLang === 'ru') return 'Фактическая версия';
      if (currentLang === 'ka') return 'ფაქტობრივი ვერსია';
      if (currentLang === 'az') return 'Faktiki versiya';
      return 'Actual Version';
    }
    if (type === 'planned') {
      const verStr = planVer ? ` ${planVer}` : '';
      if (currentLang === 'ru') return `Плановая версия${verStr}`;
      if (currentLang === 'ka') return `საგეგმო ვერსია${verStr}`;
      if (currentLang === 'az') return `Planlaşdırılmış versiya${verStr}`;
      return `Planned Version${verStr}`;
    }
    // work type
    if (status === 'draft') {
      if (currentLang === 'ru') return 'Черновик';
      if (currentLang === 'ka') return 'შავნაწერი';
      if (currentLang === 'az') return 'Qaralama';
      return 'Draft';
    }
    if (currentLang === 'ru') return 'Рабочая версия';
    if (currentLang === 'ka') return 'სამუშაო ვერსია';
    if (currentLang === 'az') return 'İşçi versiya';
    return 'Working Version';
  };

  // Проекты и объекты
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [objects, setObjects] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [estimateType, setEstimateType] = useState('');
  const [gprData, setGprData] = useState(null);
  const isReadonly = gprData?.doc?.is_readonly || false;
  const [gprSubTab, setGprSubTab] = useState('calendar'); // 'calendar' | 'volume'
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [missingWorks, setMissingWorks] = useState([]);

  // Пошаговые состояния создания (Скриншоты 1-5)
  const [planCheckState, setPlanCheckState] = useState('none'); // 'none' | 'checking' | 'found_blue' | 'found_green'
  const [isFormingGpr, setIsFormingGpr] = useState(false);
  const [formingStep, setFormingStep] = useState(0);
  const [isGprFormed, setIsGprFormed] = useState(false);

  // Состояния навигации и панелей ГПР (Скриншоты 6-12)
  const [currentView, setCurrentView] = useState('gpr'); // 'gpr' | 'distribution'
  const [selectedGprWorkId, setSelectedGprWorkId] = useState(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState('info'); // 'info' | 'links' | 'resources'
  const [collapsedWbsNodes, setCollapsedWbsNodes] = useState({});
  const [selectedWbsNodeId, setSelectedWbsNodeId] = useState(null);
  const [scaleMode, setScaleMode] = useState('days'); // 'days' | 'weeks' | 'months'
  const [gprViewMode, setGprViewMode] = useState('both'); // 'both' | 'table' | 'chart'
  const [isWbsHovered, setIsWbsHovered] = useState(false);
  const ganttContainerRef = useRef(null); // ссылка на прокручиваемую сетку (таблица + диаграмма Ганта) — для экспорта в PDF

  // Состояния баннеров уведомлений
  const [showRefreshBanner, setShowRefreshBanner] = useState(false);
  const [showExportBanner, setShowExportBanner] = useState(false);
  const [showTransitionBanner, setShowTransitionBanner] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [isRefreshingGpr, setIsRefreshingGpr] = useState(false);

  // Состояния распределения работы
  const [activeDistWorkId, setActiveDistWorkId] = useState(null);
  const [distMethod, setDistMethod] = useState('custom'); // 'day' | 'week' | 'month' | 'custom'
  const [distPeriods, setDistPeriods] = useState([]);
  const [isSavingDist, setIsSavingDist] = useState(false);

  // Новые состояния для двухэтапного выбора ответственного
  const [estimatorsList, setEstimatorsList] = useState([]);
  const [editAssigneeType, setEditAssigneeType] = useState('employee');
  const [editAssigneeId, setEditAssigneeId] = useState(null);
  const [editAssigneeName, setEditAssigneeName] = useState('');

  // Загружаем проекты и сметчиков при инициализации
  useEffect(() => {
    fetchProjects();
    fetchEstimators();
  }, []);

  useEffect(() => {
    if (initialTarget && initialTarget.projectId) {
      setGprSubTab('calendar');
    }
  }, [initialTarget]);

  // Загружаем объекты
  useEffect(() => {
    if (selectedProjectId) {
      fetchObjects(selectedProjectId);
    } else {
      setObjects([]);
      setSelectedObjectId('');
      resetAllStates();
    }
  }, [selectedProjectId]);

  // Запуск проверки календарного плана при выборе объекта и типа сметы
  useEffect(() => {
    if (selectedObjectId && estimateType) {
      runPlanVerification(selectedObjectId, estimateType);
    } else {
      resetAllStates();
    }
  }, [selectedObjectId, estimateType]);

  const fetchProjects = async () => {
    try {
      const res = await api.get(`/estimates/projects?lang=${currentLang}`);
      setProjects(res.data || []);
    } catch (err) {
      console.error('Ошибка загрузки проектов:', err);
    }
  };

  const fetchEstimators = async () => {
    try {
      const res = await api.get('/estimates/estimators');
      setEstimatorsList(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Ошибка загрузки сметчиков:', err);
      setEstimatorsList([]);
    }
  };

  const fetchObjects = async (projId) => {
    try {
      const res = await api.get(`/estimates/projects/${projId}/objects`);
      setObjects(res.data || []);
      setSelectedObjectId('');
    } catch (err) {
      console.error('Ошибка загрузки объектов:', err);
    }
  };

  const resetAllStates = () => {
    setGprData(null);
    setErrorText('');
    setMissingWorks([]);
    setPlanCheckState('none');
    setIsFormingGpr(false);
    setIsGprFormed(false);
    setActiveDistWorkId(null);
    setDistMethod('custom');
    setDistPeriods([]);
    setCurrentView('gpr');
    setSelectedGprWorkId(null);
    setActiveDrawerTab('info');
    setCollapsedWbsNodes({});
    setSelectedWbsNodeId(null);
    setShowRefreshBanner(false);
    setShowExportBanner(false);
    setShowTransitionBanner(false);
  };

  const loadGprData = async (objId, estType = estimateType) => {
    if (!objId || !estType) return;
    try {
      const res = await api.get(`/estimates/gpr-data/${objId}?lang=${currentLang}&estimate_type=${estType}`);
      setGprData(res.data);
      await autoFixOutOfSyncDistributions(res.data, objId, estType);
    } catch (err) {
      console.error("Error loading GPR data:", err);
    }
  };

  // Эмуляция проверки календарного плана по скриншотам 2 и 3
  const runPlanVerification = async (objId, estType = estimateType) => {
    if (!objId || !estType) return;
    setPlanCheckState('checking');
    setErrorText('');
    setMissingWorks([]);
    setIsGprFormed(false);
    setGprData(null);

    try {
      const res = await api.get(`/estimates/gpr-data/${objId}?lang=${currentLang}&estimate_type=${estType}`);
      const data = res.data;

      // Проверка АС-1: Календарный план отсутствует (нет работ)
      if (!data || !data.works || data.works.length === 0) {
        setErrorText('АС-1');
        setPlanCheckState('none');
        return;
      }

      // Проверка АС-2: не заполнены сроки работ
      const emptyWorks = (data.works || []).filter(w => !w.start_date || !w.duration_days || Number(w.duration_days) <= 0);

      if (emptyWorks.length > 0) {
        setMissingWorks(emptyWorks);
        setErrorText('АС-2');
        setPlanCheckState('none');
        return;
      }

      setGprData(data);
      setIsGprFormed(true);
      setCurrentView('distribution');
      setPlanCheckState('none');
      await autoFixOutOfSyncDistributions(data, objId, estType);

    } catch (err) {
      console.error(err);
      const isActual404 = err.response?.data?.error === 'Фактическая смета отсутствует' || (err.response?.status === 404 && estType === 'actual');
      const isPlanned404 = err.response?.data?.error === 'Плановая смета отсутствует' || (err.response?.status === 404 && estType === 'planned');
      
      if (isActual404) {
        setErrorText('АС-ФАКТ');
      } else if (isPlanned404) {
        setErrorText('АС-ПЛАН');
      } else {
        setErrorText('АС-1');
      }
      setPlanCheckState('none');
    }
  };

  // Симуляция формирования ГПР с галочками (Скриншот 5)
  const startGprFormingFlow = () => {
    setIsFormingGpr(true);
    setFormingStep(0);
    setCurrentView('gpr');
    setSelectedGprWorkId(null);

    const interval = setInterval(() => {
      setFormingStep(prev => {
        if (prev >= 5) {
          clearInterval(interval);
          setTimeout(() => {
            setIsFormingGpr(false);
            setIsGprFormed(true);
          }, 600);
          return 5;
        }
        return prev + 1;
      });
    }, 600);
  };

  // Расчет общих параметров проекта
  const projectSummary = useMemo(() => {
    if (!gprData || !gprData.works || gprData.works.length === 0) return null;
    
    let minStart = null;
    let maxEnd = null;

    gprData.works.forEach(w => {
      if (w.start_date) {
        const start = new Date(w.start_date);
        if (!minStart || start < minStart) minStart = start;

        const end = new Date(addDaysToDate(w.start_date, w.duration_days - 1));
        if (!maxEnd || end > maxEnd) maxEnd = end;
      }
    });

    const startStr = minStart ? minStart.toISOString().split('T')[0] : '';
    const endStr = maxEnd ? maxEnd.toISOString().split('T')[0] : '';
    const duration = minStart && maxEnd ? getDaysBetween(startStr, endStr) : 0;

    return {
      startDate: startStr,
      endDate: endStr,
      durationDays: duration
    };
  }, [gprData]);

  // Вычисление названия Конструктива (родительского WBS раздела)
  const getWorkWbsName = (wbsId) => {
    if (!gprData || !gprData.wbs) return '—';
    const node = gprData.wbs.find(n => n.id === wbsId);
    if (!node) return '—';
    const nameKey = `name_${currentLang}`;
    return node[nameKey] || node.name_ru || node.name || '—';
  };

  // Маппинг метаданных смет по doc_id (Смета, Зона, Фаза, Дисциплина)
  const docMetaMap = useMemo(() => {
    const map = {};
    if (!gprData || !gprData.docs) return map;

    gprData.docs.forEach((doc, idx) => {
      const isTemplate = !doc.zone && !doc.phase && !doc.discipline;
      const numCode = (idx === 0 || isTemplate) ? (t.gprGeneralEstimate || 'Общая смета') : `СМ-000${10 + idx}`;
      map[doc.id] = {
        code: numCode,
        zone: doc.zone || '—',
        phase: doc.phase || '—',
        discipline: doc.discipline || '—'
      };
    });
    return map;
  }, [gprData]);

  // Текущая активная работа для распределения
  const activeWork = useMemo(() => {
    if (!gprData || !activeDistWorkId) return null;
    return gprData.works.find(w => w.id === activeDistWorkId);
  }, [gprData, activeDistWorkId]);

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

  const selectorsMarkup = (
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
      <div>
        <label style={labelStyle}>{t.lblProject || 'Проект'}</label>
        <select 
          style={selectStyle} 
          value={selectedProjectId} 
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setSelectedObjectId('');
            setEstimateType('');
            setGprData(null);
            setErrorText('');
          }}
        >
          <option value="">-- {t.lblSelectProject || (currentLang === 'en' ? 'Select Project' : currentLang === 'ka' ? 'აირჩიეთ პროექტი' : currentLang === 'az' ? 'Layihə seçin' : 'Выберите проект')} --</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name}</option>)}
        </select>
      </div>

      <div>
        <label style={labelStyle}>{t.lblObject || (currentLang === 'en' ? 'Object' : currentLang === 'ka' ? 'ობიექტი' : currentLang === 'az' ? 'Obyekt' : 'Объект')}</label>
        <select 
          style={selectStyle} 
          value={selectedObjectId} 
          onChange={(e) => {
            setSelectedObjectId(e.target.value);
            setEstimateType('');
          }}
          disabled={!selectedProjectId}
        >
          <option value="">-- {t.lblSelectObject || (currentLang === 'en' ? 'Select Object' : currentLang === 'ka' ? 'აირჩიეთ ობიექტი' : currentLang === 'az' ? 'Obyekt seçin' : 'Выберите объект')} --</option>
          {objects.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div>
        <label style={labelStyle}>{t.estimateTypeLabel || (currentLang === 'en' ? 'Estimate Type' : currentLang === 'ka' ? 'ხარჯთაღრიცხვის ტიპი' : currentLang === 'az' ? 'Smeta növü' : 'Тип сметы')}</label>
        <select 
          style={selectStyle} 
          value={estimateType} 
          onChange={(e) => setEstimateType(e.target.value)}
          disabled={!selectedObjectId}
        >
          <option value="">-- {t.lblSelectEstimateType || (currentLang === 'en' ? 'Select Type' : currentLang === 'ka' ? 'აირჩიეთ ტიპი' : currentLang === 'az' ? 'Növü seçin' : 'Выберите тип сметы')} --</option>
          <option value="planned">{t.estimateTypePlanned || (currentLang === 'en' ? 'Planned' : currentLang === 'ka' ? 'გეგმიური' : currentLang === 'az' ? 'Planlı' : 'Плановая')}</option>
          <option value="actual">{t.estimateTypeActual || (currentLang === 'en' ? 'Actual' : currentLang === 'ka' ? 'ფაქტიური' : currentLang === 'az' ? 'Faktiki' : 'Фактическая')}</option>
        </select>
      </div>
    </div>
  );

  const renderLayout = (body) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '20px 20px 40px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.5px' }}>
            {t.gprPageTitle || 'График производства работ'}
          </h1>
        </div>

        {/* Вкладку "Распределение объемов по периодам" убрали по запросу — раздел ГПР теперь
            всегда показывает календарное планирование (экспорт в PDF перенесён туда же, в SchedulingTab). */}
        <CalendarPlanningPage
          api={api}
          lang={lang}
          t={t}
          initialTarget={initialTarget}
          onInitialTargetConsumed={onInitialTargetConsumed}
        />
      </div>
    );
  };

  // Статус распределения для каждой работы
  const workDistributionStatus = useMemo(() => {
    const statusMap = {};
    if (!gprData) return statusMap;

    gprData.works.forEach(w => {
      const dists = (gprData.distributions || []).filter(d => d.work_id === w.id);
      const totalDist = dists.reduce((sum, d) => sum + Number(d.volume || 0), 0);
      const percent = w.volume > 0 ? (totalDist / w.volume) * 100 : 0;
      
      let status = 'not_distributed';
      if (percent >= 99.9) {
        status = 'distributed';
      } else if (percent > 0) {
        status = 'partially';
      }

      if (totalDist > w.volume) {
        status = 'excess';
      }

      if (isDistributionOutOfSync(w, gprData.distributions)) {
        status = 'requires_redistribution';
      }

      let methodText = '—';
      if (dists.length > 0) {
        const method = dists[0].period_type;
        if (method === 'day') methodText = t.gprMethodDay || 'День';
        else if (method === 'week') methodText = t.gprMethodWeek || 'Неделя';
        else if (method === 'month') methodText = t.gprMethodMonth || 'Месяц';
        else if (method === 'custom') methodText = t.gprMethodCustom || 'Произвольный период';
      }

      statusMap[w.id] = {
        totalDist,
        percent,
        status,
        method: methodText
      };
    });

    return statusMap;
  }, [gprData, t]);

  // Сводка по распределению текущей работы
  const distSummary = useMemo(() => {
    if (!activeWork) return { sum: 0, remaining: 0, percent: 0, isMatch: false };
    const sum = distPeriods.reduce((s, p) => s + Number(p.volume || 0), 0);
    const remaining = activeWork.volume - sum;
    const percent = activeWork.volume > 0 ? (sum / activeWork.volume) * 100 : 0;
    const isMatch = Math.abs(remaining) < 0.01;

    return {
      sum,
      remaining: Math.max(0, remaining),
      percent,
      isMatch
    };
  }, [activeWork, distPeriods]);

  // Валидация периодов распределения объемов
  const hasValidationError = useMemo(() => {
    if (!activeWork) return false;
    const wStart = new Date(activeWork.start_date);
    const wEnd = new Date(addDaysToDate(activeWork.start_date, activeWork.duration_days - 1));
    return distPeriods.some(p => {
      if (p.volume < 0) return true;
      if (!p.period_start || !p.period_end) return true;
      const pStart = new Date(p.period_start);
      const pEnd = new Date(p.period_end);
      if (pStart > pEnd) return true;
      if (pStart < wStart || pEnd > wEnd) return true;
      return false;
    });
  }, [activeWork, distPeriods]);

  // Обработчик обновления ГПР
  const handleRefreshGpr = () => {
    setIsRefreshingGpr(true);
    setShowRefreshBanner(false);
    setShowExportBanner(false);
    setShowTransitionBanner(false);
    
    setTimeout(async () => {
      if (selectedObjectId) {
        try {
          const res = await api.get(`/estimates/gpr-data/${selectedObjectId}?lang=${currentLang}&estimate_type=${estimateType}`);
          setGprData(res.data);
          await autoFixOutOfSyncDistributions(res.data, selectedObjectId, estimateType);
        } catch (err) {
          console.error(err);
        }
      }
      setIsRefreshingGpr(false);
      setShowRefreshBanner(true);
      setTimeout(() => {
        setShowRefreshBanner(false);
      }, 6000);
    }, 1200);
  };

  // Обработчик экспорта в PDF с баннером
  const handleExportPDFWithBanner = () => {
    handleExportPDF();
    
    const objName = objects.find(o => o.id === selectedObjectId)?.name || 'Object';
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const dateStr = `${dd}.${mm}.${yyyy}`;
    setExportFileName(`GPR_${objName}_${dateStr}.pdf`);
    
    setShowExportBanner(true);
    setShowRefreshBanner(false);
    setShowTransitionBanner(false);
    
    setTimeout(() => {
      setShowExportBanner(false);
    }, 6000);
  };

  // Обработчик перехода к распределению объемов с баннером
  const handleTransitionToDistribution = () => {
    setShowTransitionBanner(true);
    setShowRefreshBanner(false);
    setShowExportBanner(false);
    
    setTimeout(() => {
      setShowTransitionBanner(false);
      setCurrentView('distribution');
    }, 1200);
  };

  // Построение плоского списка WBS (показываем только те сметы и разделы, где действительно есть работы)
  const wbsFlatList = useMemo(() => {
    if (!gprData || !gprData.wbs || !gprData.works) return [];
    
    const hasWorksRecursive = (nodeId) => {
      const hasDirect = gprData.works.some(w => w.wbs_id === nodeId || w.doc_id === nodeId);
      if (hasDirect) return true;

      const children = gprData.wbs.filter(c => c.parent_id === nodeId);
      const virtualChildren = gprData.wbs.filter(c => !c.parent_id && c.doc_id === nodeId);
      const allChildren = [...children, ...virtualChildren];
      return allChildren.some(c => hasWorksRecursive(c.id));
    };

    const map = {};
    gprData.wbs.forEach(node => {
      map[node.id] = { ...node, children: [] };
    });
    
    const roots = [];
    gprData.wbs.forEach(node => {
      const item = map[node.id];
      if (node.parent_id && map[node.parent_id]) {
        map[node.parent_id].children.push(item);
      } else {
        roots.push(item);
      }
    });

    const flatList = [];
    const traverse = (item, level = 0) => {
      if (!hasWorksRecursive(item.id)) return;

      const nameKey = `name_${currentLang}`;
      const label = item[nameKey] || item.name_ru || item.name || '—';
      
      const activeChildren = item.children.filter(c => hasWorksRecursive(c.id));

      flatList.push({
        id: item.id,
        name: label,
        parent_id: item.parent_id,
        level,
        hasChildren: activeChildren.length > 0,
        childrenIds: activeChildren.map(c => c.id),
        is_virtual: item.is_virtual || false
      });
      
      const sortedChildren = [...activeChildren].sort((a, b) => {
        const codeA = a.code || '';
        const codeB = b.code || '';
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      });

      sortedChildren.forEach(child => traverse(child, level + 1));
    };
    
    roots.forEach(root => {
      if (hasWorksRecursive(root.id)) {
        traverse(root, 0);
      }
    });
    return flatList;
  }, [gprData, currentLang]);

  // Проверяет, виден ли WBS узел на экране (не свернут ли предок)
  const isWbsNodeVisible = (nodeId) => {
    const node = wbsFlatList.find(n => n.id === nodeId);
    if (!node) return false;
    
    let currentParentId = node.parent_id;
    while (currentParentId) {
      if (collapsedWbsNodes[currentParentId]) {
        return false;
      }
      const parentNode = wbsFlatList.find(n => n.id === currentParentId);
      currentParentId = parentNode ? parentNode.parent_id : null;
    }
    return true;
  };

  // Идентификация descendants для выбранного WBS узла
  const activeWbsFilterIds = useMemo(() => {
    if (!selectedWbsNodeId) return null;
    const ids = [selectedWbsNodeId];
    const checkDescendants = (parentId) => {
      wbsFlatList.forEach(node => {
        if (node.parent_id === parentId) {
          ids.push(node.id);
          checkDescendants(node.id);
        }
      });
    };
    checkDescendants(selectedWbsNodeId);
    return ids;
  }, [selectedWbsNodeId, wbsFlatList]);

  // Фильтрация работ по WBS выбору
  const filteredWorks = useMemo(() => {
    if (!gprData || !gprData.works) return [];
    if (!activeWbsFilterIds) return gprData.works;
    
    return gprData.works.filter(w => 
      activeWbsFilterIds.includes(w.wbs_id) || 
      activeWbsFilterIds.includes(w.doc_id)
    );
  }, [gprData, activeWbsFilterIds]);

  // Диапазон дат для диаграммы Ганта
  const timelineDates = useMemo(() => {
    if (!gprData || !gprData.works || gprData.works.length === 0) {
      return { start: new Date(), end: new Date(), totalDays: 1, daysArray: [new Date()] };
    }
    
    let minDate = null;
    let maxDate = null;

    gprData.works.forEach(w => {
      if (w.start_date) {
        const start = new Date(w.start_date);
        if (!minDate || start < minDate) minDate = start;

        const end = new Date(addDaysToDate(w.start_date, w.duration_days - 1));
        if (!maxDate || end > maxDate) maxDate = end;
      }
    });

    if (!minDate) {
      minDate = new Date();
      maxDate = new Date();
    } else {
      minDate = new Date(minDate);
      minDate.setDate(minDate.getDate() - 3);

      maxDate = new Date(maxDate);
      maxDate.setDate(maxDate.getDate() + 30);
    }

    const startStr = minDate.toISOString().split('T')[0];
    const endStr = maxDate.toISOString().split('T')[0];
    const totalDays = getDaysBetween(startStr, endStr);

    const daysArray = [];
    let curr = new Date(minDate);
    const endLimit = new Date(maxDate);
    while (curr <= endLimit) {
      daysArray.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }

    return {
      start: minDate,
      end: maxDate,
      startStr,
      endStr,
      totalDays,
      daysArray
    };
  }, [gprData]);

  // Ширина колонки в зависимости от масштаба
  const columnWidth = useMemo(() => {
    if (scaleMode === 'weeks') return 10;
    if (scaleMode === 'months') return 3;
    return 36;
  }, [scaleMode]);

  // Расчет месяцев и подячеек для шапки Ганта
  const timelineHeaders = useMemo(() => {
    const { daysArray } = timelineDates;
    if (!daysArray || daysArray.length === 0) return { months: [], subcells: [] };
    
    const months = [];
    let currentMonth = -1;
    let currentMonthHeader = null;

    const monthNamesRu = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNamesKa = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
    const monthNamesAz = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
    
    const getMonthLabel = (date) => {
      const m = date.getMonth();
      const y = date.getFullYear();
      let name = '';
      if (currentLang === 'en') name = monthNamesEn[m];
      else if (currentLang === 'ka') name = monthNamesKa[m];
      else if (currentLang === 'az') name = monthNamesAz[m];
      else name = monthNamesRu[m];
      return `${name} ${y}`;
    };

    daysArray.forEach((dateObj, idx) => {
      const m = dateObj.getMonth();
      const y = dateObj.getFullYear();
      const label = getMonthLabel(dateObj);
      
      if (m !== currentMonth) {
        currentMonth = m;
        if (currentMonthHeader) {
          months.push(currentMonthHeader);
        }
        currentMonthHeader = {
          name: label,
          span: 1
        };
      } else {
        if (currentMonthHeader) {
          currentMonthHeader.span++;
        }
      }
    });
    
    if (currentMonthHeader) {
      months.push(currentMonthHeader);
    }

    const subcells = [];
    const weekdaysRu = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const weekdaysEn = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const weekdaysKa = ['კვ', 'ორ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'];
    const weekdaysAz = ['Ba', 'B.e', 'Ç.a', 'Çe', 'C.a', 'Cü', 'Şə'];

    const getWeekdayLabel = (date) => {
      const d = date.getDay();
      if (currentLang === 'en') return weekdaysEn[d];
      if (currentLang === 'ka') return weekdaysKa[d];
      if (currentLang === 'az') return weekdaysAz[d];
      return weekdaysRu[d];
    };

    if (scaleMode === 'days') {
      daysArray.forEach(dateObj => {
        subcells.push({
          label: String(dateObj.getDate()).padStart(2, '0'),
          sublabel: getWeekdayLabel(dateObj),
          isWeekend: dateObj.getDay() === 0 || dateObj.getDay() === 6,
          span: 1
        });
      });
    } else if (scaleMode === 'weeks') {
      let weekSpan = 0;
      let weekStartDate = null;
      daysArray.forEach((dateObj, idx) => {
        if (weekSpan === 0) weekStartDate = dateObj;
        weekSpan++;
        
        if (dateObj.getDay() === 0 || idx === daysArray.length - 1) {
          subcells.push({
            label: `${weekStartDate.getDate()}.${String(weekStartDate.getMonth() + 1).padStart(2, '0')}`,
            sublabel: t.gprWeekAbbrev || 'нед.',
            isWeekend: false,
            span: weekSpan
          });
          weekSpan = 0;
        }
      });
    } else {
      // months scale
      months.forEach(m => {
        subcells.push({
          label: m.name,
          sublabel: '',
          isWeekend: false,
          span: m.span
        });
      });
    }

    return { months, subcells };
  }, [timelineDates, scaleMode, currentLang]);

  // Активная выбранная работа для боковой панели
  const selectedWork = useMemo(() => {
    if (!gprData || !selectedGprWorkId) return null;
    return gprData.works.find(w => w.id === selectedGprWorkId);
  }, [gprData, selectedGprWorkId]);

  // Связи-предшественники выбранной работы
  const selectedWorkDependencies = useMemo(() => {
    if (!selectedWork || !gprData || !gprData.dependencies) return [];
    
    return gprData.dependencies.filter(d => d.successor_id === selectedWork.id).map(d => {
      const predWork = gprData.works.find(w => w.id === d.predecessor_id);
      return {
        ...d,
        predecessorName: predWork ? predWork.name : (t.gprUnknownWork || 'Неизвестная работа'),
        predecessorCode: predWork ? predWork.code : ''
      };
    });
  }, [selectedWork, gprData]);

  // Ресурсы выбранной работы (реалистичная генерация по объему)
  const selectedWorkResources = useMemo(() => {
    if (!selectedWork) return [];
    const vol = selectedWork.volume;
    const unit = selectedWork.unit;
    
    return [
      {
        id: '1',
        type: t.gprResTypeLabor || 'Трудозатраты',
        name: t.gprResNameWorkersGrade4 || 'Рабочие 4-го разряда',
        qty: (vol * 1.5).toFixed(1),
        unit: t.gprResUnitManHours || 'чел.-ч'
      },
      {
        id: '2',
        type: t.gprResTypeMaterial || 'Материалы',
        name: selectedWork.name.toLowerCase().includes('бетон') || selectedWork.name.toLowerCase().includes('фундамент')
          ? (t.gprResNameConcreteB25 || 'Бетон готовый B25')
          : (t.gprResNameConstructionMaterials || 'Строительные материалы'),
        qty: (vol * 1.05).toFixed(1),
        unit: unit
      },
      {
        id: '3',
        type: t.gprResTypeMachinery || 'Машины',
        name: selectedWork.name.toLowerCase().includes('землян') || selectedWork.name.toLowerCase().includes('разработ')
          ? (t.gprResNameExcavator || 'Экскаватор гусеничный 1.2 м³')
          : (t.gprResNameMobileCrane || 'Автокран 25т'),
        qty: (vol * 0.1).toFixed(1),
        unit: t.gprResUnitMachineHours || 'маш.-ч'
      }
    ];
  }, [selectedWork, currentLang, t]);


  // Автоматическое перераспределение: когда даты работы в КП меняются, пересчитываем
  // периоды под новые даты и распределяем ранее введённый общий объём пропорционально
  // длине каждого периода — вместо того чтобы сбрасывать всё в 0 и требовать ручного
  // пересбора распределения. Работает только для day/week/month (для custom периодов
  // нет детерминированной формы, чтобы понять, куда их сдвигать — там нужен человек).
  const redistributeVolumeForNewDates = (work, method, totalVolume) => {
    const rawPeriods = getExpectedPeriodsForWork(work, method);
    if (rawPeriods.length === 0) return [];

    const dayCounts = rawPeriods.map(p => getDaysBetween(p.period_start, p.period_end));
    const totalDays = dayCounts.reduce((s, d) => s + d, 0) || 1;

    let allocated = 0;
    let weekNum = 37;
    return rawPeriods.map((p, i) => {
      const isLast = i === rawPeriods.length - 1;
      const volume = isLast
        ? Math.round((totalVolume - allocated) * 100) / 100
        : Math.round((totalVolume * dayCounts[i] / totalDays) * 100) / 100;
      allocated += volume;

      let period_label;
      if (method === 'day') period_label = formatDateRu(p.period_start);
      else if (method === 'week') period_label = `${t.gprLabelWeek || 'Неделя'} ${weekNum++}`;
      else period_label = `${formatDateRu(p.period_start)} - ${formatDateRu(p.period_end)}`;

      return { period_start: p.period_start, period_end: p.period_end, volume, period_label };
    });
  };

  // Полностью автоматическое перераспределение (без открытия панели пользователем):
  // сразу после загрузки ГПР сканируем все работы объекта, и если у какой-то из них даты
  // разъехались с сохранённым распределением — пересчитываем и сразу сохраняем новое
  // распределение на бэкенде, чтобы таблица/статусы обновились сами, без ручных действий.
  const autoFixOutOfSyncDistributions = async (data, objId, estType) => {
    if (!data?.works?.length || !data?.distributions?.length) return;

    const worksToFix = data.works.filter(w => {
      const dists = data.distributions.filter(d => d.work_id === w.id);
      if (dists.length === 0) return false;
      if (dists[0].period_type === 'custom') return false; // нет детерминированной формы для авто-сдвига
      return isDistributionOutOfSync(w, data.distributions);
    });
    if (worksToFix.length === 0) return;

    let anyFixed = false;
    for (const w of worksToFix) {
      const dists = data.distributions.filter(d => d.work_id === w.id);
      const method = dists[0].period_type;
      const totalVolume = dists.reduce((s, d) => s + Number(d.volume || 0), 0);
      const newPeriods = redistributeVolumeForNewDates(w, method, totalVolume);
      if (!newPeriods.length) continue;
      try {
        await api.post('/estimates/gpr-save', {
          docId: w.doc_id,
          workId: w.id,
          periodType: method,
          periods: newPeriods,
          assigneeId: w.assignee_id || null,
          assigneeType: w.assignee_type || 'employee',
          assigneeName: w.assignee_name || ''
        });
        anyFixed = true;
      } catch (err) {
        console.error('[Auto-redistribute] не удалось пересохранить работу', w.id, err);
      }
    }

    // Перезагружаем данные, чтобы таблица/статусы сразу отразили пересчитанные значения
    if (anyFixed) {
      try {
        const res = await api.get(`/estimates/gpr-data/${objId}?lang=${currentLang}&estimate_type=${estType}`);
        setGprData(res.data);
      } catch (err) {
        console.error('[Auto-redistribute] не удалось перезагрузить данные после пересчёта', err);
      }
    }
  };

  // Генерация периодов
  const generatePeriods = (method, forceRegen = false) => {
    if (!activeWork) return;
    setDistMethod(method);

    const start = new Date(activeWork.start_date);
    const end = new Date(addDaysToDate(activeWork.start_date, activeWork.duration_days - 1));
    const duration = getDaysBetween(activeWork.start_date, addDaysToDate(activeWork.start_date, activeWork.duration_days - 1));

    if (!forceRegen) {
      const existingDists = (gprData.distributions || []).filter(
        d => d.work_id === activeWork.id && d.period_type === method
      );

      if (existingDists.length > 0) {
        setDistPeriods(existingDists.map(d => ({
          period_start: d.period_start,
          period_end: d.period_end,
          volume: d.volume,
          period_label: d.period_label
        })));
        return;
      }
    }

    const periods = [];

    if (method === 'day') {
      for (let i = 0; i < duration; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dStr = d.toISOString().split('T')[0];
        periods.push({
          period_start: dStr,
          period_end: dStr,
          volume: 0,
          period_label: formatDateRu(dStr)
        });
      }
    } else if (method === 'month') {
      let current = new Date(start);
      while (current <= end) {
        const y = current.getFullYear();
        const m = current.getMonth();
        const mStart = new Date(y, m, 1);
        const mEnd = new Date(y, m + 1, 0);

        const actualStart = mStart < start ? start : mStart;
        const actualEnd = mEnd > end ? end : mEnd;

        const startStr = actualStart.toISOString().split('T')[0];
        const endStr = actualEnd.toISOString().split('T')[0];

        periods.push({
          period_start: startStr,
          period_end: endStr,
          volume: 0,
          period_label: `${formatDateRu(startStr)} - ${formatDateRu(endStr)}`
        });

        current.setMonth(current.getMonth() + 1);
        current.setDate(1);
      }
    } else if (method === 'week') {
      let current = new Date(start);
      let weekNum = 37;
      while (current <= end) {
        const day = current.getDay();
        const daysToSun = day === 0 ? 0 : 7 - day;
        const wEnd = new Date(current);
        wEnd.setDate(current.getDate() + daysToSun);

        const actualEnd = wEnd > end ? end : wEnd;

        const startStr = current.toISOString().split('T')[0];
        const endStr = actualEnd.toISOString().split('T')[0];

        periods.push({
          period_start: startStr,
          period_end: endStr,
          volume: 0,
          period_label: `${t.gprLabelWeek || 'Неделя'} ${weekNum++}`
        });

        current = new Date(wEnd);
        current.setDate(wEnd.getDate() + 1);
      }
    } else if (method === 'custom') {
      // Изначально пусто
    }

    setDistPeriods(periods);
  };

  const hasUnsavedChanges = () => {
    if (!activeWork) return false;
    const savedDists = (gprData.distributions || []).filter(d => d.work_id === activeWork.id);
    
    if (savedDists.length !== distPeriods.length) return true;
    if (savedDists.length > 0 && savedDists[0].period_type !== distMethod) return true;
    if (savedDists.length === 0 && distMethod !== '') return true;
    
    for (let i = 0; i < distPeriods.length; i++) {
      const p = distPeriods[i];
      const s = savedDists[i];
      if (p.period_start !== s.period_start || p.period_end !== s.period_end || Number(p.volume) !== Number(s.volume)) {
        return true;
      }
    }

    if ((activeWork.assignee_type || 'employee') !== editAssigneeType) return true;
    if ((activeWork.assignee_id || null) !== editAssigneeId) return true;
    if ((activeWork.assignee_name || '') !== editAssigneeName) return true;

    return false;
  };

  const handleCancelEdit = () => {
    if (hasUnsavedChanges()) {
      if (!window.confirm(t.gprConfirmUnsavedChanges || 'Несохраненные изменения будут потеряны. Продолжить?')) {
        return;
      }
    }
    setActiveDistWorkId(null);
    setDistMethod('custom');
    setDistPeriods([]);
  };

  const handleMethodChange = (newMethod) => {
    if (distSummary.sum > 0) {
      if (!window.confirm(t.gprConfirmChangeMethod || 'При изменении способа распределения текущие периоды и объемы будут удалены. Продолжить?')) {
        return;
      }
    }
    generatePeriods(newMethod);
  };

  const handleClearDistribution = async () => {
    if (!window.confirm(t.gprConfirmClearDistribution || 'Удалить распределение выбранной работы?')) {
      return;
    }

    setIsSavingDist(true);
    try {
      const res = await api.post('/estimates/gpr-save', {
        docId: activeWork.doc_id,
        workId: activeWork.id,
        periodType: 'day',
        periods: [],
        assigneeId: editAssigneeId,
        assigneeType: editAssigneeType,
        assigneeName: editAssigneeName
      });

      if (res.data.success) {
        alert(t.gprAlertCleared || 'Распределение очищено');
        await loadGprData(selectedObjectId);
        setDistMethod('custom');
        setDistPeriods([]);
      }
    } catch (err) {
      alert((t.gprErrClearPrefix || 'Ошибка при очистке: ') + (err.message || err));
    } finally {
      setIsSavingDist(false);
    }
  };

  const handleSaveDistributionInline = async () => {
    if (distSummary.sum > activeWork.volume) {
      alert(t.gprErrVolumeExceeds || 'Ошибка: распределенный объем превышает общий объем работы!');
      return;
    }
    if (hasValidationError) {
      alert(t.gprErrInvalidDates || 'Ошибка: исправьте некорректные даты или объемы перед сохранением!');
      return;
    }
    // Раньше здесь была проверка isDistributionOutOfSync(activeWork, gprData.distributions),
    // которая блокировала сохранение при расхождении дат. Теперь при открытии панели периоды
    // уже автоматически пересчитаны под текущие даты работы (см. redistributeVolumeForNewDates),
    // поэтому distPeriods всегда актуален на момент сохранения — блокировать сохранение не нужно.

    setIsSavingDist(true);
    try {
      const res = await api.post('/estimates/gpr-save', {
        docId: activeWork.doc_id,
        workId: activeWork.id,
        periodType: distMethod,
        periods: distPeriods,
        assigneeId: editAssigneeId,
        assigneeType: editAssigneeType,
        assigneeName: editAssigneeName
      });

      if (res.data.success) {
        alert(t.gprSaveSuccess || 'Распределение работы успешно сохранено');
        await loadGprData(selectedObjectId);
        setActiveDistWorkId(null);
        setDistMethod('custom');
        setDistPeriods([]);
        setIsGprFormed(true);
      }
    } catch (err) {
      alert((t.gprErrSaveDistributionPrefix || 'Ошибка при сохранении: ') + (err.message || err));
    } finally {
      setIsSavingDist(false);
    }
  };

  const handleExportPDF = () => {
    if (!gprData) return;

    const objName = objects.find(o => o.id === selectedObjectId)?.name || 'Object';
    const projName = projects.find(p => p.id === selectedProjectId)?.name || 'Project';
    const docCode = docMetaMap[gprData.doc.id]?.code || '—';

    let rowsHtml = '';
    gprData.works.forEach(w => {
      const stats = workDistributionStatus[w.id] || { totalDist: 0, percent: 0, status: 'not_distributed', method: '—' };
      const meta = docMetaMap[w.doc_id] || { code: '—', zone: '—', phase: '—', discipline: '—' };
      rowsHtml += `
        <tr>
          <td>${w.code || '—'}</td>
          <td class="text-left font-semibold">${w.name}</td>
          <td>${meta.code}</td>
          <td>${getWorkWbsName(w.wbs_id) || '—'}</td>
          <td>${w.unit}</td>
          <td class="text-right">${w.volume}</td>
          <td>${formatDateRu(w.start_date)}</td>
          <td>${formatDateRu(addDaysToDate(w.start_date, w.duration_days - 1))}</td>
          <td>${w.duration_days} ${t.schedScaleDays ? t.schedScaleDays.toLowerCase() : 'дн.'}</td>
          <td>${stats.method}</td>
          <td class="text-right">${stats.totalDist}</td>
          <td class="text-right">${Math.max(0, w.volume - stats.totalDist)}</td>
          <td class="font-bold text-center ${stats.percent >= 100 ? 'text-success' : 'text-warning'}">${stats.percent.toFixed(0)}%</td>
        </tr>
      `;
    });

    const now = new Date();
    const dateStr = now.toLocaleDateString(currentLang === 'ru' ? 'ru-RU' : 'en-US');

    const element = document.createElement('div');
    element.style.padding = '20px';
    element.style.background = '#ffffff';
    element.innerHTML = `
      <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; font-size: 10px; line-height: 1.4;">
        <div style="margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">
          <h1 style="font-size: 18px; margin: 0 0 12px 0; font-weight: 800; color: #0f172a;">${t.tabGpr || 'График производства работ'}</h1>
          <table style="width: 100%; border: none; margin-bottom: 10px;">
            <tr style="background: none;">
              <td style="width: 33%; border: none; text-align: left; padding: 4px 0;">
                <div style="font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase;">${t.gprProject || 'Проект'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #0f172a;">${projName}</div>
              </td>
              <td style="width: 33%; border: none; text-align: left; padding: 4px 0;">
                <div style="font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase;">${t.gprObject || 'Объект'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #0f172a;">${objName}</div>
              </td>
              <td style="width: 33%; border: none; text-align: left; padding: 4px 0;">
                <div style="font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase;">${t.gprVersion || 'Смета'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #0f172a;">${docCode} - ${getVersionLabel(gprData.doc)}</div>
              </td>
            </tr>
            <tr style="background: none;">
              <td style="width: 33%; border: none; text-align: left; padding: 4px 0;">
                <div style="font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase;">${t.gprStartDate || 'Начало'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #0f172a;">${formatDateRu(projectSummary?.startDate)}</div>
              </td>
              <td style="width: 33%; border: none; text-align: left; padding: 4px 0;">
                <div style="font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase;">${t.gprEndDate || 'Окончание'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #0f172a;">${formatDateRu(projectSummary?.endDate)}</div>
              </td>
              <td style="width: 33%; border: none; text-align: left; padding: 4px 0;">
                <div style="font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase;">${t.gprDurationShort || 'Продолжительность'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #0f172a;">${projectSummary?.durationDays} ${t.schedDaysUnit || 'дн.'}</div>
              </td>
            </tr>
          </table>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprLblCode || 'Код'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569; text-align: left;">${t.gprColWork || 'Работа'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprVersion || 'Смета'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprColConstruct || 'Конструктив'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprColUnit || 'Ед. изм.'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569; text-align: right;">${t.gprColVolume || 'Объем'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprColStart || 'Начало'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprColEnd || 'Окончание'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprColDuration || 'Срок'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">${t.gprColMethod || 'Тип распр.'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569; text-align: right;">${t.gprColDistributed || 'Распределено'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569; text-align: right;">${t.gprColRemaining || 'Остаток'}</th>
              <th style="font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 6px; border: 1px solid #cbd5e1; color: #475569;">%</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <h2 style="font-size: 14px; margin: 20px 0 10px 0; font-weight: 800; color: #0f172a;">${t.gprTitleGanttChart || 'Диаграмма Ганта'}</h2>
        <div id="gantt-export-slot"></div>

        <div style="margin-top: 25px; text-align: right; font-size: 8px; color: #94a3b8; font-weight: 600;">
          ERP System: ${dateStr}
        </div>
      </div>
    `;

    // Клонируем реально отрисованную диаграмму Ганта (таблица работ + временная шкала) в PDF —
    // раньше в экспорт попадала только сводная таблица без самой Гантты.
    if (ganttContainerRef.current) {
      const ganttClone = ganttContainerRef.current.cloneNode(true);
      ganttClone.style.overflow = 'visible';
      ganttClone.style.maxHeight = 'none';
      ganttClone.style.height = 'auto';
      const slot = element.querySelector('#gantt-export-slot');
      if (slot) slot.appendChild(ganttClone);
    }

    const tdElements = element.querySelectorAll('td');
    tdElements.forEach(td => {
      if (!td.style.border) {
        td.style.border = '1px solid #e2e8f0';
        td.style.padding = '6px';
        td.style.fontSize = '9px';
        if (td.classList.contains('text-left')) td.style.textAlign = 'left';
        if (td.classList.contains('text-right')) td.style.textAlign = 'right';
        if (td.classList.contains('font-semibold')) td.style.fontWeight = '600';
        if (td.classList.contains('font-bold')) td.style.fontWeight = '700';
        if (td.classList.contains('text-success')) td.style.color = '#16a34a';
        if (td.classList.contains('text-warning')) td.style.color = '#d97706';
      }
    });

    const thElements = element.querySelectorAll('th');
    thElements.forEach(th => {
      th.style.padding = '6px';
      th.style.border = '1px solid #cbd5e1';
    });

    const trElements = element.querySelectorAll('tr');
    trElements.forEach((tr, index) => {
      if (index > 0 && index % 2 === 0 && tr.parentElement.tagName === 'TBODY') {
        tr.style.background = '#f8fafc';
      }
    });

    const opt = {
      margin:       10,
      filename:     `GPR_${objName}_${dateStr}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    // Контейнер экспорта раньше никогда не добавлялся в document — для простой таблицы это
    // работало, но клон диаграммы Ганта внутри использует width:100%/абсолютно спозиционированный
    // SVG (линии зависимостей), которым для корректного рендера нужен реальный layout-контекст.
    // Временно прикрепляем элемент вне видимой области, после экспорта убираем.
    element.style.position = 'fixed';
    element.style.left = '-99999px';
    element.style.top = '0';
    document.body.appendChild(element);

    // Раньше библиотека грузилась с внешнего CDN (cdnjs.cloudflare.com) в момент клика —
    // на закрытой/внутренней сети (без доступа в интернет у пользователя) это молча ломало
    // экспорт. Теперь html2pdf.js — локальная зависимость, подключена статически в сборку.
    html2pdf().set(opt).from(element).save().catch(err => {
      console.error("PDF generation failed", err);
      alert((t.gprErrPdfGenerationPrefix || 'Ошибка при генерации PDF: ') + err);
    }).finally(() => {
      if (element.parentNode) document.body.removeChild(element);
    });
  };

  // --- Рендеринг АС-ФАКТ ---
  if (errorText === 'АС-ФАКТ') {
    return renderLayout(
      <div style={{ background: 'white', padding: '32px', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <div style={{ textAlign: 'center', padding: '50px 20px', color: '#64748b', background: '#fff1f2', borderRadius: '16px', border: '1px solid #fecdd3', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <AlertTriangle size={48} color="#f43f5e" style={{ margin: '0 auto 4px' }} />
          <h5 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '900', color: '#9f1239' }}>{t.gprNoActualEstimate || 'Невозможно сформировать ГПР. Отсутствует фактическая смета'}</h5>
          <p style={{ margin: 0, fontSize: '13px', color: '#be123c', fontWeight: '600' }}>{t.gprHintCreateActualEstimate || 'Пожалуйста, создайте и утвердите фактическую смету для этого объекта.'}</p>

          <button
            onClick={() => selectedObjectId && runPlanVerification(selectedObjectId)}
            style={{ marginTop: '12px', padding: '8px 20px', background: '#e11d48', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: '850', color: 'white', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(225,29,72,0.15)' }}
          >
            {t.gprBtnRetryCheck || 'Повторить проверку'}
          </button>
        </div>
      </div>
    );
  }

  // --- Рендеринг АС-ПЛАН ---
  if (errorText === 'АС-ПЛАН') {
    return renderLayout(
      <div style={{ background: 'white', padding: '32px', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <div style={{ textAlign: 'center', padding: '50px 20px', color: '#64748b', background: '#fff1f2', borderRadius: '16px', border: '1px solid #fecdd3', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <AlertTriangle size={48} color="#f43f5e" style={{ margin: '0 auto 4px' }} />
          <h5 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '900', color: '#9f1239' }}>{t.gprNoPlannedEstimate || 'Невозможно сформировать ГПР. Отсутствует плановая смета'}</h5>
          <p style={{ margin: 0, fontSize: '13px', color: '#be123c', fontWeight: '600' }}>{t.gprHintCreatePlannedEstimate || 'Пожалуйста, создайте плановую смету для этого объекта.'}</p>

          <button
            onClick={() => selectedObjectId && runPlanVerification(selectedObjectId)}
            style={{ marginTop: '12px', padding: '8px 20px', background: '#e11d48', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: '850', color: 'white', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(225,29,72,0.15)' }}
          >
            {t.gprBtnRetryCheck || 'Повторить проверку'}
          </button>
        </div>
      </div>
    );
  }

  // --- Рендеринг АС-1 ---
  if (errorText === 'АС-1') {
    return renderLayout(
      <div style={{ background: 'white', padding: '32px', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <div style={{ textAlign: 'center', padding: '50px 20px', color: '#64748b', background: '#fff1f2', borderRadius: '16px', border: '1px solid #fecdd3', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <AlertTriangle size={48} color="#f43f5e" style={{ margin: '0 auto 4px' }} />
          <h5 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '900', color: '#9f1239' }}>{t.gprNoSchedule || 'Невозможно сформировать ГПР. Отсутствует календарный план'}</h5>
          <p style={{ margin: 0, fontSize: '13px', color: '#be123c', fontWeight: '600' }}>{t.gprUnavailable || 'Формирование ГПР недоступно'}</p>

          <button
            onClick={() => selectedObjectId && runPlanVerification(selectedObjectId)}
            style={{ marginTop: '12px', padding: '8px 20px', background: '#e11d48', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: '850', color: 'white', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(225,29,72,0.15)' }}
          >
            {t.gprBtnRetryCheck || 'Повторить проверку'}
          </button>
        </div>
      </div>
    );
  }

  // --- Рендеринг АС-2 ---
  if (errorText === 'АС-2') {
    return renderLayout(
      <div style={{ background: 'white', padding: '32px', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <div style={{ padding: '24px', background: '#fffbeb', borderRadius: '16px', border: '1px solid #fde68a', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <AlertTriangle size={24} color="#d97706" />
            <h5 style={{ margin: 0, fontSize: '15px', fontWeight: '900', color: '#92400e' }}>{t.gprScheduleEmpty || 'Для формирования графика необходимо заполнить календарный план'}</h5>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: '800', color: '#b45309', textTransform: 'uppercase' }}>{t.gprMissingWorksListTitle || 'Список незаполненных работ:'}</div>
            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', background: 'white', padding: '12px', borderRadius: '12px', border: '1px solid #f59e0b' }}>
              {missingWorks.map(w => (
                <div key={w.id} style={{ fontSize: '12px', fontWeight: '700', color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
                  <span>🛠 {w.name}</span>
                  <span style={{ color: '#ef4444' }}>{t.gprMissingWorksReason || '(Не указаны сроки или даты)'}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              onClick={() => selectedObjectId && runPlanVerification(selectedObjectId)}
              style={{ padding: '10px 24px', background: '#d97706', border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: '800', color: 'white', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(217,119,6,0.15)' }}
            >
              {t.gprBtnRetryCheck || 'Повторить проверку'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- ЭКРАН 5: АНИМИРОВАННОЕ ФОРМИРОВАНИЕ ГПР ---
  if (isFormingGpr) {
    const steps = [
      t.gprStepLoadWorks || 'Загрузка работ календарного плана',
      t.gprStepDetermineSequence || 'Определение последовательности работ',
      t.gprStepCalculateDates || 'Расчет дат начала и окончания',
      t.gprStepCriticalPath || 'Определение критического пути',
      t.gprStepCalculateDuration || 'Расчет общей продолжительности',
      t.gprStepFormSchedule || 'Формирование графика'
    ];

    return renderLayout(
      <div style={{ background: 'white', padding: '40px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '500px', margin: '20px auto 40px auto', width: '100%' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px' }}>
            <div className="gpr-spinner" style={{ width: '24px', height: '24px', border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <span style={{ fontSize: '16px', fontWeight: '850', color: '#0f172a' }}>{t.gprFormingInProgress || 'Формирование ГПР...'}</span>
          </div>

          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingLeft: '40px' }}>
            {steps.map((stepText, idx) => {
              const isDone = formingStep > idx;
              const isCurrent = formingStep === idx;

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {isDone ? (
                    <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #10b981' }}>
                      <span style={{ color: '#10b981', fontSize: '11px', fontWeight: '900', marginLeft: '1px', marginTop: '-1px' }}>✓</span>
                    </div>
                  ) : isCurrent ? (
                    <div className="gpr-spinner-small" style={{ width: '14px', height: '14px', border: '2px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                  ) : (
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #cbd5e1', background: '#f1f5f9' }}></div>
                  )}
                  <span style={{ fontSize: '13px', fontWeight: isCurrent ? '850' : '700', color: isDone ? '#10b981' : isCurrent ? '#0f172a' : '#94a3b8' }}>
                    {stepText}
                  </span>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    );
  }

  // --- ЭКРАНЫ 1, 2, 3, 4: ПЕРЕД ФОРМИРОВАНИЕМ ГРАФИКА ---
  if (!isGprFormed) {
    return renderLayout(
      <div style={{ background: 'white', padding: '40px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* Состояние проверки календарного плана */}
        {planCheckState === 'checking' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '60px 20px', gap: '20px' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid #f1f5f9', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <p style={{ margin: 0, fontSize: '14px', color: '#475569', fontWeight: '850' }}>
              {t.gprCheckingPlan || 'Выполняется проверка календарного плана проекта...'}
            </p>
          </div>
        )}

        {/* Скриншот 1: Пустое состояние (проект и объект не выбраны) */}
        {planCheckState === 'none' && !errorText && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '60px 20px', gap: '16px' }}>
            <div style={{ width: '120px', height: '120px', opacity: 0.85, margin: '0 auto 10px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <circle cx="8" cy="14" r="1.5" fill="#cbd5e1" />
                <circle cx="12" cy="14" r="1.5" fill="#cbd5e1" />
                <circle cx="16" cy="14" r="1.5" fill="#cbd5e1" />
                <circle cx="8" cy="18" r="1.5" fill="#cbd5e1" />
                <circle cx="12" cy="18" r="1.5" fill="#cbd5e1" />
                <circle cx="16" cy="18" r="1.5" fill="#cbd5e1" />
              </svg>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '800', maxWidth: '380px' }}>
              {t.gprSelectProjectObjectPrompt || 'Для формирования графика необходимо выбрать проект и объект'}
            </p>
          </div>
        )}

        {/* Скриншот 2: Синий информационный баннер */}
        {planCheckState === 'found_blue' && (
          <div style={{ padding: '18px 24px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start', marginTop: '10px' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '900', fontSize: '12px', marginTop: '2px', flexShrink: 0 }}>
              <span style={{ marginLeft: '1px' }}>i</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '14px', fontWeight: '950', color: '#1e3a8a' }}>{t.gprCalendarPlanFormed || 'Сформирован календарный план'}</span>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#3b82f6' }}>{t.gprLastUpdatedPrefix || 'Последнее обновление: '}{formatDateRu(new Date().toISOString().split('T')[0])} 12:30</span>
              <span style={{ fontSize: '12px', fontWeight: '800', color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', marginTop: '4px', display: 'inline-block' }}>{t.gprOpenCalendarPlan || 'Открыть календарный план'}</span>
            </div>
          </div>
        )}

        {/* Скриншот 3 & 4: Зеленый баннер готовности и кнопки формирования */}
        {planCheckState === 'found_green' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ padding: '18px 24px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '16px', display: 'flex', gap: '14px', alignItems: 'center' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', flexShrink: 0 }}>
                <span style={{ color: 'white', fontSize: '11px', fontWeight: '900', marginLeft: '1px' }}>✓</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '14px', fontWeight: '950', color: '#14532d' }}>{t.gprCalendarPlanFound || 'Календарный план найден'}</span>
                <span style={{ fontSize: '12px', fontWeight: '750', color: '#16a34a' }}>{t.gprReadyToForm || 'Готов к формированию графика производства работ'}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
              <button
                onClick={startGprFormingFlow}
                style={{ padding: '12px 24px', fontSize: '13px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 4px 10px rgba(37,99,235,0.15)' }}
              >
                {t.btnBuildGpr || 'Сформировать ГПР'}
              </button>
              <button
                onClick={startGprFormingFlow}
                style={{ padding: '12px 24px', fontSize: '13px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '12px', fontWeight: '900', color: '#475569', cursor: 'pointer' }}
              >
                {t.btnUpdateGpr || 'Обновить ГПР'}
              </button>
            </div>
          </div>
        )}



      </div>
    );
  }

  // Конец блока перемещенных хуков


  // --- ШАГ 6-12: РЕНДЕРИНГ ГПР С КАРТОЧКАМИ И СУММАМИ ---
  return renderLayout(
    <div style={{ background: 'white', padding: '32px', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
      
      {/* 1. Карточка итоговых сведений по проекту */}
      {gprData && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '24px', background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprProject || 'Проект'}</div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
              {projects.find(p => p.id === selectedProjectId)?.name || '—'}
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprObject || 'Объект'}</div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
              {objects.find(o => o.id === selectedObjectId)?.name || '—'}
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprVersion || 'Версия сметы'}</div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
              {docMetaMap[gprData.doc.id]?.code || (t.gprGeneralEstimate || 'Общая смета')} ({getVersionLabel(gprData.doc)})
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprStartDate || 'Плановая дата начала'}</div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>{formatDateRu(projectSummary?.startDate)}</div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprEndDate || 'Плановая дата окончания'}</div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>{formatDateRu(projectSummary?.endDate)}</div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprDurationShort || 'Общая продолжительность'}</div>
            <div style={{ fontSize: '14px', fontWeight: '950', color: '#2563eb', marginTop: '4px' }}>{projectSummary?.durationDays} {t.schedDaysUnit || 'дн.'}</div>
          </div>
        </div>
      )}

      {/* 2. Заголовок и кнопки управления с баннерами */}
      {currentView === 'gpr' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <h4 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>
              {t.tabGpr || 'График производства работ'}
            </h4>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button 
                onClick={handleRefreshGpr}
                style={{
                  padding: '10px 18px', fontSize: '13px',
                  background: 'white',
                  border: (showRefreshBanner || isRefreshingGpr) ? '2.5px solid #2563eb' : '1px solid #cbd5e1',
                  boxShadow: (showRefreshBanner || isRefreshingGpr) ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                  borderRadius: '12px', fontWeight: '850',
                  color: (showRefreshBanner || isRefreshingGpr) ? '#2563eb' : '#475569',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s'
                }}
              >
                <RefreshCw size={14} className={isRefreshingGpr ? 'animate-spin' : ''} /> {t.btnUpdateGpr || 'Обновить ГПР'}
              </button>
              <button 
                onClick={handleTransitionToDistribution}
                style={{
                  padding: '10px 18px', fontSize: '13px',
                  background: 'white',
                  border: showTransitionBanner ? '2.5px solid #2563eb' : '1px solid #cbd5e1',
                  boxShadow: showTransitionBanner ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                  borderRadius: '12px', fontWeight: '850',
                  color: showTransitionBanner ? '#2563eb' : '#475569',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s'
                }}
              >
                <FileText size={14} /> {t.gprBtnDistribute || 'Распределить объемы'}
              </button>
              <button 
                onClick={handleExportPDFWithBanner}
                style={{
                  padding: '10px 18px', fontSize: '13px',
                  background: 'white',
                  border: showExportBanner ? '2.5px solid #2563eb' : '1px solid #cbd5e1',
                  boxShadow: showExportBanner ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                  borderRadius: '12px', fontWeight: '850',
                  color: showExportBanner ? '#2563eb' : '#475569',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s'
                }}
              >
                <Download size={14} color={showExportBanner ? '#2563eb' : '#16a34a'} /> {t.gprBtnExport || 'Экспорт в PDF'}
              </button>
            </div>
          </div>

          {/* Информационные баннеры */}
          {showRefreshBanner && (
            <div style={{ padding: '12px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'center', animation: 'fadeIn 0.3s' }}>
              <CheckCircle2 size={18} color="#10b981" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: '850', color: '#14532d' }}>{t.gprSuccessUpdated || 'ГПР успешно обновлен'}</span>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#16a34a' }}>{t.gprSuccessUpdatedDesc || 'Данные пересчитаны с учетом изменений календарного плана.'}</span>
              </div>
            </div>
          )}

          {showTransitionBanner && (
            <div style={{ padding: '12px 18px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'center', animation: 'fadeIn 0.3s' }}>
              <Info size={18} color="#2563eb" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: '850', color: '#1e3a8a' }}>{t.gprTransitionDist || 'Переход к распределению объемов работ по периодам.'}</span>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#3b82f6' }}>{t.gprTransitionDistDesc || 'Вы сможете распределить объемы по неделям, месяцам или другим периодам.'}</span>
              </div>
            </div>
          )}

          {showExportBanner && (
            <div style={{ padding: '12px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'center', animation: 'fadeIn 0.3s' }}>
              <CheckCircle2 size={18} color="#10b981" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: '850', color: '#14532d' }}>{t.gprSuccessExport || 'Экспорт выполнен успешно'}</span>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#16a34a' }}>
                  {(t.gprFileDownloaded || 'Файл {file} успешно скачан.').replace('{file}', exportFileName)}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <h4 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>
            {t.gprDistTitle || 'Распределение объемов работ'}
          </h4>
          {/*           <button 
            onClick={() => { setCurrentView('gpr'); setActiveDistWorkId(null); }}
            style={{ padding: '8px 16px', fontSize: '13px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#2563eb' }}
          >
            <ArrowLeft size={14} /> {t.gprBtnBackToGpr || 'Назад к ГПР'}
          </button> */}
        </div>
      )}

      {/* 3. Основной контент ГПР с диаграммой Ганта */}
      {currentView === 'gpr' ? (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', minHeight: '520px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
          
          {/* Левая панель: WBS-структура (20% ширины) */}
          {/* Левая панель: WBS-структура (раздвижная при наведении) */}
          <div 
            onMouseEnter={() => setIsWbsHovered(true)}
            onMouseLeave={() => setIsWbsHovered(false)}
            style={{ 
              width: isWbsHovered ? '280px' : '48px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '10px', 
              borderRight: '1px solid #cbd5e1', 
              paddingRight: isWbsHovered ? '16px' : '6px', 
              maxHeight: '550px', 
              overflowY: 'auto', 
              overflowX: 'hidden',
              flexShrink: 0,
              transition: 'all 0.25s ease-in-out',
              whiteSpace: 'nowrap',
              boxShadow: isWbsHovered ? '4px 0 12px rgba(0,0,0,0.05)' : 'none',
              zIndex: 30,
              background: '#ffffff'
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: '900', color: '#475569', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📁</span>
              {isWbsHovered && <span>{t.gprTitleWbs || 'Структура WBS'}</span>}
            </div>
            
            {wbsFlatList.map(node => {
              const isVisible = isWbsNodeVisible(node.id);
              if (!isVisible) return null;
              
              const isCollapsed = collapsedWbsNodes[node.id];
              const isSelected = selectedWbsNodeId === node.id;
              
              return (
                <div 
                  key={node.id} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    padding: '6px 8px', 
                    borderRadius: '8px', 
                    background: isSelected ? '#eff6ff' : 'transparent',
                    border: isSelected ? '1px solid #bfdbfe' : '1px solid transparent',
                    cursor: 'pointer',
                    paddingLeft: isWbsHovered ? `${node.level * 12 + 8}px` : '8px',
                    transition: 'all 0.2s',
                    userSelect: 'none',
                    overflow: 'hidden'
                  }}
                  onClick={() => {
                    setSelectedWbsNodeId(prev => prev === node.id ? null : node.id);
                  }}
                >
                  {node.hasChildren ? (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsedWbsNodes(prev => ({ ...prev, [node.id]: !prev[node.id] }));
                      }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#64748b', flexShrink: 0 }}
                    >
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  ) : (
                    <span style={{ width: '14px', display: 'inline-block', flexShrink: 0 }} />
                  )}
                  
                  <span style={{ fontSize: '12px', flexShrink: 0 }}>
                    {node.is_virtual ? '📁' : '📄'}
                  </span>
                  
                  {isWbsHovered && (
                    <span style={{ fontSize: '12px', fontWeight: isSelected ? '850' : node.is_virtual ? '800' : '700', color: isSelected ? '#1e40af' : node.is_virtual ? '#0f172a' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Средняя и Правая панели: Таблица + Диаграмма Ганта */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
            
            {/* Панель масштаба (ДНИ, НЕДЕЛИ, МЕСЯЦЫ) и Легенда */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Легенда */}
              <div style={{ display: 'flex', gap: '20px', fontSize: '11px', fontWeight: '850', color: '#475569' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#e11d48' }} />
                  <span>{t.gprLegendCritical || 'Критический путь'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#2563eb' }} />
                  <span>{t.gprLegendNonCritical || 'Некритические работы'}</span>
                </div>
              </div>

              {/* Селекторы */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                {/* Селектор отображения: Таблица / Диаграмма / Оба */}
                <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setGprViewMode('table')}
                    style={{
                      background: gprViewMode === 'table' ? '#ffffff' : 'transparent',
                      color: gprViewMode === 'table' ? '#2563eb' : '#64748b',
                      border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '850', cursor: 'pointer', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                    title={t.gprTitleTableOnly || 'Показать только таблицу'}
                  >
                    <Table size={12} />
                    <span>{t.gprViewTableOnly || 'Таблица'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGprViewMode('chart')}
                    style={{
                      background: gprViewMode === 'chart' ? '#ffffff' : 'transparent',
                      color: gprViewMode === 'chart' ? '#2563eb' : '#64748b',
                      border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '850', cursor: 'pointer', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                    title={t.gprTitleChartOnly || 'Показать только диаграмму Ганта'}
                  >
                    <BarChart3 size={12} />
                    <span>{t.gprViewChartOnly || 'Диаграмма'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGprViewMode('both')}
                    style={{
                      background: gprViewMode === 'both' ? '#ffffff' : 'transparent',
                      color: gprViewMode === 'both' ? '#2563eb' : '#64748b',
                      border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '850', cursor: 'pointer', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                    title={t.gprTitleBoth || 'Показать таблицу и диаграмму'}
                  >
                    <LayoutGrid size={12} />
                    <span>{t.gprViewBoth || 'Таблица + Гантт'}</span>
                  </button>
                </div>

                {/* Селектор масштаба */}
                <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setScaleMode('days')}
                    style={{
                      background: scaleMode === 'days' ? '#ffffff' : 'transparent',
                      color: scaleMode === 'days' ? '#2563eb' : '#64748b',
                      border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '850', cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    {t.schedScaleDays || 'ДНИ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScaleMode('weeks')}
                    style={{
                      background: scaleMode === 'weeks' ? '#ffffff' : 'transparent',
                      color: scaleMode === 'weeks' ? '#2563eb' : '#64748b',
                      border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '850', cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    {t.schedScaleWeeks || 'НЕДЕЛИ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScaleMode('months')}
                    style={{
                      background: scaleMode === 'months' ? '#ffffff' : 'transparent',
                      color: scaleMode === 'months' ? '#2563eb' : '#64748b',
                      border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '850', cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    {t.schedScaleMonths || 'МЕСЯЦЫ'}
                  </button>
                </div>
              </div>
            </div>

            {/* Прокручиваемый контейнер сетки (таблица работ + диаграмма Ганта) — ref нужен, чтобы
                клонировать его содержимое при экспорте в PDF (US: печатная форма ГПР с самой Ганттой) */}
            <div ref={ganttContainerRef} style={{ overflow: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px', background: 'white', maxHeight: '550px', position: 'relative' }}>
              {isRefreshingGpr && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, background: 'rgba(255, 255, 255, 0.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', backdropFilter: 'blur(2px)' }}>
                  <RefreshCw size={36} className="animate-spin" color="#2563eb" />
                  <span style={{ fontSize: '14px', fontWeight: '850', color: '#1e3a8a' }}>{t.gprUpdatingChart || 'Обновление данных графика...'}</span>
                </div>
              )}
              <div style={{ display: 'flex', width: gprViewMode === 'both' ? 'fit-content' : '100%' }}>
                
                {/* 1. Левая сплит-панель: Работы */}
                {gprViewMode !== 'chart' && (
                  <div style={{
                    width: gprViewMode === 'table' ? '100%' : '695px',
                    minWidth: gprViewMode === 'table' ? '100%' : '695px',
                    borderRight: gprViewMode === 'table' ? 'none' : '1px solid #cbd5e1',
                    flexShrink: 0,
                    background: '#ffffff',
                    position: gprViewMode === 'table' ? 'relative' : 'sticky',
                    left: 0,
                    zIndex: 20
                  }}>
                    {/* Заголовки таблицы работ */}
                    <div style={{
                      display: 'flex', background: '#f8fafc', borderBottom: '2px solid #cbd5e1',
                      fontSize: '11px', fontWeight: '850', color: '#475569', height: '47px', alignItems: 'center', boxSizing: 'border-box'
                    }}>
                      <div style={{ padding: '10px 8px', width: '35px', textAlign: 'center' }}>№</div>
                      <div style={{ padding: '10px 8px', width: gprViewMode === 'table' ? 'calc(100% - 375px)' : '320px' }}>{t.gprColWork || 'Работа'}</div>
                      <div style={{ padding: '10px 8px', width: '100px', textAlign: 'right' }}>{t.gprColVolume || 'Объем'}</div>
                      <div style={{ padding: '10px 8px', width: '100px', textAlign: 'center' }}>{t.gprColDuration || 'Продолжительность'}</div>
                      <div style={{ padding: '10px 8px', width: '90px', textAlign: 'center' }}>{t.gprColStart || 'Начало'}</div>
                      <div style={{ padding: '10px 8px', width: '50px', textAlign: 'center' }}>{t.gprColCriticalShort || 'Крит.'}</div>
                    </div>

                  {/* Тело таблицы работ */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredWorks.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px', fontWeight: '800', height: '40px' }}>
                        {t.estEdWarningSelectWork || 'Работы отсутствуют в выбранном разделе WBS'}
                      </div>
                    ) : (
                      filteredWorks.map((w, idx) => {
                        const isCritical = !!gprData.criticalPath[w.id];
                        const isSelected = selectedGprWorkId === w.id;
                        return (
                          <div
                            key={`table-row-${w.id}`}
                            onClick={() => setSelectedGprWorkId(prev => prev === w.id ? null : w.id)}
                            style={{
                              display: 'flex', borderBottom: '1px solid #e2e8f0',
                              background: isSelected ? '#eff6ff' : 'white',
                              height: '40px', alignItems: 'center', fontSize: '11px', cursor: 'pointer', boxSizing: 'border-box'
                            }}
                          >
                            <div style={{ padding: '6px 8px', width: '35px', textAlign: 'center', fontWeight: '800', color: '#64748b' }}>{idx + 1}</div>
                            <div style={{ padding: '6px 8px', width: gprViewMode === 'table' ? 'calc(100% - 375px)' : '320px', fontWeight: '900', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.name}>🛠 {w.name}</div>
                            <div style={{ padding: '6px 8px', width: '100px', textAlign: 'right', fontWeight: '950', color: '#334155' }}>
                              {w.volume.toLocaleString('ru-RU')} <span style={{ color: '#64748b', fontSize: '9px', fontWeight: '750' }}>{w.unit}</span>
                            </div>
                            <div style={{ padding: '6px 8px', width: '100px', textAlign: 'center', fontWeight: '950', color: '#2563eb' }}>{w.duration_days} {t.schedDaysUnit || 'дн.'}</div>
                            <div style={{ padding: '6px 8px', width: '90px', textAlign: 'center', fontWeight: '750', color: '#475569' }}>{formatDateRu(w.start_date)}</div>
                            <div style={{ padding: '6px 8px', width: '50px', display: 'flex', justifyContent: 'center' }}>
                              {isCritical ? (
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e11d48' }} />
                              ) : (
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#cbd5e1' }} />
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

                {/* 2. Правая сплит-панель: временная шкала Ганта */}
                {gprViewMode !== 'table' && (
                  <div style={{
                  flex: 1, background: '#fcfcfd', position: 'relative',
                  width: `${timelineDates.daysArray.length * columnWidth}px`
                }}>
                  {/* Шапка диаграммы */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', background: '#ffffff',
                    borderBottom: '2px solid #cbd5e1', height: '47px', boxSizing: 'border-box'
                  }}>
                    {/* Строка месяцев */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #dbeafe', height: '25px', boxSizing: 'border-box' }}>
                      {timelineHeaders.months.map((mHeader, idx) => (
                        <div
                          key={idx}
                          style={{
                            width: `${mHeader.span * columnWidth}px`, minWidth: `${mHeader.span * columnWidth}px`,
                            textAlign: 'center', borderRight: '1px solid #dbeafe',
                            fontSize: '10px', fontWeight: '900', color: '#1e3a8a', background: '#e0f2fe',
                            height: '24px', boxSizing: 'border-box',
                            letterSpacing: '0.5px', textTransform: 'uppercase',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                          }}
                        >
                          {mHeader.name}
                        </div>
                      ))}
                    </div>

                    {/* Строка подячеек */}
                    <div style={{ display: 'flex', height: '22px', boxSizing: 'border-box' }}>
                      {timelineHeaders.subcells.map((subcell, idx) => (
                        <div
                          key={idx}
                          style={{
                            width: `${subcell.span * columnWidth}px`, minWidth: `${subcell.span * columnWidth}px`,
                            textAlign: 'center', borderRight: '1px solid #f1f5f9',
                            fontSize: '10px', fontWeight: '800',
                            color: subcell.isWeekend ? '#ef4444' : '#475569',
                            background: subcell.isWeekend ? '#ffe4e6' : '#ffffff',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            height: '22px', boxSizing: 'border-box', overflow: 'hidden'
                          }}
                        >
                          <span>{subcell.label}</span>
                          {subcell.sublabel && scaleMode === 'days' && <span style={{ fontSize: '8px', color: '#94a3b8' }}>{subcell.sublabel}</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Тело диаграммы Ганта (Строки баров с фоновой сеткой) */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    backgroundImage: 'linear-gradient(to right, #f1f5f9 1px, transparent 1px)',
                    backgroundSize: `${columnWidth}px 100%`,
                    width: `${timelineDates.daysArray.length * columnWidth}px`
                  }}>
                    {/* SVG overlay for Gantt dependencies */}
                    {gprData && gprData.dependencies && (
                      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
                        <defs>
                          <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                            <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#3b82f6" />
                          </marker>
                          <marker id="arrow-critical" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                            <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#e11d48" />
                          </marker>
                        </defs>
                        {gprData.dependencies.map((dep, idx) => {
                          const predWork = filteredWorks.find(w => w.id === dep.predecessor_id);
                          const succWork = filteredWorks.find(w => w.id === dep.successor_id);
                          if (!predWork || !succWork) return null;

                          const predIdx = filteredWorks.indexOf(predWork);
                          const succIdx = filteredWorks.indexOf(succWork);
                          if (predIdx === -1 || succIdx === -1) return null;

                          const y1 = predIdx * 40 + 20;
                          const y2 = succIdx * 40 + 20;

                          const predDaysOffset = Math.max(0, getDaysBetween(timelineDates.startStr, predWork.start_date));
                          const predLeft = predDaysOffset * columnWidth;
                          const predWidth = predWork.duration_days * columnWidth;

                          const succDaysOffset = Math.max(0, getDaysBetween(timelineDates.startStr, succWork.start_date));
                          const succLeft = succDaysOffset * columnWidth;
                          const succWidth = succWork.duration_days * columnWidth;

                          let x1, x2;
                          if (dep.type === 'FS') {
                            x1 = predLeft + predWidth;
                            x2 = succLeft;
                          } else if (dep.type === 'SS') {
                            x1 = predLeft;
                            x2 = succLeft;
                          } else if (dep.type === 'FF') {
                            x1 = predLeft + predWidth;
                            x2 = succLeft + succWidth;
                          } else if (dep.type === 'SF') {
                            x1 = predLeft;
                            x2 = succLeft + succWidth;
                          }

                          const pathD = getGanttLinkPath(x1, y1, x2, y2, dep.type);
                          const isCriticalLink = !!gprData.criticalPath[predWork.id] && !!gprData.criticalPath[succWork.id];

                          return (
                            <g key={`gpr-link-${idx}`}>
                              <path
                                d={pathD}
                                fill="none"
                                stroke={isCriticalLink ? '#e11d48' : '#3b82f6'}
                                strokeWidth="1.5"
                                strokeDasharray={dep.type === 'FS' ? 'none' : '4 3'}
                                markerEnd={isCriticalLink ? 'url(#arrow-critical)' : 'url(#arrow)'}
                              />
                            </g>
                          );
                        })}
                      </svg>
                    )}
                    {filteredWorks.length === 0 ? (
                      <div style={{ height: '40px' }} />
                    ) : (
                      filteredWorks.map((w) => {
                        const isCritical = !!gprData.criticalPath[w.id];
                        const isSelected = selectedGprWorkId === w.id;
                        
                        const workStart = new Date(w.start_date);
                        const daysOffset = Math.max(0, getDaysBetween(timelineDates.startStr, w.start_date));
                        const leftOffset = daysOffset * columnWidth;
                        const barWidth = w.duration_days * columnWidth;

                        return (
                          <div
                            key={`gantt-row-${w.id}`}
                            onClick={() => setSelectedGprWorkId(prev => prev === w.id ? null : w.id)}
                            style={{
                              height: '40px', borderBottom: '1px solid #e2e8f0', position: 'relative',
                              display: 'flex', alignItems: 'center', background: isSelected ? '#eff6ff' : 'transparent',
                              cursor: 'pointer', boxSizing: 'border-box', width: '100%'
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                left: `${leftOffset}px`,
                                width: `${barWidth}px`,
                                height: '18px',
                                borderRadius: '4px',
                                backgroundColor: isCritical ? '#e11d48' : '#2563eb',
                                boxShadow: isCritical ? '0 0 6px rgba(225,29,72,0.3)' : '0 0 6px rgba(37,99,235,0.2)',
                                transition: 'transform 0.15s, opacity 0.15s',
                                opacity: isSelected ? 0.9 : 1,
                                transform: isSelected ? 'scaleY(1.15)' : 'none',
                                zIndex: 5,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 6px',
                                color: 'white',
                                fontSize: '9px',
                                fontWeight: '800',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis'
                              }}
                              title={`${w.name}: ${formatDateRu(w.start_date)} - ${formatDateRu(addDaysToDate(w.start_date, w.duration_days - 1))}`}
                            >
                              {w.name}
                            </div>

                            {/* Информация о количестве людей справа от бара Гантта */}
                            <div
                              style={{
                                position: 'absolute',
                                left: `${leftOffset + barWidth + 8}px`,
                                display: 'flex',
                                alignItems: 'center',
                                fontSize: '10px',
                                fontWeight: '900',
                                color: '#059669',
                                background: '#ecfdf5',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                                height: '18px',
                                pointerEvents: 'none',
                                zIndex: 4
                              }}
                            >
                              👥 {Math.max(1, Math.round((w.volume * 1.5) / (w.duration_days * 8 || 8)))} {t.gprUnitPeople || 'чел.'}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              </div>
            </div>
          </div>

          {/* Боковая панель: Карточка работы (выдвигается при выборе) */}
          {selectedWork && (
            <div style={{ width: '320px', background: 'white', borderLeft: '1px solid #cbd5e1', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '550px', overflowY: 'auto', flexShrink: 0, position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '250px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '800', color: '#2563eb', textTransform: 'uppercase' }}>
                    {t.gprLblCode || 'Код'}: {selectedWork.code || '—'}
                  </span>
                  <h5 style={{ margin: 0, fontSize: '13px', fontWeight: '950', color: '#0f172a', lineHeight: '1.4' }}>
                    {selectedWork.name}
                  </h5>
                </div>
                <button 
                  onClick={() => setSelectedGprWorkId(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', padding: '4px', borderRadius: '6px' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Вкладки карточки работы */}
              <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '850' }}>
                <button 
                  onClick={() => setActiveDrawerTab('info')}
                  style={{ flex: 1, padding: '8px 0', borderBottom: activeDrawerTab === 'info' ? '2.5px solid #2563eb' : '2.5px solid transparent', color: activeDrawerTab === 'info' ? '#2563eb' : '#64748b', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: '900' }}
                >
                  {t.gprTabGeneralInfo || 'Общая информация'}
                </button>
                <button 
                  onClick={() => setActiveDrawerTab('links')}
                  style={{ flex: 1, padding: '8px 0', borderBottom: activeDrawerTab === 'links' ? '2.5px solid #2563eb' : '2.5px solid transparent', color: activeDrawerTab === 'links' ? '#2563eb' : '#64748b', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: '900' }}
                >
                  {t.gprTabLinks || 'Связи'}
                </button>
                <button 
                  onClick={() => setActiveDrawerTab('resources')}
                  style={{ flex: 1, padding: '8px 0', borderBottom: activeDrawerTab === 'resources' ? '2.5px solid #2563eb' : '2.5px solid transparent', color: activeDrawerTab === 'resources' ? '#2563eb' : '#64748b', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: '900' }}
                >
                  {t.gprTabResources || 'Ресурсы'}
                </button>
              </div>

              {/* Содержимое вкладок */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '11px' }}>
                {activeDrawerTab === 'info' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblName || 'Наименование'}</span>
                      <span style={{ fontWeight: '800', color: '#0f172a', marginTop: '2px', display: 'block' }}>{selectedWork.name}</span>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblVolume || 'Объем'}</span>
                        <span style={{ fontWeight: '850', color: '#0f172a', marginTop: '2px', display: 'block' }}>
                          {selectedWork.volume.toLocaleString('ru-RU')} {selectedWork.unit}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblDuration || 'Продолжительность'}</span>
                        <span style={{ fontWeight: '850', color: '#2563eb', marginTop: '2px', display: 'block' }}>
                          {selectedWork.duration_days} {t.schedDaysUnit || 'дн.'}
                        </span>
                      </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblStart || 'Начало'}</span>
                        <span style={{ fontWeight: '800', color: '#0f172a', marginTop: '2px', display: 'block' }}>
                          {formatDateRu(selectedWork.start_date)}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblEnd || 'Окончание'}</span>
                        <span style={{ fontWeight: '800', color: '#0f172a', marginTop: '2px', display: 'block' }}>
                          {formatDateRu(addDaysToDate(selectedWork.start_date, selectedWork.duration_days - 1))}
                        </span>
                      </div>
                    </div>
                    
                    <div>
                      <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblAssignee || 'Ответственный'}</span>
                      <span style={{ fontWeight: '800', color: '#0f172a', marginTop: '2px', display: 'block' }}>
                        {selectedWork.assignee_type === 'department' && `🏢 ${t.gprAssigneeDepartment || 'Отдел'}: `}
                        {selectedWork.assignee_type === 'contractor' && `🚜 ${t.gprAssigneeContractor || 'Подрядчик'}: `}
                        {selectedWork.assignee_type === 'employee' && `👤 ${t.gprAssigneeEmployee || 'Сотрудник'}: `}
                        {selectedWork.assignee_name || '—'}
                      </span>
                    </div>
                    
                    <div>
                      <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblCriticalPath || 'Критический путь'}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: selectedWork.id && gprData.criticalPath[selectedWork.id] ? '#ef4444' : '#cbd5e1' }} />
                        <span style={{ fontWeight: '900', color: selectedWork.id && gprData.criticalPath[selectedWork.id] ? '#ef4444' : '#475569' }}>
                          {selectedWork.id && gprData.criticalPath[selectedWork.id] ? (t.gprYes || 'Да') : (t.gprNo || 'Нет')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                
                {activeDrawerTab === 'links' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblPredecessorLinks || 'Связи-предшественники'}</span>
                    {selectedWorkDependencies.length === 0 ? (
                      <div style={{ padding: '20px 10px', textAlign: 'center', color: '#64748b', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                        {t.gprNoLinks || 'Нет связей'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {selectedWorkDependencies.map(dep => (
                          <div key={dep.id} style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontWeight: '850', color: '#0f172a', lineHeight: '1.3' }}>
                              {dep.predecessorCode ? `[${dep.predecessorCode}] ` : ''}{dep.predecessorName}
                            </span>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: '800', color: '#64748b' }}>
                              <span>{t.gprLinkType || 'Тип связи'}: {dep.type || 'FS'}</span>
                              <span>{t.gprLinkLag || 'Запаздывание'}: {dep.lag || 0} {t.schedDaysUnit || 'дн.'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeDrawerTab === 'resources' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <span style={{ fontWeight: '800', color: '#64748b', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{t.gprLblWorkResources || 'Ресурсы работы'}</span>
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1', color: '#475569', fontWeight: '850' }}>
                            <th style={{ padding: '6px 8px' }}>{t.psdColName || 'Название'}</th>
                            <th style={{ padding: '6px 8px' }}>{t.colResType || 'Тип'}</th>
                            <th style={{ padding: '6px 8px' }}>{t.gprColUnit || 'Ед. изм.'}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t.gprResColQty || 'Кол-во'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedWorkResources.map(res => (
                            <tr key={res.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              <td style={{ padding: '6px 8px', color: '#0f172a', fontWeight: '800' }}>{res.name}</td>
                              <td style={{ padding: '6px 8px', color: '#64748b', fontWeight: '750' }}>{res.type}</td>
                              <td style={{ padding: '6px 8px', color: '#64748b', fontWeight: '750' }}>{res.unit}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '900', color: '#2563eb' }}>
                                {res.qty}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      ) : null}

      {currentView === 'distribution' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {!activeDistWorkId ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ width: '100%', overflowX: 'auto', background: 'white', borderRadius: '16px', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }}>
                <table style={{ width: '100%', minWidth: '1600px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1', color: '#475569', fontWeight: '850' }}>
                      <th style={{ padding: '12px 14px', width: '70px' }}>{t.colCode || 'Код'}</th>
                      <th style={{ padding: '12px 14px', width: '220px' }}>{t.gprColWork || 'Наименование работы'}</th>
                      <th style={{ padding: '12px 14px', width: '100px' }}>{t.tabAllEstimates || 'Смета'}</th>
                      <th style={{ padding: '12px 14px', width: '160px' }}>{t.gprColZonePhaseDiscipline || 'Зона / Фаза / Дисциплина'}</th>
                      <th style={{ padding: '12px 14px', width: '140px' }}>{t.gprColConstruct || 'Конструктив (WBS)'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '60px' }}>{t.gprColUnit || 'Ед. изм.'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', width: '90px' }}>{t.gprColTotalVolume || 'Общий объем'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '85px' }}>{t.gprColStart || 'Дата начала'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '85px' }}>{t.gprColEnd || 'Дата окончания'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '80px' }}>{t.gprColDuration || 'Длительность'}</th>
                      {SHOW_GPR_DIST_RESPONSIBLE_COLUMN && <th style={{ padding: '12px 14px', width: '150px' }}>{t.gprLblAssignee || 'Ответственный'}</th>}
                      <th style={{ padding: '12px 14px', width: '130px' }}>{t.gprColMethod || 'Способ распределения'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', width: '90px' }}>{t.gprColDistributed || 'Распределено'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', width: '90px' }}>{t.gprColRemaining || 'Остаток'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '50px' }}>%</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '140px' }}>{t.gprColStatus || 'Статус'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center', width: '110px', position: 'sticky', right: 0, background: '#f8fafc', borderLeft: '1px solid #cbd5e1', zIndex: 10 }}>{t.actions || 'Действие'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gprData?.works || []).map(w => {
                      const stats = workDistributionStatus[w.id] || { totalDist: 0, percent: 0, status: 'not_distributed', method: '—' };
                      const meta = docMetaMap[w.doc_id] || { code: '—', zone: '—', phase: '—', discipline: '—' };
                      const isZeroVolume = w.volume <= 0;
                      
                      return (
                        <tr key={w.id} style={{ borderBottom: '1px solid #cbd5e1', color: '#334155', background: 'white' }}>
                          <td style={{ padding: '14px 12px', fontWeight: '800', color: '#64748b' }}>{w.code || '—'}</td>
                          <td style={{ padding: '14px 12px', fontWeight: '900', color: '#0f172a' }}>🛠 {w.name}</td>
                          <td style={{ padding: '14px 12px', fontWeight: '800', color: '#2563eb' }}>{meta.code}</td>
                          <td style={{ padding: '14px 12px', fontWeight: '750', color: '#475569' }}>
                            {meta.zone !== '—' || meta.phase !== '—' || meta.discipline !== '—'
                              ? `${meta.zone} / ${meta.phase} / ${meta.discipline}`
                              : '—'}
                          </td>
                          <td style={{ padding: '14px 12px', fontWeight: '750', color: '#475569' }}>{getWorkWbsName(w.wbs_id)}</td>
                          <td style={{ padding: '14px 12px', textAlign: 'center', color: '#64748b', fontWeight: '750' }}>{w.unit}</td>
                          <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: '900' }}>
                            {w.volume.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '14px 12px', textAlign: 'center', fontWeight: '750' }}>{formatDateRu(w.start_date)}</td>
                          <td style={{ padding: '14px 12px', textAlign: 'center', fontWeight: '750' }}>{formatDateRu(addDaysToDate(w.start_date, w.duration_days - 1))}</td>
                          <td style={{ padding: '14px 12px', textAlign: 'center', color: '#2563eb', fontWeight: '800' }}>{w.duration_days} {t.schedDaysUnit || 'дн.'}</td>

                          {/* Ответственный — скрыт, см. SHOW_GPR_DIST_RESPONSIBLE_COLUMN */}
                          {SHOW_GPR_DIST_RESPONSIBLE_COLUMN && (
                            <td style={{ padding: '14px 12px', color: '#475569', fontWeight: '750' }}>
                              {w.assignee_type === 'department' && '🏢 '}
                              {w.assignee_type === 'contractor' && '🚜 '}
                              {w.assignee_type === 'employee' && '👤 '}
                              {w.assignee_name || '—'}
                            </td>
                          )}

                          <td style={{ padding: '14px 12px', color: '#475569', fontWeight: '750' }}>{stats.method}</td>
                          <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: '900', color: '#2563eb' }}>
                            {stats.totalDist.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: '900', color: stats.status === 'distributed' ? '#10b981' : '#ea580c' }}>
                            {Math.max(0, w.volume - stats.totalDist).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '14px 12px', textAlign: 'center', fontWeight: '900', color: '#2563eb' }}>{stats.percent.toFixed(0)}%</td>
                          
                          {/* Статус */}
                          <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                            {stats.status === 'requires_redistribution' ? (
                              <span style={{ padding: '4px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '850', background: '#ffe4e6', color: '#e11d48' }}>{t.gprStatusRequiresRedistribution || 'Требует перераспределения'}</span>
                            ) : stats.status === 'excess' ? (
                              <span style={{ padding: '4px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '850', background: '#fee2e2', color: '#ef4444' }}>{t.gprStatusExcess || 'Превышение'}</span>
                            ) : stats.status === 'distributed' ? (
                              <span style={{ padding: '4px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '850', background: '#ecfdf5', color: '#10b981' }}>{t.gprStatusDistributed || 'Распределено'}</span>
                            ) : stats.status === 'partially' ? (
                              <span style={{ padding: '4px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '850', background: '#eff6ff', color: '#2563eb' }}>{t.gprStatusPartiallyDistributed || 'Частично'}</span>
                            ) : (
                              <span style={{ padding: '4px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '850', background: '#f1f5f9', color: '#64748b' }}>{t.gprStatusNotDistributed || 'Не распределено'}</span>
                            )}
                          </td>

                          <td style={{ padding: '14px 12px', textAlign: 'center', position: 'sticky', right: 0, background: 'white', borderLeft: '1px solid #cbd5e1', zIndex: 10 }}>
                            <button 
                              disabled={isZeroVolume}
                              onClick={() => {
                                setActiveDistWorkId(w.id);
                                const dists = (gprData.distributions || []).filter(d => d.work_id === w.id);
                                if (dists.length > 0) {
                                  const method = dists[0].period_type;
                                  setDistMethod(method);
                                  // Если даты работы в КП сдвинулись — автоматически пересчитываем
                                  // периоды под новые даты, сохраняя ранее введённый общий объём
                                  // (пропорционально по дням), вместо того чтобы грузить устаревшее
                                  // распределение as-is и просить пользователя чинить его вручную.
                                  if (method !== 'custom' && isDistributionOutOfSync(w, gprData.distributions)) {
                                    const totalVolume = dists.reduce((s, d) => s + Number(d.volume || 0), 0);
                                    setDistPeriods(redistributeVolumeForNewDates(w, method, totalVolume));
                                  } else {
                                    setDistPeriods(dists.map(d => ({
                                      period_start: d.period_start,
                                      period_end: d.period_end,
                                      volume: d.volume,
                                      period_label: d.period_label
                                    })));
                                  }
                                } else {
                                  setDistMethod('custom');
                                  let endDateStr = '';
                                  if (w.start_date && w.duration_days) {
                                    endDateStr = addDaysToDate(w.start_date, parseInt(w.duration_days, 10) - 1);
                                  }
                                  setDistPeriods([{
                                    period_start: w.start_date || '',
                                    period_end: endDateStr,
                                    volume: Number(w.volume) || 0,
                                    period_label: t.gprDefaultPeriodLabel || 'Период выполнения'
                                  }]);
                                }
                                setEditAssigneeType(w.assignee_type || 'employee');
                                setEditAssigneeId(w.assignee_id || null);
                                setEditAssigneeName(w.assignee_name || '');
                              }} 
                              style={{ 
                                padding: '6px 14px', fontSize: '11px', 
                                background: isZeroVolume ? '#cbd5e1' : isReadonly ? '#10b981' : '#2563eb', 
                                border: 'none', borderRadius: '8px', 
                                cursor: isZeroVolume ? 'not-allowed' : 'pointer', 
                                fontWeight: '850', color: 'white',
                                boxShadow: isZeroVolume ? 'none' : isReadonly ? '0 2px 4px rgba(16,185,129,0.1)' : '0 2px 4px rgba(37,99,235,0.1)'
                              }}
                            >
                              {isReadonly ? (t.gprBtnView || 'Просмотр') : (t.gprBtnDistributeAction || 'Распределить')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px 16px', border: '1px solid #cbd5e1', borderRadius: '12px', fontSize: '12px', fontWeight: '800', color: '#475569' }}>
                {t.gprTotalWorksLabel || 'Всего работ'}: {gprData?.works?.length || 0}
              </div>
            </div>
          ) : (
            <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px' }}>
                <span style={{ fontSize: '14px', fontWeight: '900', color: '#0f172a' }}>
                  🛠 {t.gprDistWorkPrefix || 'Распределение объемов работы:'} {activeWork?.name}
                </span>
                <button
                  onClick={() => handleCancelEdit()}
                  style={{ padding: '6px 16px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', fontSize: '12px', color: '#2563eb', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {t.gprBtnBackToList || 'Вернуться к списку'} <ChevronDown size={14} style={{ transform: 'rotate(90deg)' }} />
                </button>
              </div>

              {/* Параметры работы */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', background: '#ffffff', padding: '12px 14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColUnit || 'Ед. изм.'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '850', color: '#0f172a', marginTop: '2px' }}>{activeWork?.unit}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColTotalVolume || 'Общий объем'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>
                    {activeWork?.volume.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColStart || 'Дата начала'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '850', color: '#0f172a', marginTop: '2px' }}>{formatDateRu(activeWork?.start_date)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColEnd || 'Дата окончания'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '850', color: '#0f172a', marginTop: '2px' }}>{formatDateRu(addDaysToDate(activeWork?.start_date, activeWork?.duration_days - 1))}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColDuration || 'Длительность'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '850', color: '#0f172a', marginTop: '2px' }}>{activeWork?.duration_days} {t.schedDaysUnit || 'дн.'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColDistributed || 'Распределено'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>
                    {distSummary.sum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColRemaining || 'Остаток'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>
                    {distSummary.remaining.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>%</div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{distSummary.percent.toFixed(0)}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColStatus || 'Статус'}</div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color: hasValidationError ? '#ef4444' : distSummary.sum > activeWork?.volume ? '#ef4444' : distSummary.isMatch ? '#10b981' : '#ea580c', marginTop: '2px' }}>
                    {hasValidationError ? (t.gprErrorLabel || 'Ошибка') : distSummary.sum > activeWork?.volume ? (t.gprStatusExcess || 'Превышение') : distSummary.isMatch ? (t.gprStatusDistributed || 'Распределено') : distSummary.sum > 0 ? (t.gprStatusPartiallyDistributed || 'Частично') : (t.gprStatusNotDistributed || 'Не распределено')}
                  </div>
                </div>
              </div>

              {/* Выбор метода и ответственного */}
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: '240px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '900', color: '#475569', textTransform: 'uppercase' }}>{t.gprColMethod || 'Способ распределения'}</span>
                  <select 
                    style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontWeight: '800', fontSize: '12px', outline: 'none', background: 'white' }}
                    value={distMethod}
                    onChange={(e) => handleMethodChange(e.target.value)}
                    disabled={isReadonly}
                  >
                    <option value="custom">{t.gprMethodCustom || 'Произвольный период'}</option>
                  </select>
                </div>

                <div style={{ display: 'none', flexDirection: 'column', gap: '8px', flex: 1.5, minWidth: '320px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '900', color: '#475569', textTransform: 'uppercase' }}>{t.gprLblAssignee || 'Ответственный'}</span>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <select
                      value={editAssigneeType}
                      onChange={(e) => {
                        setEditAssigneeType(e.target.value);
                        setEditAssigneeId(null);
                        setEditAssigneeName('');
                      }}
                      style={{ flex: 1, padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontWeight: '800', fontSize: '12px', outline: 'none', background: 'white' }}
                    >
                      <option value="employee">{t.gprAssigneeEmployee || 'Сотрудник'}</option>
                      <option value="department">{t.gprAssigneeDepartment || 'Отдел'}</option>
                      <option value="contractor">{t.gprAssigneeContractor || 'Подрядчик / ИП'}</option>
                    </select>

                    {editAssigneeType === 'employee' && (
                      <select
                        value={editAssigneeId || ''}
                        onChange={(e) => setEditAssigneeId(e.target.value || null)}
                        style={{ flex: 1.5, padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontWeight: '800', fontSize: '12px', outline: 'none', background: 'white' }}
                      >
                        <option value="">{t.gprSelectEmployeePlaceholder || '-- Выберите сотрудника --'}</option>
                        {Array.isArray(estimatorsList) && estimatorsList.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.first_name || m.last_name ? `${m.first_name || ''} ${m.last_name || ''}`.trim() : m.email}
                          </option>
                        ))}
                      </select>
                    )}

                    {editAssigneeType === 'department' && (
                      <select
                        value={editAssigneeName}
                        onChange={(e) => setEditAssigneeName(e.target.value)}
                        style={{ flex: 1.5, padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontWeight: '800', fontSize: '12px', outline: 'none', background: 'white' }}
                      >
                        <option value="">{t.gprSelectDepartmentPlaceholder || '-- Выберите отдел --'}</option>
                        <option value="Отдел ПТО">{t.gprDeptPTO || 'Отдел ПТО'}</option>
                        <option value="Сметный отдел">{t.gprDeptEstimate || 'Сметный отдел'}</option>
                        <option value="Отдел снабжения">{t.gprDeptSupply || 'Отдел снабжения'}</option>
                        <option value="Строительный участок">{t.gprDeptSite || 'Строительный участок'}</option>
                        <option value="Бухгалтерия">{t.gprDeptAccounting || 'Бухгалтерия'}</option>
                      </select>
                    )}

                    {editAssigneeType === 'contractor' && (
                      <input
                        type="text"
                        placeholder={t.gprContractorNamePlaceholder || 'Введите название подрядчика'}
                        value={editAssigneeName}
                        onChange={(e) => setEditAssigneeName(e.target.value)}
                        style={{ flex: 1.5, padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontWeight: '800', fontSize: '12px', outline: 'none', background: 'white' }}
                      />
                    )}
                  </div>
                </div>
              </div>

              {activeWork && isDistributionOutOfSync(activeWork, gprData.distributions) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eff6ff', color: '#1e40af', padding: '12px 16px', borderRadius: '12px', fontSize: '12px', fontWeight: '800', border: '1px solid #bfdbfe', gap: '12px', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Info size={16} style={{ color: '#2563eb', flexShrink: 0 }} />
                    <span>{t.gprDatesChangedAutoAdjusted || 'Даты работы в календарном плане изменились — периоды и объёмы ниже уже автоматически пересчитаны под новые даты. Проверьте и сохраните.'}</span>
                  </div>
                  {distMethod && distMethod !== 'custom' && (
                    <button
                      onClick={() => {
                        const totalVolume = distPeriods.reduce((s, p) => s + Number(p.volume || 0), 0);
                        setDistPeriods(redistributeVolumeForNewDates(activeWork, distMethod, totalVolume));
                      }}
                      style={{ padding: '6px 12px', background: '#2563eb', border: 'none', borderRadius: '8px', fontSize: '11px', fontWeight: '850', color: 'white', cursor: 'pointer', flexShrink: 0 }}
                    >
                      {t.gprBtnRecalculateAgain || 'Пересчитать заново'}
                    </button>
                  )}
                </div>
              )}

              {distMethod && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#eff6ff', color: '#1e40af', padding: '10px 14px', borderRadius: '10px', fontSize: '11px', fontWeight: '750', border: '1px solid #bfdbfe' }}>
                  <Info size={14} />
                  <span>
                    {distMethod === 'day' && (t.gprPeriodsGeneratedByDays || 'Периоды сформированы по рабочим дням проекта')}
                    {distMethod === 'week' && (t.gprPeriodsGeneratedByWeeks || 'Периоды сформированы по календарным неделям')}
                    {distMethod === 'month' && (t.gprPeriodsGeneratedByMonths || 'Периоды сформированы по календарным месяцам')}
                    {distMethod === 'custom' && (t.gprAddPeriodsManually || 'Добавьте один или несколько периодов вручную.')}
                  </span>
                </div>
              )}

              {distMethod && (
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ flex: 2, minWidth: '400px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '900', color: '#475569', textTransform: 'uppercase' }}>{t.gprPeriodsTableTitle || 'Периоды распределения'}</span>
                    
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1', color: '#475569', fontWeight: '850', textAlign: 'left' }}>
                            {distMethod === 'custom' ? (
                              <>
                                <th style={{ padding: '10px 14px', width: '40px' }}>№</th>
                                <th style={{ padding: '10px 14px' }}>{t.gprColStart || 'Дата начала'}</th>
                                <th style={{ padding: '10px 14px' }}>{t.gprColEnd || 'Дата окончания'}</th>
                                <th style={{ padding: '10px 14px', textAlign: 'right' }}>{t.gprColPlannedVolume || 'Плановый объем'}, {activeWork?.unit}</th>
                                <th style={{ padding: '10px 14px', textAlign: 'center', width: '80px' }}>{t.actions || 'Действие'}</th>
                              </>
                            ) : distMethod === 'day' ? (
                              <>
                                <th style={{ padding: '10px 14px' }}>{t.gprColDateSingle || 'Дата'}</th>
                                <th style={{ padding: '10px 14px' }}>{t.gprColDayOfWeek || 'День недели'}</th>
                                <th style={{ padding: '10px 14px', textAlign: 'right' }}>{t.gprColPlannedVolume || 'Плановый объем'}, {activeWork?.unit}</th>
                              </>
                            ) : (
                              <>
                                <th style={{ padding: '10px 14px' }}>{t.gprColPeriodSingle || 'Период'}</th>
                                <th style={{ padding: '10px 14px' }}>{t.gprColStart || 'Дата начала'}</th>
                                <th style={{ padding: '10px 14px' }}>{t.gprColEnd || 'Дата окончания'}</th>
                                <th style={{ padding: '10px 14px', textAlign: 'right' }}>{t.gprColPlannedVolume || 'Плановый объем'}, {activeWork?.unit}</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {distPeriods.length === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontWeight: '750' }}>{t.gprPeriodsEmptyMsg || 'Периоды не добавлены'}</td>
                            </tr>
                          ) : (
                            distPeriods.map((p, idx) => {
                              let isInvalidDate = false;
                              if (p.period_start && p.period_end && activeWork) {
                                const pStart = new Date(p.period_start);
                                const pEnd = new Date(p.period_end);
                                const wStart = new Date(activeWork.start_date);
                                const wEnd = new Date(addDaysToDate(activeWork.start_date, activeWork.duration_days - 1));
                                if (pStart > pEnd || pStart < wStart || pEnd > wEnd) {
                                  isInvalidDate = true;
                                }
                                if (distMethod && distMethod !== 'custom' && isDistributionOutOfSync(activeWork, gprData?.distributions)) {
                                  isInvalidDate = true;
                                }
                              } else if (!p.period_start || !p.period_end) {
                                isInvalidDate = true;
                              }
                              const isInvalidVolume = Number(p.volume) < 0;

                              return (
                                <tr key={idx} style={{ borderBottom: '1px solid #cbd5e1', background: (isInvalidDate || isInvalidVolume) ? '#fef2f2' : 'white' }}>
                                  {distMethod === 'custom' ? (
                                    <>
                                      <td style={{ padding: '8px 14px', fontWeight: '800', color: '#64748b' }}>{idx + 1}</td>
                                      <td style={{ padding: '8px 14px' }}>
                                        <input 
                                          type="date" 
                                          style={{ padding: '6px 8px', borderRadius: '8px', border: isInvalidDate ? '1.5px solid #ef4444' : '1px solid #cbd5e1', fontSize: '12px', fontWeight: '750', outline: 'none' }}
                                          value={p.period_start}
                                          onChange={(e) => setDistPeriods(prev => prev.map((item, i) => i === idx ? { ...item, period_start: e.target.value } : item))}
                                          disabled={isReadonly}
                                        />
                                      </td>
                                      <td style={{ padding: '8px 14px' }}>
                                        <input 
                                          type="date" 
                                          style={{ padding: '6px 8px', borderRadius: '8px', border: isInvalidDate ? '1.5px solid #ef4444' : '1px solid #cbd5e1', fontSize: '12px', fontWeight: '750', outline: 'none' }}
                                          value={p.period_end}
                                          onChange={(e) => setDistPeriods(prev => prev.map((item, i) => i === idx ? { ...item, period_end: e.target.value } : item))}
                                          disabled={isReadonly}
                                        />
                                      </td>
                                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                                        <input 
                                          type="number"
                                          style={{ width: '140px', padding: '6px 10px', borderRadius: '8px', border: isInvalidVolume ? '1.5px solid #ef4444' : '1px solid #cbd5e1', textAlign: 'right', fontWeight: '850', outline: 'none' }}
                                          value={p.volume || ''}
                                          onChange={(e) => setDistPeriods(prev => prev.map((item, i) => i === idx ? { ...item, volume: parseFloat(e.target.value) || 0 } : item))}
                                          disabled={isReadonly}
                                        />
                                      </td>
                                      <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                                        {!isReadonly && (
                                          <button 
                                            onClick={() => setDistPeriods(prev => prev.filter((_, i) => i !== idx))}
                                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </td>
                                    </>
                                  ) : distMethod === 'day' ? (
                                    <>
                                      <td style={{ padding: '8px 14px', fontWeight: '750', color: '#1e293b' }}>{p.period_label}</td>
                                      <td style={{ padding: '8px 14px', fontWeight: '700', color: '#64748b' }}>{getDayOfWeekRu(p.period_start)}</td>
                                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                                        <input 
                                          type="number"
                                          style={{ width: '140px', padding: '6px 12px', borderRadius: '8px', border: isInvalidVolume ? '1.5px solid #ef4444' : '1px solid #cbd5e1', textAlign: 'right', fontWeight: '850', outline: 'none' }}
                                          value={p.volume || ''}
                                          onChange={(e) => setDistPeriods(prev => prev.map((item, i) => i === idx ? { ...item, volume: parseFloat(e.target.value) || 0 } : item))}
                                          disabled={isReadonly}
                                        />
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td style={{ padding: '8px 14px', fontWeight: '750', color: '#1e293b' }}>{p.period_label}</td>
                                      <td style={{ padding: '8px 14px', fontWeight: '700', color: '#475569' }}>{formatDateRu(p.period_start)}</td>
                                      <td style={{ padding: '8px 14px', fontWeight: '700', color: '#475569' }}>{formatDateRu(p.period_end)}</td>
                                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                                        <input 
                                          type="number"
                                          style={{ width: '140px', padding: '6px 12px', borderRadius: '8px', border: isInvalidVolume ? '1.5px solid #ef4444' : '1px solid #cbd5e1', textAlign: 'right', fontWeight: '850', outline: 'none' }}
                                          value={p.volume || ''}
                                          onChange={(e) => setDistPeriods(prev => prev.map((item, i) => i === idx ? { ...item, volume: parseFloat(e.target.value) || 0 } : item))}
                                          disabled={isReadonly}
                                        />
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {distMethod === 'custom' && !isReadonly && (
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <button 
                          onClick={() => setDistPeriods(prev => [...prev, { period_start: activeWork?.start_date, period_end: addDaysToDate(activeWork?.start_date, activeWork?.duration_days - 1), volume: 0, period_label: t.gprMethodCustom || 'Произвольный период' }])}
                          style={{ padding: '8px 16px', background: 'white', border: '1px solid #2563eb', borderRadius: '8px', fontSize: '12px', fontWeight: '850', color: '#2563eb', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Plus size={14} /> {t.gprBtnAddPeriod || 'Добавить период'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 0.8, minWidth: '240px', background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '16px', boxSizing: 'border-box' }}>
                    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColDistributed || 'Распределено'}</div>
                      <div style={{ fontSize: '15px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
                        {distSummary.sum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} &nbsp;{activeWork?.unit}
                      </div>
                    </div>

                    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColRemaining || 'Остаток'}</div>
                      <div style={{ fontSize: '15px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
                        {distSummary.remaining.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} &nbsp;{activeWork?.unit}
                      </div>
                    </div>

                    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.gprColPercentDistribution || '% распределения'}</div>
                      <div style={{ fontSize: '24px', fontWeight: '950', color: '#2563eb', marginTop: '4px' }}>
                        {distSummary.percent.toFixed(0)}%
                      </div>
                    </div>

                    <div style={{ paddingBottom: '10px' }}>
                      <span style={{
                        padding: '4px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: '900',
                        background: hasValidationError ? '#fee2e2' : distSummary.sum > activeWork?.volume ? '#fee2e2' : distSummary.isMatch ? '#ecfdf5' : '#fff7ed',
                        color: hasValidationError ? '#ef4444' : distSummary.sum > activeWork?.volume ? '#ef4444' : distSummary.isMatch ? '#047857' : '#ea580c'
                      }}>
                        {hasValidationError ? (t.gprErrorLabel || 'Ошибка') : distSummary.sum > activeWork?.volume ? (t.gprStatusExcess || 'Превышение') : distSummary.isMatch ? (t.gprStatusDistributed || 'Распределено') : distSummary.sum > 0 ? (t.gprStatusPartiallyDistributed || 'Частично') : (t.gprStatusNotDistributed || 'Не распределено')}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => handleCancelEdit()}
                          style={{ flex: 1, padding: '8px 10px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '11px', fontWeight: '850', color: '#475569', cursor: 'pointer' }}
                        >
                          {isReadonly ? (t.gprBtnBack || 'Назад') : (t.btnCancel || 'Отмена')}
                        </button>
                        {!isReadonly && (
                          <button
                            disabled={isSavingDist}
                            onClick={() => handleClearDistribution()}
                            style={{ flex: 1, padding: '8px 10px', background: '#fee2e2', border: 'none', borderRadius: '8px', fontSize: '11px', fontWeight: '850', color: '#ef4444', cursor: 'pointer' }}
                          >
                            {t.gprBtnClear || 'Очистить'}
                          </button>
                        )}
                      </div>
                      {!isReadonly && (
                        <button
                          onClick={() => handleSaveDistributionInline()}
                          disabled={isSavingDist || hasValidationError || distSummary.sum > activeWork?.volume}
                          style={{ padding: '10px', background: (isSavingDist || hasValidationError || distSummary.sum > activeWork?.volume) ? '#cbd5e1' : '#2563eb', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', color: (isSavingDist || hasValidationError || distSummary.sum > activeWork?.volume) ? '#94a3b8' : 'white', cursor: (isSavingDist || hasValidationError || distSummary.sum > activeWork?.volume) ? 'not-allowed' : 'pointer' }}
                        >
                          {isSavingDist ? (t.gprBtnSaving || 'Сохранение...') : (t.gprBtnSave || 'Сохранить')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

