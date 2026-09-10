import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronRight, ChevronDown, Table, BarChart3, RefreshCw, AlertTriangle, CheckCircle, FolderOpen, Cloud, Zap, Filter } from 'lucide-react';

const formatDateForInput = (dateObj) => {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateString = (str) => {
  if (!str) return null;
  const cleanStr = String(str).split('T')[0];
  const parts = cleanStr.split('-');
  if (parts.length !== 3) return null;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return isNaN(d.getTime()) ? null : d;
};

// Дата окончания = Дата начала + (Дней - 1)
const calculateEndDate = (startDateStr, durationDays) => {
  const start = parseDateString(startDateStr);
  const days = parseInt(durationDays, 10);
  if (!start || isNaN(days) || days <= 0) return '';
  const end = new Date(start);
  end.setDate(end.getDate() + (days - 1));
  return formatDateForInput(end);
};

const formatDisplayDate = (dateStr) => {
  const d = parseDateString(dateStr);
  if (!d) return dateStr || '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
};

const getGanttLinkPath = (x1, y1, x2, y2, type) => {
  if (type === 'FS') {
    if (x2 >= x1 + 10) {
      const xMid = x1 + 8;
      return `M ${x1} ${y1} H ${xMid} V ${y2} H ${x2}`;
    } else {
      // Overlap or negative lag
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

const clientTopologicalSort = (nodes, edges) => {
  const adj = {};
  const inDegree = {};
  nodes.forEach(id => {
    adj[id] = [];
    inDegree[id] = 0;
  });
  edges.forEach(e => {
    if (adj[e.predecessor_id]) {
      adj[e.predecessor_id].push(e.successor_id);
      inDegree[e.successor_id]++;
    }
  });
  const queue = [];
  nodes.forEach(id => {
    if (inDegree[id] === 0) queue.push(id);
  });
  const order = [];
  while (queue.length > 0) {
    const u = queue.shift();
    order.push(u);
    const neighbors = adj[u] || [];
    neighbors.forEach(v => {
      inDegree[v]--;
      if (inDegree[v] === 0) queue.push(v);
    });
  }
  return order;
};

const clientRecalculateSchedules = (worksState, edges, projStart) => {
  const nodes = Object.keys(worksState);
  const order = clientTopologicalSort(nodes, edges);

  const calculated = {};
  nodes.forEach(id => {
    calculated[id] = {
      ...worksState[id],
      start_date: worksState[id].start_date || projStart,
      duration_days: parseInt(worksState[id].duration_days, 10) || 1
    };
  });

  const incoming = {};
  nodes.forEach(id => { incoming[id] = []; });
  edges.forEach(dep => {
    if (incoming[dep.successor_id]) {
      incoming[dep.successor_id].push(dep);
    }
  });

  order.forEach(id => {
    const work = calculated[id];
    const deps = incoming[id] || [];
    if (deps.length === 0) return;

    let maxStart = parseDateString(work.start_date) || new Date();

    deps.forEach(dep => {
      const pred = calculated[dep.predecessor_id];
      if (!pred) return;

      let proposedStart = null;
      const predStartStr = pred.start_date;
      const predEndStr = calculateEndDate(predStartStr, pred.duration_days);

      if (dep.type === 'FS') {
        const d = parseDateString(predEndStr);
        if (d) {
          d.setDate(d.getDate() + 1 + (parseInt(dep.lag, 10) || 0));
          proposedStart = d;
        }
      } else if (dep.type === 'SS') {
        const d = parseDateString(predStartStr);
        if (d) {
          d.setDate(d.getDate() + (parseInt(dep.lag, 10) || 0));
          proposedStart = d;
        }
      } else if (dep.type === 'FF') {
        const d = parseDateString(predEndStr);
        if (d) {
          d.setDate(d.getDate() + (parseInt(dep.lag, 10) || 0));
          d.setDate(d.getDate() - parseInt(work.duration_days, 10) + 1);
          proposedStart = d;
        }
      } else if (dep.type === 'SF') {
        const d = parseDateString(predStartStr);
        if (d) {
          d.setDate(d.getDate() + (parseInt(dep.lag, 10) || 0));
          d.setDate(d.getDate() - parseInt(work.duration_days, 10) + 1);
          proposedStart = d;
        }
      }

      if (proposedStart && proposedStart > maxStart) {
        maxStart = proposedStart;
      }
    });

    const projectStartD = parseDateString(projStart);
    if (projectStartD && maxStart < projectStartD) {
      maxStart = projectStartD;
    }

    work.start_date = formatDateForInput(maxStart);
  });

  return calculated;
};

const wouldCreateCycle = (predId, succId, currentDeps, allWorkIds) => {
  if (predId === succId) return true;
  const tempDeps = [...currentDeps, { predecessor_id: predId, successor_id: succId }];
  
  const adj = {};
  allWorkIds.forEach(id => { adj[id] = []; });
  tempDeps.forEach(e => {
    if (adj[e.predecessor_id]) {
      adj[e.predecessor_id].push(e.successor_id);
    }
  });

  const visited = {};
  allWorkIds.forEach(id => { visited[id] = 0; });

  function dfs(u) {
    visited[u] = 1;
    const neighbors = adj[u] || [];
    for (const v of neighbors) {
      if (visited[v] === 1) return true;
      if (visited[v] === 0) {
        if (dfs(v)) return true;
      }
    }
    visited[u] = 2;
    return false;
  }

  for (const id of allWorkIds) {
    if (visited[id] === 0) {
      if (dfs(id)) return true;
    }
  }
  return false;
};

const GANTT_LOCALIZATION = {
  ru: {
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    weekdays: ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
    weekShort: 'нед.'
  },
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    weekdays: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    weekShort: 'wk.'
  },
  ka: {
    months: ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'],
    weekdays: ['კვ', 'ორ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'],
    weekShort: 'კვ.'
  },
  az: {
    months: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktabr', 'Noyabr', 'Dekabr'],
    weekdays: ['B', 'Be', 'Ça', 'Ç', 'Ca', 'C', 'Ş'],
    weekShort: 'həftə'
  }
};

const DurationInput = ({ work, onConfirm }) => {
  const [val, setVal] = useState(work.duration_days);

  useEffect(() => {
    setVal(work.duration_days);
  }, [work.duration_days]);

  const handleBlurOrEnter = () => {
    const newVal = parseInt(val, 10);
    if (isNaN(newVal) || newVal <= 0) {
      setVal(work.duration_days);
      return;
    }
    if (newVal !== parseInt(work.duration_days, 10)) {
      onConfirm(newVal);
    }
  };

  return (
    <input
      type="number"
      min="1"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={handleBlurOrEnter}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          handleBlurOrEnter();
          e.currentTarget.blur();
        }
      }}
      style={{
        width: '60px', padding: '6px 8px', borderRadius: '8px',
        border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '800',
        textAlign: 'center', outline: 'none'
      }}
    />
  );
};

export default function GeneralSchedulingTab({ objectId, currentObj, api, lang = 'ru', t = {} }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectData, setProjectData] = useState(null);
  const [wbsList, setWbsList] = useState([]);
  const [worksSchedule, setWorksSchedule] = useState({});
  const [managers, setManagers] = useState([]);
  const [collapsedWbs, setCollapsedWbs] = useState({});
  const [errorToast, setErrorToast] = useState('');
  const [successToast, setSuccessToast] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  const autoSaveTimerRef = useRef(null);

  const [activeView, setActiveView] = useState('table');
  const [scaleMode, setScaleMode] = useState('days'); // 'days' | 'weeks' | 'months'

  const [dependencies, setDependencies] = useState([]);
  const [criticalPath, setCriticalPath] = useState({});
  const [activeDependencyWorkId, setActiveDependencyWorkId] = useState(null);
  const [showDependencyModal, setShowDependencyModal] = useState(false);
  const [formPredecessorId, setFormPredecessorId] = useState('');
  const [formType, setFormType] = useState('FS');
  const [formLag, setFormLag] = useState('0');
  const [modalError, setModalError] = useState('');

  const [selectedWorkId, setSelectedWorkId] = useState(null);
  const [linkingSource, setLinkingSource] = useState(null); // { workId, edgeType: 'start'|'finish' }
  const [showCreateLinkModal, setShowCreateLinkModal] = useState(false);
  const [modalPredecessorId, setModalPredecessorId] = useState('');
  const [modalSuccessorId, setModalSuccessorId] = useState('');
  const [newDependencyType, setNewDependencyType] = useState('FS');
  const [newDependencyLag, setNewDependencyLag] = useState(0);

  const [showEditLinkModal, setShowEditLinkModal] = useState(false);
  const [editingDependency, setEditingDependency] = useState(null);

  const projectStartDate = useMemo(() => {
    const raw = projectData?.start_date;
    if (!raw) return formatDateForInput(new Date());
    return String(raw).split('T')[0];
  }, [projectData]);

  const projectEndDate = useMemo(() => {
    return projectData?.end_date || '';
  }, [projectData]);

  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [filterOnlyCritical, setFilterOnlyCritical] = useState(false);
  const [pendingCriticalChange, setPendingCriticalChange] = useState(null); // { workId, field, value, previousValue }

  const getDaysDifference = (d1Str, d2Str) => {
    const t1 = parseDateString(d1Str);
    const t2 = parseDateString(d2Str);
    if (!t1 || !t2) return 0;
    return Math.round((t1 - t2) / (1000 * 60 * 60 * 24));
  };

  const addDaysToDate = (dateStr, days) => {
    const d = parseDateString(dateStr);
    if (!d) return '';
    d.setDate(d.getDate() + days);
    return formatDateForInput(d);
  };

  const cpmData = useMemo(() => {
    const nodes = Object.keys(worksSchedule);
    const hasDeps = dependencies && dependencies.length > 0;
    
    const result = {};
    nodes.forEach(id => {
      const work = worksSchedule[id];
      const es = getDaysDifference(work.start_date, projectStartDate);
      const dur = parseInt(work.duration_days, 10) || 1;
      result[id] = {
        id,
        name: work.name,
        duration: dur,
        ES: es,
        EF: es + dur,
        LS: es,
        LF: es + dur,
        totalFloat: 0,
        isCritical: false
      };
    });
    
    if (!hasDeps || nodes.length === 0) {
      return result;
    }
    
    let projectFinishDays = 0;
    nodes.forEach(id => {
      if (result[id].EF > projectFinishDays) {
        projectFinishDays = result[id].EF;
      }
    });
    
    const outgoing = {};
    nodes.forEach(id => { outgoing[id] = []; });
    dependencies.forEach(dep => {
      if (outgoing[dep.predecessor_id]) {
        outgoing[dep.predecessor_id].push(dep);
      }
    });
    
    const order = clientTopologicalSort(nodes, dependencies);
    nodes.forEach(id => {
      if (!order.includes(id)) {
        order.push(id);
      }
    });
    
    const reversedOrder = [...order].reverse();
    reversedOrder.forEach(id => {
      const workCpm = result[id];
      if (!workCpm) return;
      const deps = outgoing[id] || [];
      
      if (deps.length === 0) {
        workCpm.LF = projectFinishDays;
      } else {
        let minLF = Infinity;
        deps.forEach(dep => {
          const succCpm = result[dep.successor_id];
          if (!succCpm) return;
          
          const lag = parseInt(dep.lag, 10) || 0;
          let proposedLF = Infinity;
          
          if (dep.type === 'FS') {
            proposedLF = succCpm.LS - 1 - lag;
          } else if (dep.type === 'SS') {
            const proposedLS = succCpm.LS - lag;
            proposedLF = proposedLS + workCpm.duration;
          } else if (dep.type === 'FF') {
            proposedLF = succCpm.LF - lag;
          } else if (dep.type === 'SF') {
            const proposedLS = succCpm.LF - lag;
            proposedLF = proposedLS + workCpm.duration;
          }
          
          if (proposedLF < minLF) {
            minLF = proposedLF;
          }
        });
        
        workCpm.LF = minLF;
      }
      
      workCpm.LS = workCpm.LF - workCpm.duration;
      workCpm.totalFloat = workCpm.LS - workCpm.ES;
      if (workCpm.totalFloat < 0) {
        workCpm.totalFloat = 0;
      }
      
      if (workCpm.totalFloat === 0) {
        workCpm.isCritical = true;
      }
    });
    
    return result;
  }, [worksSchedule, dependencies, projectStartDate]);

  useEffect(() => {
    if (objectId) {
      fetchScheduleData();
    }
  }, [objectId, lang]);

  const fetchScheduleData = async () => {
    setLoading(true);
    setErrorToast('');
    try {
      const res = await api.get(`/estimates/objects/${objectId}/general-schedule?lang=${lang}`);
      const payload = res.data || {};
      setProjectData(payload.project || currentObj?.project || null);
      setWbsList(payload.wbs || []);
      if (payload.wbs && payload.wbs.length > 0) {
        const initialCollapsed = {};
        payload.wbs.forEach(item => {
          initialCollapsed[item.id] = false;
        });
        setCollapsedWbs(initialCollapsed);
      }
      setManagers(payload.managers || []);
      setDependencies(payload.dependencies || []);
      setCriticalPath(payload.criticalPath || {});

      const defaultProjStart = payload.project?.start_date ? payload.project.start_date.split('T')[0] : formatDateForInput(new Date());

      const schedMap = {};
      (payload.works || []).forEach(w => {
        let cleanStartDate = w.start_date;
        if (cleanStartDate && cleanStartDate.includes('T')) {
          cleanStartDate = cleanStartDate.split('T')[0];
        }
        if (!cleanStartDate) {
          cleanStartDate = defaultProjStart;
        }

        schedMap[w.id] = {
          id: w.id,
          work_id: w.work_id,
          wbs_id: w.wbs_id,
          name: w.name,
          code: w.code,
          volume: w.volume,
          unit: w.unit,
          start_date: cleanStartDate,
          duration_days: w.duration_days || 1,
          assignee_id: w.assignee_id || '',
          error: ''
        };
      });
      setWorksSchedule(schedMap);
      setIsDirty(false);
    } catch (err) {
      console.error('[SCHEDULING FETCH ERROR]:', err);
      setErrorToast(err.response?.data?.error || 'Ошибка загрузки календарного плана');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDirectDependency = (predId, succId, type = 'FS', lag = 0) => {
    if (predId === succId) {
      setErrorToast("Работа не может зависеть сама от себя");
      return false;
    }
    const exists = dependencies.some(dep => dep.predecessor_id === predId && dep.successor_id === succId);
    if (exists) {
      setErrorToast("Эта связь уже существует.");
      return false;
    }
    const wouldCycle = wouldCreateCycle(predId, succId, dependencies, Object.keys(worksSchedule));
    if (wouldCycle) {
      setErrorToast("Невозможно создать зависимость. Обнаружена циклическая ссылка между работами");
      return false;
    }

    const newDep = {
      predecessor_id: predId,
      successor_id: succId,
      type,
      lag: parseInt(lag, 10) || 0
    };

    const nextDeps = [...dependencies, newDep];
    setDependencies(nextDeps);
    setIsDirty(true);

    try {
      const nextState = clientRecalculateSchedules(worksSchedule, nextDeps, projectStartDate);
      setWorksSchedule(nextState);
      triggerAutoSave(nextState, nextDeps);
      setSuccessToast("Связь успешно добавлена.");
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const handleUpdateDirectDependency = (predId, succId, type, lag) => {
    const nextDeps = dependencies.map(dep => {
      if (dep.predecessor_id === predId && dep.successor_id === succId) {
        return {
          ...dep,
          type,
          lag: parseInt(lag, 10) || 0
        };
      }
      return dep;
    });

    setDependencies(nextDeps);
    setIsDirty(true);

    try {
      const nextState = clientRecalculateSchedules(worksSchedule, nextDeps, projectStartDate);
      setWorksSchedule(nextState);
      triggerAutoSave(nextState, nextDeps);
      setSuccessToast("Связь успешно обновлена.");
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteDirectDependency = (predId, succId) => {
    const nextDeps = dependencies.filter(dep => !(dep.predecessor_id === predId && dep.successor_id === succId));
    setDependencies(nextDeps);
    setIsDirty(true);

    try {
      const nextState = clientRecalculateSchedules(worksSchedule, nextDeps, projectStartDate);
      setWorksSchedule(nextState);
      triggerAutoSave(nextState, nextDeps);
      setSuccessToast("Связь удалена.");
    } catch (e) {
      console.error(e);
    }
  };

  const handleLinkDoubleClick = (dep, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setEditingDependency(dep);
    setNewDependencyType(dep.type);
    setNewDependencyLag(dep.lag);
    setShowEditLinkModal(true);
  };

  const handleDotClick = (workId, edgeType, e) => {
    e.stopPropagation();
    if (linkingSource) {
      handleSelectTarget(workId, edgeType);
    } else {
      setLinkingSource({ workId, edgeType });
      setSuccessToast(`Связь начата от ${edgeType === 'start' ? 'начала' : 'окончания'} работы. Теперь кликните по точке назначения другой работы.`);
    }
  };

  const handleSelectTarget = (targetId, targetEdgeType = 'start') => {
    if (!linkingSource) return;
    const predId = linkingSource.workId;
    const succId = targetId;

    if (predId === succId) {
      setErrorToast("Работа не может быть связана сама с собой.");
      setLinkingSource(null);
      return;
    }

    const exists = dependencies.some(dep => dep.predecessor_id === predId && dep.successor_id === succId);
    if (exists) {
      setErrorToast("Эта связь уже существует.");
      setLinkingSource(null);
      return;
    }

    const wouldCycle = wouldCreateCycle(predId, succId, dependencies, Object.keys(worksSchedule));
    if (wouldCycle) {
      setErrorToast("Невозможно создать зависимость. Обнаружена циклическая ссылка между работами");
      setLinkingSource(null);
      return;
    }

    setModalPredecessorId(predId);
    setModalSuccessorId(succId);

    let defaultType = 'FS';
    if (linkingSource.edgeType === 'start' && targetEdgeType === 'start') defaultType = 'SS';
    else if (linkingSource.edgeType === 'finish' && targetEdgeType === 'finish') defaultType = 'FF';
    else if (linkingSource.edgeType === 'start' && targetEdgeType === 'finish') defaultType = 'SF';

    setNewDependencyType(defaultType);
    setNewDependencyLag(0);
    setShowCreateLinkModal(true);
    setLinkingSource(null);
  };

  const toggleWbsCollapse = (nodeId) => {
    setCollapsedWbs(prev => ({
      ...prev,
      [nodeId]: !prev[nodeId]
    }));
  };

  // Фильтруем исполнителей: показываем только сметчиков (role === 'estimator')
  const estimatorsList = useMemo(() => {
    const list = (managers || []).filter(m => m.role === 'estimator');
    // Если сметчиков в базе нет, возвращаем всех пользователей во избежание пустого списка
    return list.length > 0 ? list : managers;
  }, [managers]);

  // Валидация периода работы
  const validateWorkSchedule = (workState) => {
    const { start_date, duration_days } = workState;

    if (!start_date || String(start_date).trim() === '' || duration_days === undefined || duration_days === null || String(duration_days).trim() === '') {
      return 'Заполните обязательные поля периода выполнения';
    }

    const startD = parseDateString(start_date);
    if (!startD) {
      return 'Некорректная дата начала работы';
    }

    const days = parseInt(duration_days, 10);
    if (isNaN(days) || days <= 0) {
      return 'Продолжительность должна быть больше 0 дней.';
    }

    // Проверка даты начала проекта
    if (projectStartDate) {
      const projectStartD = parseDateString(projectStartDate);
      if (projectStartD && startD < projectStartD) {
        return `Дата начала работы не может быть меньше даты начала проекта (${projectStartDate})`;
      }
    }

    // Проверка пересечения периода с календарем проекта
    if (projectEndDate) {
      const projectEndD = parseDateString(projectEndDate);
      const workEndD = parseDateString(calculateEndDate(start_date, days));
      if (projectEndD && workEndD && workEndD > projectEndD) {
        return 'Выбранный период выходит за пределы календаря проекта.';
      }
    }

    return '';
  };

  // Авто-сохранение: выполняется через 1.5 сек после последнего изменения
  const triggerAutoSave = useCallback((currentSchedule, currentDeps = dependencies) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    setAutoSaveStatus('pending');
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving');
      setSaving(true);
      try {
        const scheduleEntries = Object.values(currentSchedule);
        // Проверяем валидность
        for (let w of scheduleEntries) {
          const err = validateWorkSchedule(w);
          if (err) {
            setAutoSaveStatus('error');
            setErrorToast(`Ошибка в работе «${w.name}»: ${err}`);
            setSaving(false);
            return;
          }
        }

        const payload = {};
        scheduleEntries.forEach(w => {
          payload[w.id] = {
            start_date: w.start_date,
            duration_days: parseInt(w.duration_days, 10) || 1,
            assignee_id: w.assignee_id || null,
            work_id: w.work_id || null
          };
        });

        const res = await api.post('/estimates/general-schedule-save', {
          object_id: objectId,
          schedules: payload,
          dependencies: currentDeps
        });

        if (res.data && res.data.success) {
          if (res.data.schedules) {
            setWorksSchedule(prev => {
              const next = { ...prev };
              Object.entries(res.data.schedules).forEach(([id, item]) => {
                if (next[id]) {
                  next[id].start_date = item.start_date;
                  next[id].duration_days = item.duration_days;
                }
              });
              return next;
            });
          }
          if (res.data.criticalPath) {
            setCriticalPath(res.data.criticalPath);
          }
        }

        setAutoSaveStatus('saved');
        setIsDirty(false);
        // Скрываем статус «Сохранено» через 3 сек
        setTimeout(() => setAutoSaveStatus('idle'), 3000);
      } catch (e) {
        console.error('[AUTO SAVE ERROR]:', e);
        setAutoSaveStatus('error');
        setErrorToast(e.response?.data?.error || 'Ошибка автосохранения');
      } finally {
        setSaving(false);
      }
    }, 1500);
  }, [objectId, api, dependencies]);

  const handleFieldChange = (workId, field, value) => {
    if (showCriticalPath && field === 'duration_days') {
      const current = worksSchedule[workId];
      if (current && cpmData[workId]?.isCritical) {
        const oldVal = parseInt(current.duration_days, 10) || 1;
        const newVal = parseInt(value, 10) || 1;
        if (newVal > oldVal) {
          setPendingCriticalChange({
            workId,
            field,
            value: newVal,
            previousValue: oldVal
          });
          return;
        }
      }
    }
    applyFieldChange(workId, field, value);
  };

  const applyFieldChange = (workId, field, value) => {
    setIsDirty(true);
    setWorksSchedule(prev => {
      const current = prev[workId];
      if (!current) return prev;

      const updated = { ...current, [field]: value };
      const err = validateWorkSchedule(updated);
      updated.error = err;

      if (err) {
        setErrorToast(err);
      } else if (errorToast) {
        setErrorToast('');
      }

      let nextState = { ...prev, [workId]: updated };

      // Расчет зависимых работ на клиенте
      if (!err && (field === 'start_date' || field === 'duration_days')) {
        try {
          nextState = clientRecalculateSchedules(nextState, dependencies, projectStartDate);
        } catch (calcErr) {
          console.error('[CLIENT RECALCULATION ERROR]:', calcErr);
        }
      }

      // Запускаем авто-сохранение с новым состоянием
      if (!err) {
        triggerAutoSave(nextState);
      }

      return nextState;
    });
  };

  // Очищаем таймер при размонтировании
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Сохранение по запросу (убрана ручная кнопка, оставлено для возможного внешнего вызова)

  // Рекурсивный фильтр WBS
  const hasWorksRecursive = useMemo(() => {
    const memo = {};
    const check = (nodeId) => {
      if (nodeId in memo) return memo[nodeId];
      const directWorks = Object.values(worksSchedule).filter(w => w.wbs_id === nodeId);
      if (directWorks.length > 0) {
        memo[nodeId] = true;
        return true;
      }
      const children = wbsList.filter(n => n.parent_id === nodeId);
      const hasChildrenWithWorks = children.some(child => check(child.id));
      memo[nodeId] = hasChildrenWithWorks;
      return hasChildrenWithWorks;
    };
    return check;
  }, [worksSchedule, wbsList]);

  // Настройка колонок и видимости диаграммы Ганта
  const columnWidth = useMemo(() => {
    if (scaleMode === 'weeks') return 10;
    if (scaleMode === 'months') return 3;
    return 36;
  }, [scaleMode]);

  const ganttRange = useMemo(() => {
    let minDate = parseDateString(projectStartDate) || new Date();
    let maxDate = new Date(minDate);
    
    // 365 дней видимости
    maxDate.setDate(maxDate.getDate() + 365);

    Object.values(worksSchedule).forEach(w => {
      if (w.start_date) {
        const s = parseDateString(w.start_date);
        if (s && s < minDate) minDate = s;
        const eStr = calculateEndDate(w.start_date, w.duration_days);
        const e = parseDateString(eStr);
        if (e && e > maxDate) maxDate = e;
      }
    });

    const startGantt = new Date(minDate);
    // Start exactly from the earliest date

    const endGantt = new Date(maxDate);
    endGantt.setDate(endGantt.getDate() + 30);

    const daysArray = [];
    const curr = new Date(startGantt);
    while (curr <= endGantt) {
      daysArray.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }

    return {
      startDate: startGantt,
      endDate: endGantt,
      daysArray
    };
  }, [worksSchedule, projectStartDate]);

  // Длительность всех работ: от даты начала самой ранней работы до даты окончания самой поздней (без учета отступов Ганта)
  const worksDurationDays = useMemo(() => {
    let minDate = null;
    let maxDate = null;

    Object.values(worksSchedule).forEach(w => {
      if (w.start_date) {
        const s = parseDateString(w.start_date);
        if (s && (!minDate || s < minDate)) minDate = s;
        const eStr = calculateEndDate(w.start_date, w.duration_days);
        const e = parseDateString(eStr);
        if (e && (!maxDate || e > maxDate)) maxDate = e;
      }
    });

    if (!minDate || !maxDate) return 0;
    return Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
  }, [worksSchedule]);

  const timelineHeaders = useMemo(() => {
    const months = [];
    let currentMonth = -1;
    let currentMonthHeader = null;
    const ganttLoc = GANTT_LOCALIZATION[lang] || GANTT_LOCALIZATION.ru;

    ganttRange.daysArray.forEach((dateObj, idx) => {
      const m = dateObj.getMonth();
      const y = dateObj.getFullYear();
      if (m !== currentMonth) {
        currentMonth = m;
        if (currentMonthHeader) months.push(currentMonthHeader);
        currentMonthHeader = { name: ganttLoc.months[m], year: y, span: 1 };
      } else {
        currentMonthHeader.span += 1;
      }
    });
    if (currentMonthHeader) months.push(currentMonthHeader);

    const subcells = [];
    if (scaleMode === 'days') {
      ganttRange.daysArray.forEach(dateObj => {
        subcells.push({
          label: dateObj.getDate(),
          sublabel: ganttLoc.weekdays[dateObj.getDay()],
          isWeekend: dateObj.getDay() === 0 || dateObj.getDay() === 6,
          span: 1
        });
      });
    } else if (scaleMode === 'weeks') {
      let weekSpan = 0;
      let weekStartDate = null;
      ganttRange.daysArray.forEach((dateObj, idx) => {
        if (weekSpan === 0) weekStartDate = dateObj;
        weekSpan++;
        
        if (dateObj.getDay() === 0 || idx === ganttRange.daysArray.length - 1) {
          subcells.push({
            label: `${weekStartDate.getDate()}.${String(weekStartDate.getMonth() + 1).padStart(2, '0')}`,
            sublabel: ganttLoc.weekShort,
            isWeekend: false,
            span: weekSpan
          });
          weekSpan = 0;
        }
      });
    } else {
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
  }, [ganttRange.daysArray, scaleMode]);

  const renderTableBlock = () => {
    const getChildrenWbs = (parentId) => wbsList.filter(node => node.parent_id === parentId);
    const getWorksForWbs = (wbsId) => Object.values(worksSchedule).filter(work => work.wbs_id === wbsId);

    const hasCriticalWorksRecursive = (wbsId) => {
      const works = getWorksForWbs(wbsId);
      const hasDirectCritical = works.some(w => cpmData[w.id]?.isCritical);
      if (hasDirectCritical) return true;
      const children = getChildrenWbs(wbsId);
      return children.some(child => hasCriticalWorksRecursive(child.id));
    };

    const renderWbsRow = (node, depth = 0) => {
      if (filterOnlyCritical) {
        if (!hasCriticalWorksRecursive(node.id)) return null;
      } else {
        if (!hasWorksRecursive(node.id)) return null;
      }

      const childrenWbs = getChildrenWbs(node.id);
      const works = getWorksForWbs(node.id);
      const isCollapsed = collapsedWbs[node.id] === true;

      const nameLang = lang === 'ka' ? 'ka' : (lang === 'ge' ? 'ka' : lang);
      const wbsName = node[`name_${nameLang}`] || node.name_ka || node.name_ge || node.name_az || node.name_en || node.name_ru || node.name;

      return (
        <div key={node.id} style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Раздел WBS */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 140px 100px 100px 180px 120px',
            alignItems: 'center', padding: '10px 20px', background: '#f8fafc',
            borderBottom: '1px solid #f1f5f9', borderLeft: depth === 0 ? '4px solid #6366f1' : '3px solid #94a3b8'
          }}>
            <div
              onClick={() => toggleWbsCollapse(node.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: `${depth * 16}px`, cursor: 'pointer', userSelect: 'none' }}
            >
              {isCollapsed ? <ChevronRight size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800', color: '#1e293b' }}>
                <FolderOpen size={14} color="#6366f1" />
                {wbsName}
              </span>
            </div>
            
            <div style={{ color: '#cbd5e1', fontWeight: 'bold' }}>—</div>
            <div style={{ color: '#cbd5e1', fontWeight: 'bold' }}>—</div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{ width: '50px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: '0%', height: '100%', background: '#10b981' }} />
              </div>
              <span style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8' }}>0%</span>
            </div>

            <div style={{ color: '#cbd5e1', fontWeight: 'bold' }}>—</div>

            {/* Действия: только крестик удаления */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '14px', fontWeight: 'bold' }}>
                ✕
              </button>
            </div>
          </div>

          {!isCollapsed && (
            <>
              {childrenWbs.map(child => renderWbsRow(child, depth + 1))}

              {works.filter(w => !filterOnlyCritical || cpmData[w.id]?.isCritical).map(w => {
                const isWorkSelected = selectedWorkId === w.id;
                return (
                  <div
                    key={w.id}
                    onClick={() => {
                      if (linkingSource) {
                        handleSelectTarget(w.id, 'start');
                      } else {
                        setSelectedWorkId(w.id);
                      }
                    }}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 140px 100px 100px 180px 120px',
                      alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #f1f5f9',
                      background: isWorkSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer'
                    }}
                  >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: `${(depth + 1) * 20}px` }}>
                    <span style={{
                      width: '6px', height: '6px',
                      background: '#3b82f6',
                      borderRadius: '50%', flexShrink: 0
                    }} />
                    <span style={{
                      fontSize: '12px',
                      fontWeight: '600',
                      color: '#334155'
                    }}>
                      {w.name}
                    </span>
                    {showCriticalPath && cpmData[w.id] !== undefined && (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: '800',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        marginLeft: '8px',
                        flexShrink: 0,
                        background: cpmData[w.id].isCritical ? '#ffe4e6' : '#f1f5f9',
                        color: cpmData[w.id].isCritical ? '#e11d48' : '#64748b',
                        border: cpmData[w.id].isCritical ? '1px solid #fda4af' : '1px solid #e2e8f0'
                      }}>
                        {cpmData[w.id].isCritical ? 'Критический путь' : `Резерв: ${cpmData[w.id].totalFloat} дн.`}
                      </span>
                    )}
                  </div>

                  <div>
                    <input
                      type="date"
                      value={w.start_date}
                      onChange={(e) => handleFieldChange(w.id, 'start_date', e.target.value)}
                      style={{
                        width: '120px', padding: '6px 8px', borderRadius: '8px',
                        border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', color: '#1e293b'
                      }}
                    />
                  </div>

                  <div>
                    <DurationInput
                      work={w}
                      onConfirm={(newVal) => handleFieldChange(w.id, 'duration_days', newVal)}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <div style={{ width: '50px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: '0%', height: '100%', background: '#10b981' }} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8' }}>0%</span>
                  </div>

                  {/* Выбор исполнителя: показываем только сметчиков */}
                  <div>
                    <select
                      value={w.assignee_id || ''}
                      onChange={(e) => handleFieldChange(w.id, 'assignee_id', e.target.value)}
                      style={{
                        width: '160px', padding: '6px 8px', borderRadius: '8px',
                        border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', color: '#334155', background: '#ffffff'
                      }}
                    >
                      <option value="">—</option>
                      {estimatorsList.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.first_name || m.last_name ? `${m.first_name || ''} ${m.last_name || ''}`.trim() : m.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      onClick={() => {
                        setActiveDependencyWorkId(w.id);
                        setShowDependencyModal(true);
                      }}
                      style={{
                        background: '#f1f5f9', border: '1px solid #e2e8f0', cursor: 'pointer',
                        color: '#4f46e5', fontSize: '11px', fontWeight: '800',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '6px 12px', borderRadius: '8px', transition: 'all 0.2s ease',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      title={t.dependenciesTitle || "Зависимости работы"}
                    >
                      🔗 {dependencies.filter(dep => dep.successor_id === w.id).length || '0'}
                    </button>
                  </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      );
    };
    const rootNodes = wbsList.filter(node => !node.parent_id);
    return (
      <div style={{
        background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.02)', overflow: 'hidden'
      }}>
        <div style={{ maxHeight: '350px', overflowY: 'auto', position: 'relative' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 140px 100px 100px 180px 120px',
            padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
            fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
            position: 'sticky', top: 0, zIndex: 10,
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}>
            <div>{t.schedColWorkName || 'Наименование'}</div>
            <div>{t.schedColStartDate || 'Начало'}</div>
            <div>{t.schedColDurationDays || 'Дней'}</div>
            <div style={{ textAlign: 'center' }}>%</div>
            <div>{t.schedColAssignee || 'Ответственный'}</div>
            <div style={{ textAlign: 'center' }}>{t.actions || 'Действия'}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#2563eb', fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <RefreshCw className="animate-spin" size={18} color="#2563eb" />
                {t.dictLoading || 'Загрузка...'}
              </div>
            ) : rootNodes.filter(r => hasWorksRecursive(r.id)).length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
                {t.schedNoWorks || 'Нет разделов в смете с добавленными работами.'}
              </div>
            ) : (
              rootNodes.map(root => renderWbsRow(root, 0))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderGanttBlock = (compact = false) => {
    const getChildrenWbs = (parentId) => wbsList.filter(node => node.parent_id === parentId);
    const getWorksForWbs = (wbsId) => Object.values(worksSchedule).filter(work => work.wbs_id === wbsId);

    const getRecursiveWorksForWbs = (wbsId) => {
      let result = Object.values(worksSchedule).filter(work => work.wbs_id === wbsId);
      const children = wbsList.filter(node => node.parent_id === wbsId);
      children.forEach(child => {
        result = result.concat(getRecursiveWorksForWbs(child.id));
      });
      return result;
    };

    const hasCriticalWorksRecursive = (wbsId) => {
      const works = getWorksForWbs(wbsId);
      const hasDirectCritical = works.some(w => cpmData[w.id]?.isCritical);
      if (hasDirectCritical) return true;
      const children = getChildrenWbs(wbsId);
      return children.some(child => hasCriticalWorksRecursive(child.id));
    };

    const getVisibleNodes = () => {
      const list = [];
      const traverse = (node) => {
        if (filterOnlyCritical) {
          if (!hasCriticalWorksRecursive(node.id)) return;
        } else {
          if (!hasWorksRecursive(node.id)) return;
        }
        list.push({ type: 'wbs', id: node.id });
        if (!collapsedWbs[node.id]) {
          const childrenWbs = getChildrenWbs(node.id);
          const works = getWorksForWbs(node.id);
          childrenWbs.forEach(child => traverse(child));
          works.forEach(w => {
            if (filterOnlyCritical) {
              if (cpmData[w.id]?.isCritical) {
                list.push({ type: 'work', id: w.id });
              }
            } else {
              list.push({ type: 'work', id: w.id });
            }
          });
        }
      };
      wbsList.filter(n => !n.parent_id).forEach(root => traverse(root));
      return list;
    };

    const visibleNodes = getVisibleNodes();
    const totalWidth = ganttRange.daysArray.length * columnWidth;
    let currentY = 0;
    const YMap = {};
    visibleNodes.forEach(node => {
      const rowHeight = node.type === 'wbs' ? 31 : 29;
      YMap[node.id] = currentY + (rowHeight / 2);
      currentY += rowHeight;
    });

    const getWorkY = (workId) => {
      if (YMap[workId] !== undefined) return YMap[workId];
      const work = worksSchedule[workId];
      if (!work) return null;
      let currentWbsId = work.wbs_id;
      while (currentWbsId) {
        if (YMap[currentWbsId] !== undefined) {
          return YMap[currentWbsId];
        }
        const parentWbs = wbsList.find(n => n.id === currentWbsId);
        currentWbsId = parentWbs ? parentWbs.parent_id : null;
      }
      return null;
    };

    const getWorkX = (work) => {
      const startDate = parseDateString(work.start_date);
      if (!startDate || !ganttRange.startDate) return { startX: 0, endX: 0 };
      const dayOffset = Math.max(0, Math.ceil((startDate - ganttRange.startDate) / (1000 * 60 * 60 * 24)));
      const duration = parseInt(work.duration_days, 10) || 1;
      const startX = dayOffset * columnWidth;
      const endX = startX + duration * columnWidth;
      return { startX, endX };
    };

    const renderGanttLeftTree = (node, depth = 0) => {
      if (filterOnlyCritical) {
        if (!hasCriticalWorksRecursive(node.id)) return null;
      } else {
        if (!hasWorksRecursive(node.id)) return null;
      }

      const childrenWbs = getChildrenWbs(node.id);
      const works = getWorksForWbs(node.id);
      const isCollapsed = collapsedWbs[node.id] === true;

      const nameLang = lang === 'ka' ? 'ka' : (lang === 'ge' ? 'ka' : lang);
      const wbsName = node[`name_${nameLang}`] || node.name_ka || node.name_ge || node.name_az || node.name_en || node.name_ru || node.name;

      return (
        <div key={`left-gantt-${node.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '160px 85px 40px 85px 95px',
            alignItems: 'center', height: '31px', padding: '0 14px', background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0', borderLeft: depth === 0 ? '4px solid #6366f1' : '3px solid #94a3b8',
            boxSizing: 'border-box'
          }}>
            <div
              onClick={() => toggleWbsCollapse(node.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: `${depth * 12}px`, cursor: 'pointer', overflow: 'hidden' }}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wbsName}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>{projectStartDate}</div>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textAlign: 'center' }}>—</div>
            <div style={{ fontSize: '11px', color: '#cbd5e1' }}>—</div>
            <div style={{ color: '#cbd5e1' }}>—</div>
          </div>

          {!isCollapsed && (
            <>
              {childrenWbs.map(child => renderGanttLeftTree(child, depth + 1))}
              {works.filter(w => !filterOnlyCritical || cpmData[w.id]?.isCritical).map(w => {
                const manager = estimatorsList.find(m => m.id === w.assignee_id);
                const managerName = manager ? (manager.first_name || manager.email.split('@')[0]) : '—';
                const calculatedEnd = calculateEndDate(w.start_date, w.duration_days);

                const isWorkSelected = selectedWorkId === w.id;
                return (
                  <div
                    key={`left-work-${w.id}`}
                    onClick={() => {
                      if (linkingSource) {
                        handleSelectTarget(w.id, 'start');
                      } else {
                        setSelectedWorkId(w.id);
                      }
                    }}
                    style={{
                      display: 'grid', gridTemplateColumns: '160px 85px 40px 85px 95px',
                      alignItems: 'center', height: '29px', padding: '0 14px', borderBottom: '1px solid #f1f5f9',
                      background: isWorkSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: `${(depth + 1) * 16}px`, overflow: 'hidden' }}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '500',
                        color: '#475569',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {w.name}
                      </span>
                      {showCriticalPath && cpmData[w.id] !== undefined && (
                        <span style={{
                          fontSize: '8px',
                          fontWeight: '800',
                          padding: '1px 4px',
                          borderRadius: '4px',
                          marginLeft: '4px',
                          flexShrink: 0,
                          background: cpmData[w.id].isCritical ? '#ffe4e6' : '#f1f5f9',
                          color: cpmData[w.id].isCritical ? '#e11d48' : '#64748b',
                          border: cpmData[w.id].isCritical ? '1px solid #fda4af' : '1px solid #e2e8f0'
                        }}>
                          {cpmData[w.id].isCritical ? 'КП' : `Р:${cpmData[w.id].totalFloat}`}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#334155' }}>{w.start_date}</div>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#334155', textAlign: 'center' }}>{w.duration_days}</div>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b' }}>{calculatedEnd}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{managerName}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      );
    };

    const renderGanttRightBars = (node) => {
      if (filterOnlyCritical) {
        if (!hasCriticalWorksRecursive(node.id)) return null;
      } else {
        if (!hasWorksRecursive(node.id)) return null;
      }

      const childrenWbs = getChildrenWbs(node.id);
      const works = getWorksForWbs(node.id);
      const isCollapsed = collapsedWbs[node.id] === true;

      const nameLang = lang === 'ka' ? 'ka' : (lang === 'ge' ? 'ka' : lang);
      const wbsName = node[`name_${nameLang}`] || node.name_ka || node.name_ge || node.name_az || node.name_en || node.name_ru || node.name;

      let wbsMinStart = null;
      let wbsMaxEnd = null;
      getRecursiveWorksForWbs(node.id).forEach(w => {
        if (w.start_date) {
          const s = parseDateString(w.start_date);
          const e = parseDateString(calculateEndDate(w.start_date, w.duration_days));
          if (s && (!wbsMinStart || s < wbsMinStart)) wbsMinStart = s;
          if (e && (!wbsMaxEnd || e > wbsMaxEnd)) wbsMaxEnd = e;
        }
      });

      let wbsOffset = 0;
      let wbsBarWidth = 0;
      if (wbsMinStart && ganttRange.startDate) {
        wbsOffset = Math.max(0, Math.ceil((wbsMinStart - ganttRange.startDate) / (1000 * 60 * 60 * 24))) * columnWidth;
        const durationDays = Math.ceil((wbsMaxEnd - wbsMinStart) / (1000 * 60 * 60 * 24)) + 1;
        wbsBarWidth = durationDays * columnWidth;
      }

      return (
        <React.Fragment key={`gantt-bars-${node.id}`}>
          <div style={{
            height: '31px', borderBottom: '1px solid #f1f5f9', position: 'relative',
            display: 'flex', alignItems: 'center', background: '#f8fafc',
            boxSizing: 'border-box'
          }}>
            {isCollapsed && getRecursiveWorksForWbs(node.id).map(w => {
              const startDate = parseDateString(w.start_date);
              const duration = parseInt(w.duration_days, 10) || 1;
              if (!startDate || !ganttRange.startDate) return null;

              const dayOffset = Math.max(0, Math.ceil((startDate - ganttRange.startDate) / (1000 * 60 * 60 * 24)));
              const barWidth = Math.max(1, duration) * columnWidth;
              const leftOffset = dayOffset * columnWidth;

              const isCriticalWork = showCriticalPath && cpmData[w.id]?.isCritical;
              return (
                <div
                  key={`rollup-bar-${w.id}`}
                  title={`${w.name} (${formatDisplayDate(w.start_date)} - ${formatDisplayDate(calculateEndDate(w.start_date, w.duration_days))})`}
                  style={{
                    position: 'absolute',
                    left: `${leftOffset}px`,
                    width: `${barWidth}px`,
                    height: '6px',
                    background: isCriticalWork ? 'rgba(225, 29, 72, 0.8)' : 'rgba(99, 102, 241, 0.65)',
                    borderRadius: '2px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedWorkId(w.id);
                    setActiveDependencyWorkId(w.id);
                    setShowDependencyModal(true);
                  }}
                />
              );
            })}
          </div>

          {!isCollapsed && (
            <>
              {childrenWbs.map(child => renderGanttRightBars(child))}
              {works.filter(w => !filterOnlyCritical || cpmData[w.id]?.isCritical).map(w => {
                const startDate = parseDateString(w.start_date);
                const duration = parseInt(w.duration_days, 10) || 1;

                let dayOffset = 0;
                if (startDate && ganttRange.startDate) {
                  dayOffset = Math.max(0, Math.ceil((startDate - ganttRange.startDate) / (1000 * 60 * 60 * 24)));
                }

                const barWidth = Math.max(1, duration) * columnWidth;
                const leftOffset = dayOffset * columnWidth;
                const label = w.name.trim().slice(0, 4);

                const isCriticalWork = showCriticalPath && cpmData[w.id]?.isCritical;
                const barBg = isCriticalWork
                  ? 'linear-gradient(135deg, #f43f5e, #e11d48)'
                  : 'linear-gradient(135deg, #60a5fa, #3b82f6)';
                const barShadow = isCriticalWork
                  ? '0 2px 4px rgba(225, 29, 72, 0.2)'
                  : '0 2px 4px rgba(59, 130, 246, 0.2)';

                const isWorkSelected = selectedWorkId === w.id;
                const dotStyle = {
                  position: 'absolute',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ffffff',
                  border: '1.5px solid #64748b',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  cursor: 'pointer',
                  zIndex: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                };

                return (
                  <div
                    key={`bar-work-${w.id}`}
                    onClick={() => {
                      if (linkingSource) {
                        handleSelectTarget(w.id, 'start');
                      } else {
                        setSelectedWorkId(w.id);
                        setActiveDependencyWorkId(w.id);
                        setShowDependencyModal(true);
                      }
                    }}
                    style={{
                      height: '29px', borderBottom: '1px solid #f1f5f9', position: 'relative',
                      display: 'flex', alignItems: 'center', background: isWorkSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer', boxSizing: 'border-box'
                    }}
                  >
                    {startDate && (
                      <>
                        <div
                          title={`${w.name} (${formatDisplayDate(w.start_date)} - ${formatDisplayDate(calculateEndDate(w.start_date, w.duration_days))})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (linkingSource) {
                              handleSelectTarget(w.id, 'start');
                            } else {
                              setSelectedWorkId(w.id);
                              setActiveDependencyWorkId(w.id);
                              setShowDependencyModal(true);
                            }
                          }}
                          style={{
                            position: 'absolute', left: `${leftOffset}px`, width: `${barWidth}px`,
                            height: '18px', background: barBg, borderRadius: '4px',
                            display: 'flex', alignItems: 'center', padding: '0 6px', color: 'white',
                            fontSize: '9px', fontWeight: '800', overflow: 'hidden', boxShadow: barShadow,
                            whiteSpace: 'nowrap', textOverflow: 'ellipsis'
                          }}
                        >
                          {w.name}
                        </div>

                        {/* Connection dots */}
                        <div
                          style={{ ...dotStyle, left: `${leftOffset}px` }}
                          onClick={(e) => handleDotClick(w.id, 'start', e)}
                          title="Начало работы (Start)"
                        />
                        <div
                          style={{ ...dotStyle, left: `${leftOffset + barWidth}px` }}
                          onClick={(e) => handleDotClick(w.id, 'finish', e)}
                          title="Окончание работы (Finish)"
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </React.Fragment>
      );
    };

    const rootNodes = wbsList.filter(node => !node.parent_id);

    return (
      <div style={{
        background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.02)', overflow: 'hidden'
      }}>
        <div style={{ maxHeight: compact ? '350px' : '650px', overflow: 'auto', position: 'relative' }}>
          <div style={{ display: 'flex', minWidth: 'fit-content' }}>
            {/* Левая сплит-панель */}
            <div style={{
              width: '465px', minWidth: '465px', borderRight: '1px solid #cbd5e1', flexShrink: 0,
              background: '#ffffff', position: 'sticky', left: 0, zIndex: 20
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '160px 85px 40px 85px 95px',
                padding: '0 14px', background: '#f8fafc', borderBottom: '1px solid #cbd5e1',
                fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
                height: '47px', alignItems: 'center', boxSizing: 'border-box',
                position: 'sticky', top: 0, left: 0, zIndex: 30
              }}>
                <div>{t.schedColWorkName || 'Наименование'}</div>
                <div>{t.schedColStartDate || 'Начало'}</div>
                <div>{t.schedDaysUnit || 'Дн.'}</div>
                <div>{t.schedColEndDate || 'Окончание'}</div>
                <div>{t.schedColAssignee || 'Ответственный'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {rootNodes.map(root => renderGanttLeftTree(root, 0))}
              </div>
            </div>

            {/* Правая сплит-панель */}
            <div style={{ flex: 1, background: '#fcfcfd', position: 'relative' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', background: '#ffffff',
            borderBottom: '1px solid #cbd5e1', position: 'sticky', top: 0, zIndex: 10,
            width: `${totalWidth}px`, height: '47px', boxSizing: 'border-box'
          }}>
            {/* Месяцы */}
            <div style={{ display: 'flex', borderBottom: '1px solid #dbeafe', width: `${totalWidth}px`, height: '25px', boxSizing: 'border-box' }}>
              {timelineHeaders.months.map((mHeader, idx) => (
                <div
                  key={idx}
                  style={{
                    width: `${mHeader.span * columnWidth}px`, minWidth: `${mHeader.span * columnWidth}px`,
                    textAlign: 'center', borderRight: '1px solid #dbeafe',
                    fontSize: '10px', fontWeight: '900', color: '#1e3a8a', background: '#e0f2fe',
                    height: '24px', lineHeight: '24px', boxSizing: 'border-box',
                    letterSpacing: '0.5px', textTransform: 'uppercase'
                  }}
                >
                  {mHeader.name} {mHeader.year}
                </div>
              ))}
            </div>
            
            {/* Подшкала */}
            <div style={{ display: 'flex', width: `${totalWidth}px`, height: '22px', boxSizing: 'border-box' }}>
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
                    height: '22px', boxSizing: 'border-box'
                  }}
                >
                  <span>{subcell.label}</span>
                  {subcell.sublabel && <span style={{ fontSize: '8px', color: '#94a3b8' }}>{subcell.sublabel}</span>}
                </div>
              ))}
            </div>
          </div>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            backgroundImage: 'linear-gradient(to right, #f1f5f9 1px, transparent 1px)',
            backgroundSize: `${columnWidth}px 100%`,
            width: `${totalWidth}px`
          }}>
            {/* SVG overlay for Gantt dependencies */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: `${totalWidth}px`, height: `${currentY}px`, pointerEvents: 'none', zIndex: 5 }}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#6366f1" />
                </marker>
                <marker id="arrow-selected" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#ef4444" />
                </marker>
                <marker id="arrow-critical" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#e11d48" />
                </marker>
              </defs>
              {dependencies.map((dep, idx) => {
                const pred = worksSchedule[dep.predecessor_id];
                const succ = worksSchedule[dep.successor_id];
                if (!pred || !succ) return null;

                if (filterOnlyCritical) {
                  const isPredCritical = cpmData[dep.predecessor_id]?.isCritical;
                  const isSuccCritical = cpmData[dep.successor_id]?.isCritical;
                  if (!isPredCritical || !isSuccCritical) return null;
                }

                const coordsPred = getWorkX(pred);
                const coordsSucc = getWorkX(succ);

                const y1 = getWorkY(pred.id);
                const y2 = getWorkY(succ.id);
                if (y1 === null || y2 === null) return null;
                
                let x1, x2;
                if (dep.type === 'FS') {
                  x1 = coordsPred.endX;
                  x2 = coordsSucc.startX;
                } else if (dep.type === 'SS') {
                  x1 = coordsPred.startX;
                  x2 = coordsSucc.startX;
                } else if (dep.type === 'FF') {
                  x1 = coordsPred.endX;
                  x2 = coordsSucc.endX;
                } else if (dep.type === 'SF') {
                  x1 = coordsPred.startX;
                  x2 = coordsSucc.endX;
                }

                const pathD = getGanttLinkPath(x1, y1, x2, y2, dep.type);

                return (
                  <g key={`link-${idx}`}>
                    {/* Wide invisible line for click / double click */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="rgba(0, 0, 0, 0)"
                      strokeWidth="10"
                      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onClick={(e) => handleLinkDoubleClick(dep, e)}
                      onDoubleClick={(e) => handleLinkDoubleClick(dep, e)}
                    />
                    {/* Visible line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth="1.5"
                      strokeDasharray={dep.type === 'FS' ? 'none' : '4 3'}
                      markerEnd="url(#arrow)"
                      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onClick={(e) => handleLinkDoubleClick(dep, e)}
                      onDoubleClick={(e) => handleLinkDoubleClick(dep, e)}
                    />
                  </g>
                );
              })}
            </svg>
            {rootNodes.map(root => renderGanttRightBars(root))}
          </div>
        </div>
      </div>
      </div>
      </div>
    );
  };

  const renderDependencyModal = () => {
    if (!showDependencyModal || !activeDependencyWorkId) return null;

    const currentWork = worksSchedule[activeDependencyWorkId];
    if (!currentWork) return null;

    const currentPredecessors = dependencies.filter(dep => dep.successor_id === activeDependencyWorkId);
    
    const existingPredIds = new Set(currentPredecessors.map(dep => dep.predecessor_id));
    const availableWorks = Object.values(worksSchedule).filter(w => w.id !== activeDependencyWorkId && !existingPredIds.has(w.id));

    const modalT = {
      ru: {
        title: 'Связи и зависимости работы',
        predecessors: 'Текущие связи (предшественники)',
        noPredecessors: 'Для этой работы еще не установлены связи.',
        addDep: 'Добавить новую связь',
        selectWork: 'Выберите предшествующую работу',
        depType: 'Тип зависимости',
        lag: 'Смещение (Lag, дней)',
        btnAdd: 'Добавить связь',
        btnClose: 'Готово',
        errSelf: 'Работа не может зависеть сама от себя',
        errCycle: 'Невозможно создать зависимость. Обнаружена циклическая ссылка между работами',
        errExists: 'Эта связь уже добавлена.',
        legendTitle: 'Справочник типов связей',
        legendFs: 'Finish → Start (FS): Последующая работа начинается после завершения предшествующей.',
        legendSs: 'Start → Start (SS): Работы начинаются одновременно (или со смещением).',
        legendFf: 'Finish → Finish (FF): Работы должны завершиться одновременно.',
        legendSf: 'Start → Finish (SF): Окончание последующей зависит от начала предшествующей.',
        legendLag: 'Смещение (Lag): Количество дней задержки (например, время застывания бетона).'
      },
      en: {
        title: 'Work Dependencies & Relationships',
        predecessors: 'Current relationships (Predecessors)',
        noPredecessors: 'No relationships established yet.',
        addDep: 'Add new relationship',
        selectWork: 'Select predecessor work',
        depType: 'Relationship type',
        lag: 'Lag (days)',
        btnAdd: 'Add relation',
        btnClose: 'Done',
        errSelf: 'A work cannot depend on itself',
        errCycle: 'Cannot create relationship: a cyclic reference was detected!',
        errExists: 'This relationship already exists.',
        legendTitle: 'Relationship Types Guide',
        legendFs: 'Finish → Start (FS): Successor starts only after predecessor finishes.',
        legendSs: 'Start → Start (SS): Both works start at the same time.',
        legendFf: 'Finish → Finish (FF): Both works must finish at the same time.',
        legendSf: 'Start → Finish (SF): Successor finishes only after predecessor starts.',
        legendLag: 'Lag: Days of delay inserted between the tasks (e.g. concrete curing time).'
      },
      ka: {
        title: 'სამუშაოს კავშირები და დამოკიდებულებები',
        predecessors: 'მიმდინარე კავშირები (წინამორბედები)',
        noPredecessors: 'კავშირები ჯერ არ არის დამყარებული.',
        addDep: 'ახალი კავშირის დამატება',
        selectWork: 'აირჩიეთ წინამორბედი სამუშაო',
        depType: 'კავშირის ტიპი',
        lag: 'გადაწევა (დღეები)',
        btnAdd: 'კავშირის დამატება',
        btnClose: 'მზად არის',
        errSelf: 'სამუშაო ვერ იქნება დამოკიდებული საკუთარ თავზე',
        errCycle: 'კავშირის შექმნა შეუძლებელია: აღმოჩენილია ციკლური ბმული სამუშაოებს შორის!',
        errExists: 'ეს კავშირი უკვე არსებობს.',
        legendTitle: 'კავშირის ტიპების ცნობარი',
        legendFs: 'Finish → Start (FS): მომდევნო სამუშაო იწყება წინა სამუშაოს დასრულების შემდეგ.',
        legendSs: 'Start → Start (SS): სამუშაოები იწყება ერთდროულად.',
        legendFf: 'Finish → Finish (FF): სამუშაოები უნდა დასრულდეს ერთდროულად.',
        legendSf: 'Start → Finish (SF): მომდევნო სამუშაოს დასრულება დამოკიდებულია წინა სამუშაოს დაწყებაზე.',
        legendLag: 'გადაწევა (Lag): დღეების რაოდენობა სამუშაოებს შორის (მაგ. ბეტონის გაშრობის დრო).'
      },
      az: {
        title: 'İş Əlaqələri və Asılılıqları',
        predecessors: 'Mövcud əlaqələr (Sələflər)',
        noPredecessors: 'Hələ heç bir əlaqə qurulmayıb.',
        addDep: 'Yeni əlaqə əlavə et',
        selectWork: 'Sələf işi seçin',
        depType: 'Asılılıq növü',
        lag: 'Gecikmə (gün)',
        btnAdd: 'Əlaqə əlavə et',
        btnClose: 'Hazır',
        errSelf: 'İş özündən asılı ola bilməz',
        errCycle: 'Əlaqə yaradıla bilməz: işlər arasında dövri istinad aşkar edildi!',
        errExists: 'Bu əlaqə artıq mövcuddur.',
        legendTitle: 'Əlaqə Növləri Rəhbəri',
        legendFs: 'Finish → Start (FS): Növbəti iş yalnız əvvəlki iş bitdikdən sonra başlayır.',
        legendSs: 'Start → Start (SS): Hər iki iş eyni vaxtda başlayır.',
        legendFf: 'Finish → Finish (FF): Hər iki iş eyni vaxtda bitməlidir.',
        legendSf: 'Start → Finish (SF): Növbəti işin bitməsi əvvəlki işin başlamasından asılıdır.',
        legendLag: 'Gecikmə (Lag): İşlər arasında gecikdirilən günlərin sayı (məsələn, betonun quruması).'
      }
    }[lang] || {
      title: 'Связи и зависимости работы',
      predecessors: 'Текущие связи (предшественники)',
      noPredecessors: 'Для этой работы еще не установлены связи.',
      addDep: 'Добавить новую связь',
      selectWork: 'Выберите предшествующую работу',
      depType: 'Тип зависимости',
      lag: 'Смещение (Lag, дней)',
      btnAdd: 'Добавить связь',
      btnClose: 'Готово',
      errSelf: 'Работа не может зависеть сама от себя',
      errCycle: 'Невозможно создать зависимость. Обнаружена циклическая ссылка между работами',
      errExists: 'Эта связь уже добавлена.',
      legendTitle: 'Справочник типов связей',
      legendFs: 'Finish → Start (FS): Последующая работа начинается после завершения предшествующей.',
      legendSs: 'Start → Start (SS): Работы начинаются одновременно (или со смещением).',
      legendFf: 'Finish → Finish (FF): Работы должны завершиться одновременно.',
      legendSf: 'Start → Finish (SF): Окончание последующей зависит от начала предшествующей.',
      legendLag: 'Смещение (Lag): Количество дней задержки (например, время застывания бетона).'
    };

    const handleAddDependency = (predId, depType, lagVal) => {
      setModalError('');
      if (!predId) return;
      const lag = parseInt(lagVal, 10) || 0;
      
      if (predId === activeDependencyWorkId) {
        setModalError(modalT.errSelf);
        return;
      }

      const allWorkIds = Object.keys(worksSchedule);
      if (wouldCreateCycle(predId, activeDependencyWorkId, dependencies, allWorkIds)) {
        setModalError(modalT.errCycle);
        return;
      }

      const newDep = {
        predecessor_id: predId,
        successor_id: activeDependencyWorkId,
        type: depType,
        lag: lag
      };

      const nextDeps = [...dependencies, newDep];
      setDependencies(nextDeps);
      setIsDirty(true);

      try {
        const nextState = clientRecalculateSchedules(worksSchedule, nextDeps, projectStartDate);
        setWorksSchedule(nextState);
        triggerAutoSave(nextState, nextDeps);
      } catch (e) {
        console.error(e);
      }
    };

    const handleDeleteDependency = (predId) => {
      setModalError('');
      const nextDeps = dependencies.filter(dep => !(dep.predecessor_id === predId && dep.successor_id === activeDependencyWorkId));
      setDependencies(nextDeps);
      setIsDirty(true);

      try {
        const nextState = clientRecalculateSchedules(worksSchedule, nextDeps, projectStartDate);
        setWorksSchedule(nextState);
        triggerAutoSave(nextState, nextDeps);
      } catch (e) {
        console.error(e);
      }
    };

    const handleUpdateDependency = (predId, field, val) => {
      setModalError('');
      const nextDeps = dependencies.map(dep => {
        if (dep.predecessor_id === predId && dep.successor_id === activeDependencyWorkId) {
          return {
            ...dep,
            [field]: field === 'lag' ? (parseInt(val, 10) || 0) : val
          };
        }
        return dep;
      });

      setDependencies(nextDeps);
      setIsDirty(true);

      try {
        const nextState = clientRecalculateSchedules(worksSchedule, nextDeps, projectStartDate);
        setWorksSchedule(nextState);
        triggerAutoSave(nextState, nextDeps);
      } catch (e) {
        console.error(e);
      }
    };


    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
      }}>
        <div style={{
          background: '#ffffff', borderRadius: '24px', width: '820px', maxWidth: '95%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0'
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
            background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🔗</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '900', color: '#0f172a' }}>
                  {modalT.title}
                </h3>
                <span style={{ fontSize: '12px', fontWeight: '700', color: '#4f46e5', marginTop: '2px' }}>
                  {currentWork.name}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setShowDependencyModal(false);
                setActiveDependencyWorkId(null);
                setModalError('');
              }}
              style={{
                background: '#f1f5f9', border: 'none', cursor: 'pointer',
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: 'bold', color: '#64748b', transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}
            >
              ✕
            </button>
          </div>

          {/* Body (2 columns: main editor & interactive guide) */}
          <div style={{
            padding: '24px', overflowY: 'auto', maxHeight: '480px',
            display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px'
          }}>
            
            {/* Left Column: List and Add form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Modal Error Banner */}
              {modalError && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px',
                  background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: '12px',
                  color: '#991b1b', fontSize: '12px', fontWeight: '700'
                }}>
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
                  <div style={{ flex: 1 }}>{modalError}</div>
                  <button
                    onClick={() => setModalError('')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 'bold', padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Predecessors List */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                  {modalT.predecessors} ({currentPredecessors.length})
                </h4>
                
                {currentPredecessors.length === 0 ? (
                  <div style={{
                    padding: '24px', background: '#f8fafc', borderRadius: '14px',
                    border: '2px dashed #e2e8f0', textAlign: 'center', fontSize: '12px',
                    color: '#94a3b8', fontWeight: '700', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '8px'
                  }}>
                    <span style={{ fontSize: '24px' }}>⛓️</span>
                    {modalT.noPredecessors}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {currentPredecessors.map(dep => {
                      const predWork = worksSchedule[dep.predecessor_id];
                      if (!predWork) return null;
                      return (
                        <div
                          key={dep.predecessor_id}
                          style={{
                            display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '12px',
                            alignItems: 'center', padding: '12px 16px', background: '#ffffff',
                            borderRadius: '14px', border: '1.5px solid #e2e8f0',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.02)', transition: 'all 0.2s'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <span style={{ fontSize: '12px', fontWeight: '800', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {predWork.name}
                            </span>
                            <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', fontWeight: '600' }}>
                              {predWork.start_date} {predWork.duration_days} дн. {dep.type} {dep.lag} дн.
                            </span>
                          </div>
                          
                          <select
                            value={dep.type}
                            onChange={(e) => handleUpdateDependency(dep.predecessor_id, 'type', e.target.value)}
                            style={{
                              padding: '6px 10px', fontSize: '11px', fontWeight: '800',
                              borderRadius: '8px', border: '1.5px solid #cbd5e1', background: '#ffffff',
                              color: '#334155', outline: 'none', cursor: 'pointer'
                            }}
                          >
                            <option value="FS">Finish → Start (FS)</option>
                            <option value="SS">Start → Start (SS)</option>
                            <option value="FF">Finish → Finish (FF)</option>
                            <option value="SF">Start → Finish (SF)</option>
                          </select>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              min="0"
                              value={dep.lag}
                              onChange={(e) => handleUpdateDependency(dep.predecessor_id, 'lag', e.target.value)}
                              style={{
                                padding: '6px 8px', fontSize: '11px', fontWeight: '800',
                                borderRadius: '8px', border: '1.5px solid #cbd5e1', width: '56px',
                                textAlign: 'center', outline: 'none'
                              }}
                            />
                            <span style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8' }}>дн.</span>
                          </div>

                          <button
                            onClick={(e) => handleLinkDoubleClick(dep, e)}
                            style={{
                              background: '#eff6ff', border: 'none', cursor: 'pointer',
                              width: '28px', height: '28px', borderRadius: '8px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#3b82f6', fontSize: '11px', fontWeight: 'bold', transition: 'all 0.2s',
                              marginRight: '4px'
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.background = '#dbeafe'; }}
                            onMouseOut={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
                            title="Редактировать связь"
                          >
                            ✏️
                          </button>

                          <button
                            onClick={() => handleDeleteDependency(dep.predecessor_id)}
                            style={{
                              background: '#fff1f2', border: 'none', cursor: 'pointer',
                              width: '28px', height: '28px', borderRadius: '8px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#f43f5e', fontSize: '11px', fontWeight: 'bold', transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.background = '#ffe4e6'; }}
                            onMouseOut={(e) => { e.currentTarget.style.background = '#fff1f2'; }}
                            title="Удалить зависимость"
                          >
                            🗑️
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add predecessor form */}
              {availableWorks.length > 0 && (
                <div style={{ borderTop: '1.5px solid #f1f5f9', paddingTop: '20px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                    ➕ {modalT.addDep}
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <select
                      value={formPredecessorId}
                      onChange={(e) => setFormPredecessorId(e.target.value)}
                      style={{
                        padding: '10px 12px', fontSize: '12px', fontWeight: '700',
                        borderRadius: '10px', border: '1.5px solid #cbd5e1', background: '#ffffff',
                        color: '#1e293b', outline: 'none', width: '100%', cursor: 'pointer'
                      }}
                    >
                      <option value="">-- {modalT.selectWork} --</option>
                      {availableWorks.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr auto', gap: '10px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>{modalT.depType}</span>
                        <select
                          value={formType}
                          onChange={(e) => setFormType(e.target.value)}
                          style={{
                            padding: '8px 10px', fontSize: '11px', fontWeight: '800',
                            borderRadius: '8px', border: '1.5px solid #cbd5e1', background: '#ffffff',
                            color: '#334155', outline: 'none', cursor: 'pointer'
                          }}
                        >
                          <option value="FS">Finish → Start (FS)</option>
                          <option value="SS">Start → Start (SS)</option>
                          <option value="FF">Finish → Finish (FF)</option>
                          <option value="SF">Start → Finish (SF)</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>{modalT.lag}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            min="0"
                            value={formLag}
                            onChange={(e) => setFormLag(e.target.value)}
                            style={{
                              padding: '8px 10px', fontSize: '11px', fontWeight: '800',
                              borderRadius: '8px', border: '1.5px solid #cbd5e1', width: '100%',
                              textAlign: 'center', outline: 'none'
                            }}
                          />
                          <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b' }}>дн.</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          handleAddDependency(formPredecessorId, formType, formLag);
                          setFormPredecessorId('');
                          setFormLag('0');
                        }}
                        disabled={!formPredecessorId}
                        style={{
                          alignSelf: 'end',
                          background: formPredecessorId ? 'linear-gradient(135deg, #10b981, #059669)' : '#cbd5e1',
                          color: '#ffffff', border: 'none', padding: '10px 20px',
                          borderRadius: '8px', fontSize: '11px', fontWeight: '950',
                          cursor: formPredecessorId ? 'pointer' : 'default',
                          boxShadow: formPredecessorId ? '0 4px 10px rgba(16, 185, 129, 0.2)' : 'none',
                          transition: 'all 0.2s',
                          height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                      >
                        {modalT.btnAdd}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Visual Legend explaining dependency types */}
            {/* Right Column: Visual Legend explaining dependency types & CPM details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{
                background: '#f8fafc', borderRadius: '16px', border: '1px dashed #cbd5e1',
                padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px'
              }}>
                <h4 style={{ margin: 0, fontSize: '12px', fontWeight: '900', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  💡 {modalT.legendTitle}
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '11px', color: '#475569', lineHeight: '1.4' }}>
                  <div style={{ padding: '8px', background: '#ffffff', borderRadius: '8px', borderLeft: '3px solid #3b82f6' }}>
                    <strong>{modalT.legendFs}</strong>
                  </div>
                  <div style={{ padding: '8px', background: '#ffffff', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                    <strong>{modalT.legendSs}</strong>
                  </div>
                  <div style={{ padding: '8px', background: '#ffffff', borderRadius: '8px', borderLeft: '3px solid #f59e0b' }}>
                    <strong>{modalT.legendFf}</strong>
                  </div>
                  <div style={{ padding: '8px', background: '#ffffff', borderRadius: '8px', borderLeft: '3px solid #8b5cf6' }}>
                    <strong>{modalT.legendSf}</strong>
                  </div>
                  <div style={{ padding: '8px', background: '#e0f2fe', borderRadius: '8px', color: '#0369a1' }}>
                    <strong>{modalT.legendLag}</strong>
                  </div>
                </div>
              </div>

              {cpmData && cpmData[activeDependencyWorkId] && (
                <div style={{
                  background: cpmData[activeDependencyWorkId].isCritical ? '#fff1f2' : '#f8fafc',
                  borderRadius: '16px',
                  border: cpmData[activeDependencyWorkId].isCritical ? '1px solid #fda4af' : '1px solid #cbd5e1',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                }}>
                  <h4 style={{
                    margin: 0,
                    fontSize: '12px',
                    fontWeight: '900',
                    color: cpmData[activeDependencyWorkId].isCritical ? '#e11d48' : '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    ⏱️ Параметры критического пути (CPM)
                  </h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '11px', color: '#475569' }}>
                    <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <div style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase' }}>Раннее начало</div>
                      <div style={{ fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>
                        {addDaysToDate(projectStartDate, cpmData[activeDependencyWorkId].ES)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '9px', marginTop: '1px' }}>(День {cpmData[activeDependencyWorkId].ES})</div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <div style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase' }}>Раннее окончание</div>
                      <div style={{ fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>
                        {addDaysToDate(projectStartDate, cpmData[activeDependencyWorkId].EF - 1)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '9px', marginTop: '1px' }}>(День {cpmData[activeDependencyWorkId].EF - 1})</div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <div style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase' }}>Позднее начало</div>
                      <div style={{ fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>
                        {addDaysToDate(projectStartDate, cpmData[activeDependencyWorkId].LS)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '9px', marginTop: '1px' }}>(День {cpmData[activeDependencyWorkId].LS})</div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <div style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase' }}>Позднее окончание</div>
                      <div style={{ fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>
                        {addDaysToDate(projectStartDate, cpmData[activeDependencyWorkId].LF - 1)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '9px', marginTop: '1px' }}>(День {cpmData[activeDependencyWorkId].LF - 1})</div>
                    </div>
                  </div>

                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    fontSize: '11px',
                    fontWeight: '850',
                    background: cpmData[activeDependencyWorkId].isCritical ? '#ffe4e6' : '#f1f5f9',
                    color: cpmData[activeDependencyWorkId].isCritical ? '#e11d48' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    border: cpmData[activeDependencyWorkId].isCritical ? '1px solid #fda4af' : '1px solid #e2e8f0',
                    marginTop: '4px'
                  }}>
                    <span>Полный резерв времени:</span>
                    <span style={{ fontSize: '13px', fontWeight: '900' }}>{cpmData[activeDependencyWorkId].totalFloat} дней</span>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', padding: '16px 24px',
            borderTop: '1px solid #f1f5f9', background: '#f8fafc'
          }}>
            <button
              onClick={() => {
                setShowDependencyModal(false);
                setActiveDependencyWorkId(null);
                setModalError('');
              }}
              style={{
                background: 'linear-gradient(135deg, #4f46e5, #3730a3)', color: '#ffffff', border: 'none',
                padding: '10px 28px', borderRadius: '10px', fontSize: '12px', fontWeight: '950',
                cursor: 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.2)', transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {modalT.btnClose}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderCreateLinkModal = () => {
    if (!showCreateLinkModal) return null;
    const predWork = worksSchedule[modalPredecessorId];
    const succWork = worksSchedule[modalSuccessorId];
    if (!predWork || !succWork) return null;

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200
      }}>
        <div style={{
          background: '#ffffff', borderRadius: '24px', width: '480px', maxWidth: '95%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0',
          padding: '24px', gap: '16px'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>Создание связи</h3>
            <button
              onClick={() => setShowCreateLinkModal(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}
            >
              ✕
            </button>
          </div>

          {/* Predecessor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Предшественник (От работы)</span>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              {predWork.name}
            </div>
          </div>

          {/* Successor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Последователь (К работе)</span>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              {succWork.name}
            </div>
          </div>

          {/* Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Тип связи *</span>
            <select
              value={newDependencyType}
              onChange={(e) => setNewDependencyType(e.target.value)}
              style={{
                padding: '10px 12px', fontSize: '13px', fontWeight: '700',
                borderRadius: '10px', border: '1.5px solid #cbd5e1', background: '#ffffff',
                color: '#1e293b', outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="FS">Finish → Start (FS)</option>
              <option value="SS">Start → Start (SS)</option>
              <option value="FF">Finish → Finish (FF)</option>
              <option value="SF">Start → Finish (SF)</option>
            </select>
          </div>

          {/* Lag */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Смещение (дня)</span>
            <input
              type="number"
              value={newDependencyLag}
              onChange={(e) => setNewDependencyLag(parseInt(e.target.value, 10) || 0)}
              style={{
                padding: '10px 12px', fontSize: '13px', fontWeight: '700',
                borderRadius: '10px', border: '1.5px solid #cbd5e1', outline: 'none'
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button
              onClick={() => setShowCreateLinkModal(false)}
              style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: '#f1f5f9', color: '#64748b', fontWeight: '750', cursor: 'pointer' }}
            >
              Отмена
            </button>
            <button
              onClick={() => {
                const ok = handleAddDirectDependency(modalPredecessorId, modalSuccessorId, newDependencyType, newDependencyLag);
                if (ok) setShowCreateLinkModal(false);
              }}
              style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: '#2563eb', color: '#ffffff', fontWeight: '750', cursor: 'pointer' }}
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEditLinkModal = () => {
    if (!showEditLinkModal || !editingDependency) return null;
    const predWork = worksSchedule[editingDependency.predecessor_id];
    const succWork = worksSchedule[editingDependency.successor_id];
    if (!predWork || !succWork) return null;

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200
      }}>
        <div style={{
          background: '#ffffff', borderRadius: '24px', width: '480px', maxWidth: '95%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0',
          padding: '24px', gap: '16px'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>Редактирование связи</h3>
            <button
              onClick={() => setShowEditLinkModal(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}
            >
              ✕
            </button>
          </div>

          {/* Predecessor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Предшественник (От работы)</span>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              {predWork.name}
            </div>
          </div>

          {/* Successor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Последователь (К работе)</span>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              {succWork.name}
            </div>
          </div>

          {/* Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Тип связи *</span>
            <select
              value={newDependencyType}
              onChange={(e) => setNewDependencyType(e.target.value)}
              style={{
                padding: '10px 12px', fontSize: '13px', fontWeight: '700',
                borderRadius: '10px', border: '1.5px solid #cbd5e1', background: '#ffffff',
                color: '#1e293b', outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="FS">Finish → Start (FS)</option>
              <option value="SS">Start → Start (SS)</option>
              <option value="FF">Finish → Finish (FF)</option>
              <option value="SF">Start → Finish (SF)</option>
            </select>
          </div>

          {/* Lag */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Смещение (дня)</span>
            <input
              type="number"
              value={newDependencyLag}
              onChange={(e) => setNewDependencyLag(parseInt(e.target.value, 10) || 0)}
              style={{
                padding: '10px 12px', fontSize: '13px', fontWeight: '700',
                borderRadius: '10px', border: '1.5px solid #cbd5e1', outline: 'none'
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '10px' }}>
            <button
              onClick={() => {
                handleDeleteDirectDependency(editingDependency.predecessor_id, editingDependency.successor_id);
                setShowEditLinkModal(false);
              }}
              style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: '#fef2f2', color: '#ef4444', fontWeight: '750', cursor: 'pointer' }}
            >
              Удалить связь
            </button>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowEditLinkModal(false)}
                style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: '#f1f5f9', color: '#64748b', fontWeight: '750', cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  handleUpdateDirectDependency(editingDependency.predecessor_id, editingDependency.successor_id, newDependencyType, newDependencyLag);
                  setShowEditLinkModal(false);
                }}
                style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: '#2563eb', color: '#ffffff', fontWeight: '750', cursor: 'pointer' }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: 'inherit', color: '#0f172a' }}>
      
      {/* Уведомления */}
      {errorToast && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 18px',
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px',
          color: '#991b1b', fontSize: '12px', fontWeight: '700'
        }}>
          <AlertTriangle size={18} color="#dc2626" />
          <div style={{ flex: 1 }}>{errorToast}</div>
          <button onClick={() => setErrorToast('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 'bold' }}>✕</button>
        </div>
      )}

      {successToast && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 18px',
          background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '10px',
          color: '#166534', fontSize: '12px', fontWeight: '700'
        }}>
          <CheckCircle size={18} color="#16a34a" />
          <div style={{ flex: 1 }}>{successToast}</div>
          <button onClick={() => setSuccessToast('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 'bold' }}>✕</button>
        </div>
      )}

      {linkingSource && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '12px',
          padding: '10px 16px', margin: '0 0 12px 0', fontSize: '12px', fontWeight: '750', color: '#1e40af'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🔗</span>
            <span>
              Установка связи от работы <strong>«{worksSchedule[linkingSource.workId]?.name}»</strong> ({linkingSource.edgeType === 'start' ? 'Начало' : 'Окончание'}). Выберите вторую работу для соединения...
            </span>
          </div>
          <button
            onClick={() => setLinkingSource(null)}
            style={{
              background: '#3b82f6', color: '#ffffff', border: 'none', padding: '4px 10px',
              borderRadius: '8px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer'
            }}
          >
            Отмена
          </button>
        </div>
      )}

      {/* Верхняя панель переключателей и заголовка */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between',
        background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '12px 20px', flexWrap: 'wrap', gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ background: 'linear-gradient(135deg, #1e293b, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {t.generalSchedulingHeading || 'Общее календарное планирование'}
            </span>
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Индикатор авто-сохранения */}
          {autoSaveStatus === 'pending' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#94a3b8', fontWeight: '600' }}>
              <Cloud size={13} />
              {t.schedWaiting || 'Ожидание...'}
            </div>
          )}
          {autoSaveStatus === 'saving' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#2563eb', fontWeight: '700' }}>
              <RefreshCw size={13} className="animate-spin" />
              {t.schedSaving || 'Сохранение...'}
            </div>
          )}
          {autoSaveStatus === 'saved' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#16a34a', fontWeight: '700' }}>
              <CheckCircle size={13} />
              {t.schedSaved || 'Сохранено'}
            </div>
          )}
          {autoSaveStatus === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#dc2626', fontWeight: '700' }}>
              <AlertTriangle size={13} />
              {t.schedError || 'Ошибка'}
            </div>
          )}

          {/* Переключатель ТАБЛИЦА / ГАНТТ */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <button
              onClick={() => setActiveView('table')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', border: 'none',
                background: activeView === 'table' ? '#ffffff' : 'transparent',
                color: activeView === 'table' ? '#2563eb' : '#64748b',
                boxShadow: activeView === 'table' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                padding: '6px 16px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer'
              }}
            >
              <Table size={14} />
              {t.schedViewTable || 'ТАБЛИЦА'}
            </button>
            <button
              onClick={() => setActiveView('gantt')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', border: 'none',
                background: activeView === 'gantt' ? '#ffffff' : 'transparent',
                color: activeView === 'gantt' ? '#2563eb' : '#64748b',
                boxShadow: activeView === 'gantt' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                padding: '6px 16px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer'
              }}
            >
              <BarChart3 size={14} />
              {t.schedViewGantt || 'ГАНТТ'}
            </button>
          </div>
        </div>

        {/* Масштаб Ганта */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* КРИТИЧЕСКИЙ ПУТЬ */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
            <button
              onClick={() => {
                setShowCriticalPath(prev => {
                  const next = !prev;
                  if (!next) {
                    setFilterOnlyCritical(false);
                  }
                  return next;
                });
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid #e2e8f0',
                background: showCriticalPath ? 'linear-gradient(135deg, #ffe4e6, #fecdd3)' : '#ffffff',
                color: showCriticalPath ? '#e11d48' : '#475569',
                boxShadow: showCriticalPath ? '0 2px 6px rgba(225, 29, 72, 0.08)' : 'none',
                padding: '6px 14px', borderRadius: '10px', fontSize: '11px', fontWeight: '800', cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <Zap size={14} color={showCriticalPath ? '#e11d48' : '#64748b'} />
              Критический путь
            </button>

            {showCriticalPath && (
              <button
                onClick={() => setFilterOnlyCritical(prev => !prev)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid #e2e8f0',
                  background: filterOnlyCritical ? '#e11d48' : '#ffffff',
                  color: filterOnlyCritical ? '#ffffff' : '#e11d48',
                  boxShadow: 'none',
                  padding: '6px 14px', borderRadius: '10px', fontSize: '11px', fontWeight: '800', cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <Filter size={14} color={filterOnlyCritical ? '#ffffff' : '#e11d48'} />
                Только критические
              </button>
            )}
          </div>

          {activeView === 'gantt' ? (
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px' }}>
              <button
                onClick={() => setScaleMode('days')}
                style={{
                  background: scaleMode === 'days' ? '#ffffff' : 'transparent',
                  color: scaleMode === 'days' ? '#2563eb' : '#64748b',
                  border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer'
                }}
              >
                {t.schedScaleDays || 'ДНИ'}
              </button>
              <button
                onClick={() => setScaleMode('weeks')}
                style={{
                  background: scaleMode === 'weeks' ? '#ffffff' : 'transparent',
                  color: scaleMode === 'weeks' ? '#2563eb' : '#64748b',
                  border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer'
                }}
              >
                {t.schedScaleWeeks || 'НЕДЕЛИ'}
              </button>
              <button
                onClick={() => setScaleMode('months')}
                style={{
                  background: scaleMode === 'months' ? '#ffffff' : 'transparent',
                  color: scaleMode === 'months' ? '#2563eb' : '#64748b',
                  border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer'
                }}
              >
                {t.schedScaleMonths || 'МЕСЯЦЫ'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>
              ⏱️ {lang === 'ru' ? 'Длительность всех работ' : (t.schedTotalDuration || 'Total Duration of Works')}: <strong>{worksDurationDays} {lang === 'ru' ? 'дней' : (t.schedDaysUnit || 'days')}</strong>
            </div>
          )}
        </div>
      </div>

      {/* --- ТАБЛИЦА СВЕРХУ + ГАНТТ СНИЗУ --- */}
      {activeView === 'table' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {renderTableBlock()}
          <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', margin: '0 0 12px 0', color: '#475569' }}>
              {t.schedGanttTitle || 'Диаграмма Ганта'}
            </h3>
            {renderGanttBlock(true)}
          </div>
        </div>
      )}

      {/* --- ПОЛНОРАЗМЕРНЫЙ ГАНТТ --- */}
      {activeView === 'gantt' && renderGanttBlock(false)}

      {renderDependencyModal()}
      {renderCreateLinkModal()}
      {renderEditLinkModal()}

      {pendingCriticalChange && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            width: '440px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%', background: '#fff1f2',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f43f5e'
              }}>
                <AlertTriangle size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '900', color: '#0f172a' }}>
                Изменение критической работы
              </h3>
            </div>
            
            <div style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
              Работа входит в критический путь.
              <div style={{ marginTop: '4px' }}>
                Увеличение длительности на <strong>{pendingCriticalChange.value - pendingCriticalChange.previousValue} дня</strong> <span style={{ fontWeight: '700' }}>перенесет дату</span> окончания проекта на <strong>{pendingCriticalChange.value - pendingCriticalChange.previousValue} рабочих дня</strong>.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div>
                <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: '750', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  Текущая дата окончания проекта
                </div>
                <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: '800', marginTop: '2px' }}>
                  {(() => {
                    let maxD = null;
                    Object.values(worksSchedule).forEach(w => {
                      if (w.start_date) {
                        const eStr = calculateEndDate(w.start_date, w.duration_days);
                        const e = parseDateString(eStr);
                        if (e && (!maxD || e > maxD)) maxD = e;
                      }
                    });
                    const currentFinishDate = maxD ? formatDateForInput(maxD) : '';
                    return formatDisplayDate(currentFinishDate);
                  })()}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: '750', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  Новая дата окончания проекта
                </div>
                <div style={{ fontSize: '14px', color: '#e11d48', fontWeight: '800', marginTop: '2px' }}>
                  {(() => {
                    let maxD = null;
                    Object.values(worksSchedule).forEach(w => {
                      if (w.start_date) {
                        const eStr = calculateEndDate(w.start_date, w.duration_days);
                        const e = parseDateString(eStr);
                        if (e && (!maxD || e > maxD)) maxD = e;
                      }
                    });
                    const currentFinishDate = maxD ? formatDateForInput(maxD) : '';
                    const diffDays = pendingCriticalChange.value - pendingCriticalChange.previousValue;
                    const newFinishDate = addDaysToDate(currentFinishDate, diffDays);
                    return formatDisplayDate(newFinishDate);
                  })()}
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <button
                onClick={() => setPendingCriticalChange(null)}
                style={{
                  flex: 1, padding: '10px', background: '#f1f5f9', border: 'none',
                  borderRadius: '10px', fontWeight: '750', fontSize: '12px', color: '#475569',
                  cursor: 'pointer', transition: 'background 0.2s'
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
              >
                Отменить
              </button>
              <button
                onClick={() => {
                  applyFieldChange(pendingCriticalChange.workId, pendingCriticalChange.field, pendingCriticalChange.value);
                  setPendingCriticalChange(null);
                }}
                style={{
                  flex: 1, padding: '10px', background: '#2563eb',
                  border: 'none', borderRadius: '10px', fontWeight: '750', fontSize: '12px', color: '#ffffff',
                  cursor: 'pointer', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)', transition: 'opacity 0.2s'
                }}
                onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                onMouseOut={(e) => { e.currentTarget.style.opacity = '1.0'; }}
              >
                Сохранить и пересчитать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
