import { translations } from '../lang';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import {
  ArrowLeft, FolderPlus, PlusCircle, Trash2, Database, Box, User, Settings,
  Save, CheckCircle2, X, Calculator, Percent, Plus, Folder, Briefcase, List,
  Download, Send, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, FileText, LayoutGrid, Edit,
  MinusCircle, RotateCcw, Copy, Eye, EyeOff, Cloud, RefreshCw, AlertTriangle, Calendar
} from 'lucide-react';

const CURRENCY = '₾'; // Валюта (легко изменить на ₸, $, € и т.д.)

const TAB_TRANSLATIONS = {
  ru: {
    all: 'Все',
    labor: 'Люди 👥',
    machine: 'Механизмы 🏗️',
    material: 'Материалы 📦',
    nonlabor: 'Прочие ⚙️'
  },
  en: {
    all: 'All',
    labor: 'Labour 👥',
    machine: 'Machinery 🏗️',
    material: 'Materials 📦',
    nonlabor: 'Nonlabor ⚙️'
  },
  ka: {
    all: 'ყველა',
    labor: 'შრომა 👥',
    machine: 'მექანიზმები 🏗️',
    material: 'მასალები 📦',
    nonlabor: 'არაშრომითი ⚙️'
  },
  az: {
    all: 'Hamısı',
    labor: 'Əmək 👥',
    machine: 'Mexanizmlər 🏗️',
    material: 'Materiallar 📦',
    nonlabor: 'Əməkdən Kənar ⚙️'
  },
  tr: {
    all: 'Tümü',
    labor: 'İşgücü 👥',
    machine: 'Makine 🏗️',
    material: 'Malzeme 📦',
    nonlabor: 'İşgücü Dışı ⚙️'
  }
};



/** Цена из локальной карты (запасной вариант) */
const lookupResourcePrice = (pricesMap, resourceId) => {
  if (!resourceId || !pricesMap) return 0;
  const key = String(resourceId);
  const raw = pricesMap[key] ?? pricesMap[resourceId];
  return Number(raw) || 0;
};

/** Снимок сметы для сравнения «есть ли несохранённые изменения» */
const snapshotForCompare = (payload) => {
  if (!payload) return null;
  const clone = JSON.parse(JSON.stringify(payload));
  (clone.works || []).forEach(w => {
    delete w.hierarchicalCode;
  });
  return clone;
};

// --- ВСПОМОГАТЕЛЬНЫЙ КОМПОНЕНТ: МОДАЛЬНОЕ ОКНО ---
const Modal = ({ title, children, onClose, onSubmit, isSaving, hideSubmitButton, style }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, paddingTop: '5vh'}}>
    <div className="premium-card animate-slide-up" style={{ width: '100%', maxWidth: '500px', background: 'white', padding: '20px 24px', borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)', border: 'none', marginTop: '20px', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>{title}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }} disabled={isSaving}><X size={20} /></button>
      </div>
      <div style={{ color: '#475569' }}>
        {children}
      </div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
        <button onClick={onClose} style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }} disabled={isSaving}>
          {hideSubmitButton ? 'Закрыть' : 'Отмена'}
        </button>
        {!hideSubmitButton && (
          <button onClick={onSubmit} className="btn-primary" style={{ flex: 1, background: isSaving ? '#94a3b8' : '#3b82f6', borderRadius: '12px' }} disabled={isSaving}>
            {isSaving ? 'Сохранение...' : (title.includes('ресурс') ? 'Добавить ресурс' : 'Сохранить')}
          </button>
        )}
      </div>
    </div>
  </div>
);


// Скрыта по просьбе заказчика в рабочей версии сметы (кнопка "Утвердить" черновика) — при необходимости вернуть, поставить true
const SHOW_DRAFT_APPROVE_BUTTON = false;

function EstimateEditor({ docId, userRole = 'admin', currentUserId = null, resourceLanguage = 'ru', setResourceLanguage, onBack, isReadOnly = false, onOpenScheduling, showPlanVersioning = true }) {
  const [activeDocId, setActiveDocId] = useState(docId);
  useEffect(() => {
    setActiveDocId(docId);
  }, [docId]);

  // Шапка с итогами (Расходы/Маржа/Рентабельность/Себестоимость) скрыта по умолчанию — пользователь открывает её сам
  const [showTotalsDashboard, setShowTotalsDashboard] = useState(false);

  const currentLang = resourceLanguage || 'ru';
  const t = translations[currentLang] || translations.ru;
  const [data, setData] = useState(null);
  const [originalData, setOriginalData] = useState(null); // Бэкап для сравнения черновика
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [isCreatingActual, setIsCreatingActual] = useState(false);
  const [financialDirectors, setFinancialDirectors] = useState([]);
  const [isLoadingApprovers, setIsLoadingApprovers] = useState(false);
  const [selectedApproverId, setSelectedApproverId] = useState('');
  const [submitReviewComment, setSubmitReviewComment] = useState('');
  const [isWbsPanelOpen, setIsWbsPanelOpen] = useState(true);
  const [activeWbsId, setActiveWbsId] = useState(null);
  const [availableWorks, setAvailableWorks] = useState([]);
  const [workSearchQuery, setWorkSearchQuery] = useState('');
  const [regions, setRegions] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  const activeCurrency = currencies.find(c => c.id === data?.doc?.currency_id);
  const CURRENCY = activeCurrency?.symbol || activeCurrency?.code || '₾';

  // UI State
  const [activeWorkId, setActiveWorkId] = useState(null); // Активная работа для просмотра ресурсов
  const activeWork = useMemo(() => {
    return data?.works?.find(w => w.id === activeWorkId);
  }, [data?.works, activeWorkId]);
  const [showAllResources, setShowAllResources] = useState(false); // Переключатель "Все ресурсы"
  // Таблица детализации ресурсов скрыта по умолчанию, чтобы не съедать половину экрана,
  // пока пользователь ничего не выбрал. Разворачивается сама при выборе работы (или "Все
  // ресурсы") — вручную скрыть можно кнопкой-иконкой, тогда флаг держит панель закрытой,
  // пока пользователь не выберет работу заново.
  const [resourcesPanelHidden, setResourcesPanelHidden] = useState(true);
  useEffect(() => {
    if (activeWorkId || showAllResources) setResourcesPanelHidden(false);
    else setResourcesPanelHidden(true);
  }, [activeWorkId, showAllResources]);
  const [wbsSearchQuery, setWbsSearchQuery] = useState('');
  const [resourceFilterQuery, setResourceFilterQuery] = useState('');
  const [showExcludedWorks, setShowExcludedWorks] = useState(false); // Скрыть/отобразить работы снятые с расчета
  const [showExcludedResources, setShowExcludedResources] = useState(false); // Скрыть/отобразить ресурсы снятые с расчета

  // Состояние древовидной структуры WBS
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [isWbsSidebarHovered, setIsWbsSidebarHovered] = useState(false);
  const [selectedSidebarWbsId, setSelectedSidebarWbsId] = useState(null); // Выбранный узел WBS
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set()); // Свернутые узлы WBS

  // Справочник цен на ресурсы
  const [resourcePrices, setResourcePrices] = useState({});

  // Modal States
  const [modalType, setModalType] = useState(null);
  const [formData, setFormData] = useState({});
  const [selectedWorkId, setSelectedWorkId] = useState(null);

  // Resource Search State
  const [resourceSearchQuery, setResourceSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedResource, setSelectedResource] = useState(null);
  const [internalLang, setInternalLang] = useState('ru'); // Резервный переключатель языка
  const [isLangLoading, setIsLangLoading] = useState(false);
  const [defaultResources, setDefaultResources] = useState([]);
  const [resourceTypeFilter, setResourceTypeFilter] = useState('all');
  const [selectedWorkUnit, setSelectedWorkUnit] = useState('');
  const [selectedResourceUnit, setSelectedResourceUnit] = useState('');
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  const handleLanguageChange = (lang) => {
    setIsLangLoading(true);
    if (setResourceLanguage) {
      setResourceLanguage(lang);
    } else {
      setInternalLang(lang);
    }
    setTimeout(() => {
      setIsLangLoading(false);
    }, 600);
  };

  const [workResourcesToFill, setWorkResourcesToFill] = useState([]); // Ресурсы для заполнения после добавления работы
  const [activeWorkNorms, setActiveWorkNorms] = useState([]);
  const [targetWorkId, setTargetWorkId] = useState(null); // ID только что созданной работы в смете
  const [editingResource, setEditingResource] = useState(null); // Ресурс, который мы сейчас редактируем
  const [selectedTargetWorkId, setSelectedTargetWorkId] = useState(null); // Конкретная работа для добавления ресурса
  const [isSaving, setIsSaving] = useState(false); // Индикатор загрузки для кнопок
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  const autoSaveTimerRef = useRef(null);
  const hasOpenedModalRef = useRef(false);
  const [wbsTemplates, setWbsTemplates] = useState([]);
  const [selectedTemplateCodes, setSelectedTemplateCodes] = useState([]);

  useEffect(() => {
    if (modalType === 'resource-db' || modalType === 'browse-all-resources') {
      const workId = selectedTargetWorkId || activeWorkId;
      const work = data?.works?.find(w => w.id === workId);
      if (work?.work_id) {
        const countryCode = data?.doc?.country_code || data?.doc?.country || 'GE';
        api.get(`/estimates/norms/${work.work_id}?country_code=${countryCode}`)
          .then(res => {
            setActiveWorkNorms(res.data || []);
          })
          .catch(err => {
            console.warn('[WARN] Не удалось предварительно загрузить нормативы:', err);
            setActiveWorkNorms([]);
          });
      } else {
        setActiveWorkNorms([]);
      }
    } else {
      setActiveWorkNorms([]);
    }
  }, [modalType, selectedTargetWorkId, activeWorkId, data]);

  useEffect(() => {
    setLoading(true);
    setAvailableWorks([]);
    setDefaultResources([]);
    setSearchResults([]);
    setActiveWorkId(null);
    setResourceTypeFilter('all');
    setResourceSearchQuery('');
    fetchData();
  }, [activeDocId]);

  useEffect(() => {
    if (!data?.doc) return;
    const countryCode = data.doc.country_code || data.doc.country || 'GE';
    fetchDictionaries(countryCode, data.doc.region_id, data.doc.currency_id);
  }, [data?.doc?.region_id, data?.doc?.currency_id, data?.doc?.country_code]);

  useEffect(() => {
    // Раньше здесь дергался GET /dictionaries/prices без параметров при каждом открытии модала —
    // это тянуло ВСЮ таблицу цен (без фильтра по региону) и было главной причиной долгого открытия
    // «Добавить». Тот же price-map уже загружен через fetchDictionaries со scoping по региону/валюте —
    // здесь просто обновляем его тем же способом, а не заново без фильтра.
    const regionId = data?.doc?.region_id;
    const currencyId = data?.doc?.currency_id;
    const priceParams = regionId ? `?region_id=${regionId}${currencyId ? `&currency_id=${currencyId}` : ''}` : '';
    const refreshPrices = () => {
      api.get(`/dictionaries/prices${priceParams}`).then(res => {
        const map = res.data || {};
        const normalized = {};
        Object.entries(map).forEach(([id, price]) => { normalized[String(id)] = Number(price) || 0; });
        setResourcePrices(normalized);
      }).catch(() => {});
    };

    if (modalType === 'resource-db' || modalType === 'browse-all-resources') {
      refreshPrices();
      if (!hasOpenedModalRef.current) {
        // Первое открытие модала — инициализируем список и сбрасываем фильтр
        setResourceTypeFilter('all');
        setResourceSearchQuery('');
        setSearchResults(defaultResources);
        hasOpenedModalRef.current = true;
      }
      // Если модал уже открыт — ничего не трогаем, фильтр остаётся
    } else if (modalType === 'fill-work-resources') {
      refreshPrices();
      hasOpenedModalRef.current = false;
    } else {
      hasOpenedModalRef.current = false;
    }
  }, [modalType, defaultResources]); // defaultResources добавлено, чтобы синхронизировать ресурсы при первом открытии/смене страны

  const applyEstimateSnapshot = (fetchedData) => {
    const snapshot = JSON.parse(JSON.stringify(fetchedData));
    setData(snapshot);
    setOriginalData(JSON.parse(JSON.stringify(snapshot)));
  };

  useEffect(() => {
    if (!data || !originalData) return;
    
    // Блокируем автосохранение для плановых и утвержденных версий
    const currentStatus = data?.doc?.status;
    const isLocked = currentStatus === 'approved' || (currentStatus && currentStatus.startsWith('planned_'));
    if (isLocked) return;

    // Check if there are changes to save
    const hasUnsavedChanges = JSON.stringify(snapshotForCompare(data)) !== JSON.stringify(snapshotForCompare(originalData));
    if (!hasUnsavedChanges) {
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    setAutoSaveStatus('pending');

    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving');
      setIsSaving(true);
      try {
        await api.post(`/estimates/${activeDocId}/save`, {
          wbs: data.wbs,
          works: data.works,
          resources: data.resources,
          coefficients: data.coefficients,
          project_id: data.doc?.project_id,
          region_id: data.doc?.region_id || null,
          currency_id: data.doc?.currency_id || null
        });
        
        setOriginalData(JSON.parse(JSON.stringify(data)));
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 3000);
      } catch (err) {
        console.error('[AUTO SAVE ESTIMATE ERROR]:', err);
        setAutoSaveStatus('error');
      } finally {
        setIsSaving(false);
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [data, originalData, activeDocId, api]);


  const fetchData = async () => {
    try {
      const res = await api.get(`/estimates/${activeDocId}`);
      let fetchedData = res.data;
      const status = fetchedData?.doc?.status;
      if (status === 'approved' || (status && status.startsWith('planned_'))) {
        fetchedData.works = (fetchedData.works || []).filter(w => !w.is_excluded);
        fetchedData.resources = (fetchedData.resources || []).filter(r => !r.is_excluded);
      }
      applyEstimateSnapshot(fetchedData);
      setVersions(fetchedData.versions || []);
      if (fetchedData?.wbs?.length > 0 && !activeWbsId) {
        setActiveWbsId(fetchedData.wbs[0].id);
      }
      setLoading(false);

      // Fetch history logs in background
      api.get(`/estimates/${activeDocId}/history`)
        .then(hRes => setHistoryLogs(hRes.data || []))
        .catch(hErr => console.warn('Error fetching history:', hErr));

      return fetchedData;
    } catch (err) {
      console.error(err);
      setLoading(false);
      return null;
    }
  };

  /** Актуальная цена из Supabase (est_prices) через API модуля сметы */
  const fetchResourcePriceFromDb = async (resourceId) => {
    if (!resourceId) return 0;
    const key = String(resourceId);

    const savePrice = (price) => {
      if (!Number.isNaN(price)) {
        setResourcePrices(prev => ({ ...prev, [key]: price }));
        return price;
      }
      return null;
    };

    // 1) Основной способ: GET /dictionaries/prices?resource_id=...
    try {
      const res = await api.get('/dictionaries/prices', { 
        params: { 
          resource_id: key,
          region_id: data?.doc?.region_id || null,
          currency_id: data?.doc?.currency_id || null
        } 
      });
      const p = savePrice(Number(res.data?.price));
      if (p !== null) return p;
    } catch (err) {
      console.warn('[WARN] Цена (query):', key, err.response?.status || err.message);
    }

    // 2) Запасной: GET /estimates/resource-price/...
    try {
      const res = await api.get(`/estimates/resource-price/${key}`);
      const p = savePrice(Number(res.data?.price));
      if (p !== null) return p;
    } catch (err) {
      console.warn('[WARN] Цена (estimates):', key, err.response?.status || err.message);
    }

    // 3) Локальная карта (загружена при открытии сметы)
    return lookupResourcePrice(resourcePrices, resourceId);
  };

  const fetchDictionaries = async (countryCode, regionId, currencyId) => {
    try {
      const countryParam = countryCode ? `?country=${countryCode}` : '';
      const regionParam = regionId ? (countryCode ? `&region_id=${regionId}` : `?region_id=${regionId}`) : '';
      const priceParams = regionId ? `?region_id=${regionId}${currencyId ? `&currency_id=${currencyId}` : ''}` : '';

      // Валюты — маленький справочник, запрашиваем отдельно от тяжёлых каталогов работ/ресурсов,
      // чтобы правильный символ валюты появлялся сразу, а не спустя те же 2-5 сек, что и вся сводная
      // выборка (иначе в шапке смёты какое-то время держится захардкоженный фолбэк ₾).
      api.get('/dictionaries/currencies')
        .then(res => setCurrencies(Array.isArray(res.data) ? res.data : []))
        .catch(() => {});

      const [worksRes, resRes, regionsRes, templatesRes] = await Promise.all([
        api.get(`/dictionaries/works${countryParam}${regionParam}`),
        api.get(`/dictionaries/resources${countryParam}${regionParam}`),
        api.get('/dictionaries/regions'),
        api.get(`/estimates/templates${countryParam}`).catch(() => ({ data: [] }))
      ]);
      setAvailableWorks(Array.isArray(worksRes.data) ? worksRes.data : []);
      setDefaultResources(Array.isArray(resRes.data) ? resRes.data : []);
      // NOTE: не трогаем searchResults здесь — он управляется только при открытии модала
      // чтобы активный фильтр не сбрасывался при фоновом обновлении справочников
      setRegions(Array.isArray(regionsRes.data) ? regionsRes.data : []);
      const rawTemplates = templatesRes?.data;
      const safeTemplates = Array.isArray(rawTemplates) ? rawTemplates : (Array.isArray(rawTemplates?.templates) ? rawTemplates.templates : []);
      setWbsTemplates(safeTemplates);
      // Загружаем цены из базы данных с учетом региона сметы
      try {
        const pricesRes = await api.get(`/dictionaries/prices${priceParams}`);
        const map = pricesRes.data || {};
        const normalized = {};
        Object.entries(map).forEach(([id, price]) => {
          normalized[String(id)] = Number(price) || 0;
        });
        setResourcePrices(normalized);
      } catch (priceErr) {
        console.warn('[WARN] Не удалось загрузить цены:', priceErr);
        setResourcePrices({});
      }
    } catch (err) { 
        console.error('[DICTIONARIES ERROR]:', err);
    }
  };

  // --- Рекурсивное построение WBS дерева ---
  const buildTree = useMemo(() => {
    if (!data) return [];
    
    const wbsMap = {};
    const rootNodes = [];

    // 1. Создаем структуру для каждого WBS-узла
    data.wbs.forEach(node => {
      const nodeName = node[`name_${currentLang}`] || node.name_ge || node.name_ka || node.name;
      wbsMap[node.id] = {
        ...node,
        name: nodeName,
        children: [],
        works: [],
        depth: 0,
        code: ''
      };
    });

    // 2. Связываем дочерние WBS с родительскими WBS
    data.wbs.forEach(node => {
      const current = wbsMap[node.id];
      if (node.parent_id && wbsMap[node.parent_id]) {
        wbsMap[node.parent_id].children.push(current);
      } else {
        rootNodes.push(current);
      }
    });

    // 3. Рекурсивно вычисляем глубину и формируем иерархический код
    const calculateDepthAndCodes = (node, currentDepth, prefix) => {
      node.depth = currentDepth;
      node.code = prefix;
      
      // Назначаем типы разделов, если не заданы
      if (!node.type) {
        if (currentDepth === 0) node.type = 'object';
        else if (currentDepth === 1) node.type = 'construct';
        else node.type = 'subconstruct';
      }

      node.children.forEach((child, idx) => {
        calculateDepthAndCodes(child, currentDepth + 1, `${prefix}.${idx + 1}`);
      });
    };

    rootNodes.forEach((node, idx) => {
      calculateDepthAndCodes(node, 0, `${idx + 1}`);
    });

    // 4. Распределяем работы по WBS-узлам
    const activeWorks = data.works || [];

    const filteredWorks = activeWorks.filter(w => {
      if (!showExcludedWorks && w.is_excluded) return false;
      const workName = w.est_works?.[`name_${resourceLanguage}`] || w.est_works?.name || '';
      return !wbsSearchQuery || workName.toLowerCase().includes(wbsSearchQuery.toLowerCase());
    });

    filteredWorks.forEach(work => {
      if (work.wbs_id && wbsMap[work.wbs_id]) {
        wbsMap[work.wbs_id].works.push(work);
      }
    });

    return rootNodes;
  }, [data, wbsSearchQuery, showExcludedWorks, currentLang, resourceLanguage]);

  // --- Рекурсивный подсчет суммы для WBS узла ---
  const getWbsNodeSum = (node) => {
    const worksSum = node.works.reduce((sum, w) => sum + getWorkSum(w), 0);
    const childrenSum = node.children.reduce((sum, child) => sum + getWbsNodeSum(child), 0);
    return worksSum + childrenSum;
  };

  // --- Иерархический плоский список WBS узлов для боковой панели ---
  const flattenedSidebarWbs = useMemo(() => {
    if (!buildTree || buildTree.length === 0) return [];
    const list = [];
    const traverse = (nodes) => {
      nodes.forEach(node => {
        list.push(node);
        if (node.children && node.children.length > 0) {
          traverse(node.children);
        }
      });
    };
    traverse(buildTree);
    return list;
  }, [buildTree]);

  // --- Плоский список строк дерева для таблицы ---
  const allowedSidebarWbsIds = useMemo(() => {
    if (!selectedSidebarWbsId || !data?.wbs) return null;
    const selectedNode = data.wbs.find(n => n.id === selectedSidebarWbsId);
    if (!selectedNode) return null;

    const allowed = new Set([selectedNode.id]);

    // Рекурсивно собираем все дочерние элементы любого уровня
    const collectDescendants = (parentId) => {
      data.wbs.forEach(node => {
        if (node.parent_id === parentId) {
          if (!allowed.has(node.id)) {
            allowed.add(node.id);
            collectDescendants(node.id);
          }
        }
      });
    };
    collectDescendants(selectedNode.id);

    return allowed;
  }, [data?.wbs, selectedSidebarWbsId]);

  const flattenedTreeRows = useMemo(() => {
    const rows = [];
    
    const flatten = (nodes, parentIsVisible = true) => {
      nodes.forEach(node => {
        const isCollapsed = collapsedNodes.has(node.id);
        const hasChildren = node.children.length > 0 || node.works.length > 0;
        
        const isWbsAllowed = !allowedSidebarWbsIds || allowedSidebarWbsIds.has(node.id);
        const nodeVisible = parentIsVisible && isWbsAllowed;

        rows.push({
          rowType: 'wbs',
          id: node.id,
          name: node.name,
          type: node.type,
          depth: node.depth,
          parent_id: node.parent_id,
          code: node.code,
          isCollapsed,
          hasChildren,
          isVisible: nodeVisible,
          nodeData: node
        });

        // Добавляем работы для этого узла
        node.works.forEach((work, workIdx) => {
          rows.push({
            rowType: 'work',
            id: work.id,
            name: work.est_works?.[`name_${resourceLanguage}`] || work.est_works?.name,
            unit: work.est_works?.unit,
            volume: work.volume,
            is_excluded: work.is_excluded,
            depth: node.depth + 1,
            code: `${node.code}.${workIdx + 1}`,
            isVisible: nodeVisible && !isCollapsed,
            workData: work
          });
        });

        // Рекурсивно спускаемся к дочерним WBS
        if (node.children.length > 0) {
          flatten(node.children, parentIsVisible && !isCollapsed);
        }
      });
    };

    flatten(buildTree, true);
    return rows;
  }, [buildTree, collapsedNodes, allowedSidebarWbsIds, resourceLanguage]);

  const getWorkPath = (work) => {
    const path = [];
    let currentWbsId = work.wbs_id;
    while (currentWbsId) {
      const node = data?.wbs?.find(n => n.id === currentWbsId);
      if (node) {
        path.unshift(node.name);
        currentWbsId = node.parent_id;
      } else {
        break;
      }
    }
    const workName = work.est_works?.[`name_${resourceLanguage}`] || work.est_works?.name || 'Работа';
    path.push(workName);
    return path.join(' / ');
  };

  // --- Определяем есть ли несохраненные изменения ---
  const hasChanges = useMemo(() => {
    if (!data || !originalData) return false;
    return JSON.stringify(snapshotForCompare(data)) !== JSON.stringify(snapshotForCompare(originalData));
  }, [data, originalData]);

  const handleAddWbsElement = async () => {
    // Determine the name
    let name = '';
    if (formData.type === 'construct') {
      name = (formData.customName || formData.standardName || '').trim();
    } else if (formData.nameType === 'custom') {
      name = (formData.customName || '').trim();
    } else {
      name = (formData.standardName || '').trim();
    }

    if (!name.trim()) {
      alert("Пожалуйста, введите или выберите название раздела.");
      return;
    }

    let parentId = null;
    if (formData.type === 'subconstruct' || formData.type === 'construct') {
      parentId = formData.parentId || null;
      if (formData.type === 'subconstruct' && !parentId) {
        alert("Пожалуйста, выберите родительский Конструктив.");
        return;
      }
    }

    setIsSaving(true);
    try {
      const response = await api.post('/estimates/wbs', {
        doc_id: docId,
        parent_id: parentId,
        name: name.trim(),
        type: formData.type,
        sort_order: (data?.wbs?.length || 0) + 1
      });

      const newWbs = response.data;

      setData(prev => ({
        ...prev,
        wbs: [...(prev.wbs || []), newWbs]
      }));

      setOriginalData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          wbs: [...(prev.wbs || []), newWbs]
        };
      });

      if (parentId) {
        setCollapsedNodes(prev => {
          const next = new Set(prev);
          next.delete(parentId); // раскрываем родительский узел
          return next;
        });
      }

      setModalType(null);
      setFormData({});
    } catch (err) {
      alert("Ошибка при создании раздела WBS: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddWorkElement = async () => {
    const targetWbsId = formData.parentId;
    if (!selectedWorkId || !formData.volume || !targetWbsId) {
      alert("Пожалуйста, выберите работу, введите объем и выберите родительский раздел WBS.");
      return;
    }
    setIsSaving(true);
    try {
      const tempWorkId = 'temp_work_' + Date.now();
      const workDetails = availableWorks.find(w => w.id === selectedWorkId);
      const volume = parseFloat(formData.volume);

      // Проверка на дубликат работы в выбранном WBS разделе
      const isWorkDuplicate = data?.works?.some(w => w.wbs_id === targetWbsId && w.work_id === selectedWorkId);
      if (isWorkDuplicate) {
        alert("Эта работа уже добавлена в данный раздел!");
        setIsSaving(false);
        return;
      }

      // Имя работы на выбранном языке
      const workName = workDetails
        ? (workDetails[`name_${resourceLanguage}`] || workDetails.name)
        : '';

      const newWork = {
        id: tempWorkId,
        doc_id: docId,
        wbs_id: targetWbsId,
        work_id: selectedWorkId,
        volume: volume,
        price: 0,
        amount: 0,
        is_excluded: false,
        est_works: {
          ...workDetails,
          name: workName
        }
      };

      const selectedRegion = regions.find(r => r.id === data?.doc?.region_id);
      const countryCode = selectedRegion?.dic_countries?.code || selectedRegion?.country_code || data?.doc?.country_code || data?.doc?.country || 'GE';
      const normsRes = await api.get(`/estimates/norms/${selectedWorkId}?country_code=${countryCode}`);
      const norms = normsRes.data || [];

      if (norms.length > 0) {
        const newResources = [];
        for (const n of norms) {
          const price = await fetchResourcePriceFromDb(n.resource_id);
          const quantity = n.norm * volume;
          const amount = quantity * price;
          
          newResources.push({
            id: 'temp_res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            doc_id: docId,
            work_id: tempWorkId,
            resource_id: n.resource_id,
            norm: n.norm,
            quantity: quantity,
            price: price,
            amount: amount,
            source: 'norm',
            is_excluded: false,
            est_resources: {
              ...n.est_resources
            }
          });
        }

        const newWorkAmount = newResources.reduce((sum, r) => sum + r.amount, 0);
        newWork.amount = newWorkAmount;

        setData(prev => ({
          ...prev,
          works: [...(prev.works || []), newWork],
          resources: [...(prev.resources || []), ...newResources]
        }));
      } else {
        alert("В справочнике отсутствует норма / ресурс для этой работы, пожалуйста, введите ресурсы вручную.");
        setData(prev => ({
          ...prev,
          works: [...(prev.works || []), newWork]
        }));
      }

      setActiveWorkId(tempWorkId);
      setSelectedNodeId(null);
      setCollapsedNodes(prev => {
        const next = new Set(prev);
        next.delete(targetWbsId);
        // Expand parent WBS as well if any
        const targetNode = data?.wbs?.find(n => n.id === targetWbsId);
        if (targetNode?.parent_id) next.delete(targetNode.parent_id);
        return next;
      });
      setModalType(null);
      setFormData({});

      setCollapsedNodes(prev => {
        const next = new Set(prev);
        next.delete(targetWbsId); // раскрываем узел
        return next;
      });

    } catch (err) { alert(err.message); }
    finally { setIsSaving(false); }
  };

  const handleSaveFilledResources = async () => {
    const allFilled = workResourcesToFill.every(r => (r.norm && parseFloat(r.norm) > 0) || (r.quantity && parseFloat(r.quantity) > 0));

    if (!allFilled) {
      alert("Пожалуйста, заполните параметры (Норму или Количество) для всех позиций перед сохранением.");
      return;
    }

    setIsSaving(true);
    try {
    const newResources = [];
    for (const r of workResourcesToFill) {
      const price = await fetchResourcePriceFromDb(r.resource_id);
      const quantity = parseFloat(r.quantity || 0);
      const norm = parseFloat(r.norm || 0);
      const amount = quantity * price;
      newResources.push({
        id: 'temp_res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        doc_id: docId,
        work_id: targetWorkId,
        resource_id: r.resource_id,
        norm: norm,
        quantity: quantity,
        price: price,
        amount: amount,
        source: 'manual',
        is_excluded: false,
        est_resources: {
          ...r,
          id: r.resource_id,
          name: r.displayName || r.name
        }
      });
    }

    setData(prev => {
      const updatedResources = [...(prev.resources || []), ...newResources];
      const newWorkAmount = newResources.reduce((sum, r) => sum + r.amount, 0);
      const updatedWorks = (prev.works || []).map(w => {
        if (w.id === targetWorkId) {
          return { ...w, amount: newWorkAmount };
        }
        return w;
      });
      return {
        ...prev,
        works: updatedWorks,
        resources: updatedResources
      };
    });

    setActiveWorkId(targetWorkId);
    setModalType(null);
    setWorkResourcesToFill([]);
    setTargetWorkId(null);
    } catch (err) {
      alert('Ошибка при добавлении ресурсов: ' + (err.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleWorkExclusion = (workId, currentStatus) => {
    const work = data?.works?.find(w => w.id === workId);
    if (!work) return;

    // Если включаем обратно (currentStatus=true значит сейчас исключена, хотим включить) — без подтверждения
    if (currentStatus) {
      setData(prev => {
        const updatedWorks = prev.works.map(w => w.id === workId ? { ...w, is_excluded: false } : w);
        const updatedResources = prev.resources.map(r => r.work_id === workId ? { ...r, is_excluded: false } : r);
        return { ...prev, works: updatedWorks, resources: updatedResources };
      });
      return;
    }

    // Если снимаем с расчета — с подтверждением
    const workName = work.est_works?.name || "эту работу";
    if (!window.confirm(`Вы уверены, что хотите снять с расчета работу "${workName}"? Это изменит итоговую сумму сметы.`)) return;

    setData(prev => {
      const updatedWorks = prev.works.map(w => w.id === workId ? { ...w, is_excluded: true } : w);
      const updatedResources = prev.resources.map(r => r.work_id === workId ? { ...r, is_excluded: true } : r);
      return { ...prev, works: updatedWorks, resources: updatedResources };
    });
  };

  const handleToggleResourceExclusion = (resId, currentStatus) => {
    const res = data?.resources?.find(r => r.id === resId);
    if (!res) return;

    // Если включаем обратно — без подтверждения
    if (currentStatus) {
      setData(prev => {
        const updatedResources = prev.resources.map(r => r.id === resId ? { ...r, is_excluded: false } : r);
        const updatedWorks = prev.works.map(w => {
          if (w.id === res.work_id) {
            const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
            const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
            return { ...w, amount: newAmount };
          }
          return w;
        });
        return { ...prev, works: updatedWorks, resources: updatedResources };
      });
      return;
    }

    // Если снимаем с расчета — с подтверждением
    const resName = res.est_resources?.name || "этот ресурс";
    if (!window.confirm(`Вы уверены, что хотите снять с расчета ресурс "${resName}"?`)) return;

    setData(prev => {
      const updatedResources = prev.resources.map(r => r.id === resId ? { ...r, is_excluded: true } : r);
      const updatedWorks = prev.works.map(w => {
        if (w.id === res.work_id) {
          const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
          const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
          return { ...w, amount: newAmount };
        }
        return w;
      });
      return { ...prev, works: updatedWorks, resources: updatedResources };
    });
  };

  const handleDeleteWorkForever = (workId) => {
    if (!window.confirm("Удалить работу из проекта НАВСЕГДА?")) return;
    setData(prev => ({
      ...prev,
      works: (prev.works || []).filter(w => w.id !== workId),
      resources: (prev.resources || []).filter(r => r.work_id !== workId)
    }));
    if (activeWorkId === workId) setActiveWorkId(null);
  };

  const handleDeleteResourceForever = (resId) => {
    if (!window.confirm("Удалить этот ресурс из работы НАВСЕГДА?")) return;
    const resItem = data?.resources?.find(r => r.id === resId);
    if (!resItem) return;

    setData(prev => {
      const updatedResources = (prev.resources || []).filter(r => r.id !== resId);
      const updatedWorks = (prev.works || []).map(w => {
        if (w.id === resItem.work_id) {
          const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
          const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
          return { ...w, amount: newAmount };
        }
        return w;
      });
      return { ...prev, works: updatedWorks, resources: updatedResources };
    });
	// Важно: обновляем originalData, чтобы при сохранении не восстановился удаленный ресурс
    setOriginalData(prev => {
        if (!prev) return prev;
        const updatedResources = (prev.resources || []).filter(r => r.id !== resId);
        const updatedWorks = (prev.works || []).map(w => {
            if (w.id === resItem.work_id) {
                const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
                const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
                return { ...w, amount: newAmount };
            }
            return w;
        });
        return { ...prev, works: updatedWorks, resources: updatedResources };
    });
  };

  const handleToggleWbsExclusion = (wbsId, isCurrentlyExcluded) => {
    const nextStatus = !isCurrentlyExcluded;
    
    if (!isCurrentlyExcluded) {
      const node = data?.wbs?.find(n => n.id === wbsId);
      const nodeName = node?.name || "этот раздел";
      if (!window.confirm(`Вы уверены, что хотите снять с расчета раздел "${nodeName}" и все работы в нем? Это изменит итоговую сумму сметы.`)) {
        return;
      }
    }

    const getWbsDescendants = (id) => {
      let ids = [id];
      const children = (data?.wbs || []).filter(n => n.parent_id === id);
      children.forEach(child => {
        ids = ids.concat(getWbsDescendants(child.id));
      });
      return ids;
    };

    const targetWbsIds = getWbsDescendants(wbsId);

    setData(prev => {
      if (!prev) return prev;
      const updatedWbs = (prev.wbs || []).map(node => 
        targetWbsIds.includes(node.id) ? { ...node, is_excluded: nextStatus } : node
      );
      const updatedWorks = (prev.works || []).map(w => 
        targetWbsIds.includes(w.wbs_id) ? { ...w, is_excluded: nextStatus } : w
      );
      const updatedResources = (prev.resources || []).map(r => {
        const parentWork = prev.works.find(w => w.id === r.work_id);
        if (parentWork && targetWbsIds.includes(parentWork.wbs_id)) {
          return { ...r, is_excluded: nextStatus };
        }
        return r;
      });
      return { ...prev, wbs: updatedWbs, works: updatedWorks, resources: updatedResources };
    });
  };

  const handleAddCoeff = () => {
    if (!formData.name || !formData.percent) return;
    const tempCoeffId = 'temp_coeff_' + Date.now();
    const newCoeff = {
      id: tempCoeffId,
      doc_id: docId,
      name: formData.name,
      type: 'overhead',
      value_percent: parseFloat(formData.percent)
    };
    setData(prev => ({
      ...prev,
      coefficients: [...(prev.coefficients || []), newCoeff]
    }));
    setModalType(null);
    setFormData({});
  };

  const handleDeleteCoeff = (coeffId) => {
    if (!window.confirm("Удалить этот коэффициент?")) return;
    setData(prev => ({
      ...prev,
      coefficients: (prev.coefficients || []).filter(c => c.id !== coeffId)
    }));
  };

  // Раньше запрос улетал на каждое нажатие клавиши, дёргая бэкенд без задержки —
  // debounce в 300мс, чтобы не слать запрос на каждый символ при быстром наборе.
  const searchDebounceRef = useRef(null);

  const handleSearchResource = (query) => {
    setResourceSearchQuery(query);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => performResourceSearch(query), 300);
  };

  const performResourceSearch = async (query) => {
    setIsLangLoading(true);
    try {
      const countryCode = data?.doc?.country_code || data?.doc?.country || 'GE';
      const typeCode = resourceTypeFilter === 'labor' ? '10.100.' : (resourceTypeFilter === 'machine' ? '10.120.' : (resourceTypeFilter === 'material' ? '10.130.' : (resourceTypeFilter === 'nonlabor' ? '10.140.' : '')));
      const params = { country: countryCode };
      if (typeCode) params.type = typeCode;

      if (query.trim().length < 2) {
        const res = await api.get('/dictionaries/resources', { params });
        setSearchResults(res.data || []);
      } else {
        params.q = query;
        const res = await api.get('/dictionaries/resources/search', { params });
        setSearchResults(res.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLangLoading(false);
    }
  };

  const handleFilterTypeChange = async (newFilter) => {
    setResourceTypeFilter(newFilter);
    setIsLangLoading(true);
    try {
      const countryCode = data?.doc?.country_code || data?.doc?.country || 'GE';
      const typeCode = newFilter === 'labor' ? '10.100.' : (newFilter === 'machine' ? '10.120.' : (newFilter === 'material' ? '10.130.' : (newFilter === 'nonlabor' ? '10.140.' : '')));
      const params = { country: countryCode };
      if (typeCode) params.type = typeCode;
      
      let endpoint = '/dictionaries/resources';
      if (resourceSearchQuery.trim().length >= 2) {
        endpoint = '/dictionaries/resources/search';
        params.q = resourceSearchQuery;
      }
      
      const res = await api.get(endpoint, { params });
      setSearchResults(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLangLoading(false);
    }
  };

  const handleInstantAddResource = async (res) => {
    const workId = selectedTargetWorkId || activeWorkId || (data?.works?.length > 0 ? data.works[0].id : null);
    if (!workId) {
      alert("Пожалуйста, выберите конкретную работу, в которую нужно добавить ресурс.");
      return;
    }

    const isDuplicate = data?.resources?.some(r => r.work_id === workId && r.resource_id === res.id);
    if (isDuplicate) {
      alert("Этот ресурс уже добавлен в данную работу!");
      return;
    }

    setIsSaving(true);
    try {
      const price = await fetchResourcePriceFromDb(res.id);
      const normItem = activeWorkNorms.find(n => n.resource_id === res.id);

      if (!normItem) {
        // No norm! Open the input dialog
        setEditingResource({
          id: 'temp_res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          doc_id: docId,
          work_id: workId,
          resource_id: res.id,
          price: price,
          source: 'manual',
          est_resources: {
            ...res,
            id: res.id,
            name: res.displayName || res.name
          }
        });
        setFormData({ norm: '', quantity: '' });
        setModalType('add-resource-values');
        return;
      }

      const work = data?.works?.find(w => w.id === workId);
      const norm = parseFloat(normItem.norm || 0);
      const quantity = parseFloat((norm * (work?.volume || 0)).toFixed(3));
      const amount = quantity * price;

      const newRes = {
        id: 'temp_res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        doc_id: docId,
        work_id: workId,
        resource_id: res.id,
        norm: norm,
        quantity: quantity,
        price: price,
        amount: amount,
        source: 'manual',
        is_excluded: false,
        est_resources: {
          ...res,
          id: res.id,
          name: res.displayName || res.name
        }
      };

      setData(prev => {
        const updatedResources = [...(prev.resources || []), newRes];
        const updatedWorks = (prev.works || []).map(w => {
          if (w.id === workId) {
            const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
            const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
            return { ...w, amount: newAmount };
          }
          return w;
        });
        return {
          ...prev,
          works: updatedWorks,
          resources: updatedResources
        };
      });
    } catch (err) {
      alert('Ошибка при добавлении ресурса: ' + (err.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTargetWorkChange = async (workId) => {
    setSelectedTargetWorkId(workId);
    const work = data?.works?.find(w => w.id === workId);
    if (work?.work_id) {
      try {
        const selectedRegion = regions.find(r => r.id === data?.doc?.region_id);
        const countryCode = selectedRegion?.dic_countries?.code || selectedRegion?.country_code || data?.doc?.country_code || data?.doc?.country || 'GE';
        const normsRes = await api.get(`/estimates/norms/${work.work_id}?country_code=${countryCode}`);
        const norms = normsRes.data || [];
        setActiveWorkNorms(norms);
      } catch (err) {
        console.warn('[WARN] Не удалось загрузить нормативы:', err);
      }
    } else {
      setActiveWorkNorms([]);
    }
  };

  const handleNormChange = (val, workVolume) => {
    const norm = parseFloat(val);
    const quantity = isNaN(norm) ? '' : (norm * workVolume).toFixed(3);
    setFormData({ ...formData, norm: val, quantity: quantity });
  };

  const handleQuantityChange = (val, workVolume) => {
    const quantity = parseFloat(val);
    const norm = isNaN(quantity) || workVolume === 0 ? '' : (quantity / workVolume).toFixed(6);
    setFormData({ ...formData, quantity: val, norm: norm });
  };

  const handleEditVolume = (work) => {
    setFormData({ volume: work.volume, factVolume: work.fact_volume != null ? work.fact_volume : (work.volume ?? ''), workId: work.id });
    setModalType('edit-volume');
  };

  const submitEditVolume = () => {
    if (!formData.workId) return;

    if (isActual) {
      const newFactVolume = formData.factVolume !== '' && formData.factVolume != null ? parseFloat(formData.factVolume) : null;

      setData(prev => {
        const updatedResources = prev.resources.map(r => {
          if (r.work_id === formData.workId) {
            const norm = r.fact_norm != null ? r.fact_norm : r.norm;
            const price = r.fact_price != null ? r.fact_price : r.price;
            const newFactQty = newFactVolume != null ? Number(norm || 0) * newFactVolume : null;
            const newFactAmount = newFactQty != null ? newFactQty * Number(price || 0) : null;
            return { ...r, fact_quantity: newFactQty, fact_amount: newFactAmount };
          }
          return r;
        });

        const updatedWorks = prev.works.map(w => {
          if (w.id === formData.workId) {
            const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
            const newFactAmount = activeRes.reduce((sum, x) => sum + Number(x.fact_amount || 0), 0);
            return { ...w, fact_volume: newFactVolume, fact_amount: newFactAmount };
          }
          return w;
        });

        return { ...prev, works: updatedWorks, resources: updatedResources };
      });

      setModalType(null);
      setFormData({});
      return;
    }

    if (!formData.volume) return;
    const newVolume = parseFloat(formData.volume);

    setData(prev => {
      const updatedWorks = prev.works.map(w => w.id === formData.workId ? { ...w, volume: newVolume } : w);
      const updatedResources = prev.resources.map(r => {
        if (r.work_id === formData.workId) {
          const newQty = r.norm * newVolume;
          return { ...r, quantity: newQty, amount: newQty * r.price };
        }
        return r;
      });

      const finalWorks = updatedWorks.map(w => {
        if (w.id === formData.workId) {
          const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
          const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
          return { ...w, amount: newAmount };
        }
        return w;
      });

      return { ...prev, works: finalWorks, resources: updatedResources };
    });

    setModalType(null);
    setFormData({});
  };

  const handleEditResource = (res) => {
    setEditingResource(res);
    const currentPrice = lookupResourcePrice(resourcePrices, res.resource_id) || Number(res.price) || 0;
    setFormData({
      norm: res.norm,
      quantity: res.quantity,
      price: currentPrice,
      factNorm: res.fact_norm ?? res.norm ?? '',
      factQuantity: res.fact_quantity ?? res.quantity ?? '',
      factPrice: res.fact_price ?? currentPrice ?? '',
      factAmount: res.fact_amount ?? ''
    });
    setModalType('edit-resource');
  };

  const submitEditResource = async () => {
    if (!editingResource) return;

    if (isActual) {
      const factNorm = formData.factNorm !== '' && formData.factNorm != null ? parseFloat(formData.factNorm) : null;
      const factQuantity = formData.factQuantity !== '' && formData.factQuantity != null ? parseFloat(formData.factQuantity) : null;
      const factPrice = formData.factPrice !== '' && formData.factPrice != null ? parseFloat(formData.factPrice) : null;
      const factAmount = factQuantity != null && factPrice != null ? factQuantity * factPrice : null;

      setData(prev => {
        const updatedResources = prev.resources.map(r =>
          r.id === editingResource.id ? { ...r, fact_norm: factNorm, fact_quantity: factQuantity, fact_price: factPrice, fact_amount: factAmount } : r
        );
        const updatedWorks = prev.works.map(w => {
          if (w.id === editingResource.work_id) {
            const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
            const newFactAmount = activeRes.reduce((sum, x) => sum + Number(x.fact_amount || 0), 0);
            return { ...w, fact_amount: newFactAmount };
          }
          return w;
        });
        return { ...prev, works: updatedWorks, resources: updatedResources };
      });

      setModalType(null);
      setEditingResource(null);
      setFormData({});
      return;
    }

    const norm = parseFloat(formData.norm || 0);
    const quantity = parseFloat(formData.quantity || 0);
    const price = parseFloat(formData.price);
    const finalPrice = isNaN(price) || price < 0
      ? (lookupResourcePrice(resourcePrices, editingResource.resource_id) || Number(editingResource.price) || 0)
      : price;

    if (!isNaN(price) && price >= 0) {
      try {
        setIsSaving(true);
        await api.put(`/dictionaries/prices/${editingResource.resource_id}`, {
          price: finalPrice,
          region_id: data?.doc?.region_id || null,
          currency_id: data?.doc?.currency_id || null,
        });
        setResourcePrices(prev => ({ ...prev, [String(editingResource.resource_id)]: finalPrice }));
      } catch (err) {
        alert(err.response?.data?.error || 'Не удалось сохранить цену');
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    const amount = quantity * finalPrice;

    setData(prev => {
      const updatedResources = prev.resources.map(r => {
        if (r.id === editingResource.id) {
          return { ...r, norm, quantity, price: finalPrice, amount };
        }
        return r;
      });

      const updatedWorks = prev.works.map(w => {
        if (w.id === editingResource.work_id) {
          const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
          const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
          return { ...w, amount: newAmount };
        }
        return w;
      });

      return { ...prev, works: updatedWorks, resources: updatedResources };
    });

    setModalType(null);
    setEditingResource(null);
    setFormData({});
  };

  const submitAddResourceValues = () => {
    if (!editingResource) return;
    const norm = parseFloat(formData.norm || 0);
    const quantity = parseFloat(formData.quantity || 0);
    if (isNaN(norm) && isNaN(quantity)) {
      alert("Пожалуйста, введите норму или количество.");
      return;
    }
    const price = editingResource.price || 0;
    const amount = quantity * price;

    const newRes = {
      ...editingResource,
      norm: norm || 0,
      quantity: quantity || 0,
      amount: amount || 0,
      is_excluded: false
    };

    setData(prev => {
      const updatedResources = [...(prev.resources || []), newRes];
      const updatedWorks = (prev.works || []).map(w => {
        if (w.id === editingResource.work_id) {
          const activeRes = updatedResources.filter(x => x.work_id === w.id && !x.is_excluded);
          const newAmount = activeRes.reduce((sum, x) => sum + Number(x.amount || 0), 0);
          return { ...w, amount: newAmount };
        }
        return w;
      });
      return {
        ...prev,
        works: updatedWorks,
        resources: updatedResources
      };
    });

    setModalType(null);
    setEditingResource(null);
    setFormData({});
  };

  const handleRenameEstimate = () => {
    if (!formData.project_id) return;
    setData(prev => ({
      ...prev,
      doc: { 
        ...prev.doc, 
        project_id: formData.project_id,
        region_id: formData.region_id || null,
        currency_id: formData.currency_id || null
      }
    }));
    setModalType(null);
    setFormData({});
  };

  const handleApplyTemplate = async (codes) => {
    const codesToApply = codes || selectedTemplateCodes;
    if (!codesToApply || codesToApply.length === 0) {
      alert("Пожалуйста, выберите хотя бы один раздел шаблона.");
      return;
    }
    if (!window.confirm("Вы уверены, что хотите добавить выбранные разделы WBS в проект? Статус сметы изменится на Черновик.")) return;
    setIsSaving(true);
    try {
      const response = await api.post(`/estimates/${activeDocId}/apply-template`, {
        lang: resourceLanguage,
        selectedCodes: codesToApply
      });
      alert(response.data?.message || 'Шаблон успешно добавлен!');
      setModalType(null);
      setSelectedTemplateCodes([]);
      await fetchData();
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Ошибка при добавлении шаблона";
      alert(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };
 
  const openSubmitReviewModal = async () => {
    setSelectedApproverId('');
    setSubmitReviewComment('');
    setModalType('submit-review');
    setIsLoadingApprovers(true);
    try {
      const targetRegionId = data?.doc?.region_id || data?.doc?.projects?.region_id || '';
      const res = await api.get(`/estimates/financial-directors?region_id=${targetRegionId}`);
      setFinancialDirectors(res.data || []);
    } catch (err) {
      console.error('[FINANCIAL DIRECTORS FETCH ERROR]:', err);
      setFinancialDirectors([]);
    } finally {
      setIsLoadingApprovers(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedApproverId) {
      alert(t.estEdSelectApproverRequired || 'Пожалуйста, выберите утверждающего (Финансового директора).');
      return;
    }
    setIsSaving(true);
    try {
      const res = await api.post(`/estimates/${activeDocId}/submit-review`, {
        approverId: selectedApproverId,
        comment: submitReviewComment || null
      });
      const approver = res.data?.approver;
      alert(`${res.data.message}${approver ? ` (утверждающий: ${approver.first_name || ''} ${approver.last_name || ''})`.trim() : ''}`);
      setModalType(null);
      fetchData();
    } catch (e) {
      alert(e.response?.data?.error || t.estEdCreatePlanError || 'Не удалось отправить плановую версию на утверждение. Повторите попытку позже.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivatePlan = async () => {
    if (!window.confirm(t.estEdDeactivatePlanConfirm || 'Вы действительно хотите деактивировать плановую версию сметы? После деактивации версия станет недоступна для дальнейшего использования')) return;
    setIsSaving(true);
    try {
      const res = await api.post(`/estimates/${activeDocId}/deactivate-plan`);
      alert(res.data.message);
      fetchData();
    } catch (e) {
      alert(e.response?.data?.error || 'Не удалось деактивировать плановую версию. Повторите попытку позже.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateActual = async () => {
    if (!window.confirm(t.estEdCreateActualConfirm || 'Создать фактическую версию сметы на основании этой утверждённой плановой версии?')) return;
    setIsCreatingActual(true);
    try {
      const res = await api.post(`/estimates/${activeDocId}/create-actual`);
      alert(res.data.message);
      if (res.data.actualDocId) {
        setActiveDocId(res.data.actualDocId);
      }
    } catch (e) {
      alert(e.response?.data?.error || 'Не удалось создать фактическую версию сметы. Повторите попытку позже.');
    } finally {
      setIsCreatingActual(false);
    }
  };

  const approveEstimate = async () => {
    if (!window.confirm(t.estEdConfirmApprove || "Утвердить смету?")) return;
    setIsSaving(true);
    try {
      await api.post('/estimates/approve', { doc_id: activeDocId });
      fetchData();
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Ошибка при утверждении";
      alert(errorMsg);
    } finally { setIsSaving(false); }
  };

  // --- ПАКЕТНОЕ СОХРАНЕНИЕ ---
  const handleBulkSave = async () => {
    if (!data) return;
    setIsSaving(true);
    try {
      await api.post(`/estimates/${docId}/save`, {
        wbs: data.wbs,
        works: data.works,
        resources: data.resources,
        coefficients: data.coefficients,
        project_id: data.doc?.project_id,
        region_id: data.doc?.region_id || null,
        currency_id: data.doc?.currency_id || null
      });
      await fetchData();
      alert(t.schedSaved || 'Изменения сохранены!');
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Ошибка при сохранении";
      alert(errorMsg);
    } finally { setIsSaving(false); }
  };

  // --- СБРОС ИЗМЕНЕНИЙ ---
  const handleResetChanges = () => {
    const resetConfirmMsg = currentLang === 'en' ? 'Are you sure you want to reset all unsaved changes?' : currentLang === 'ka' ? 'დარწმუნებული ხართ, რომ გსურთ ყველა შეუნახავი ცვლილების გაუქმება?' : currentLang === 'az' ? 'Yadda saxlanılmamış bütün dəyişiklikləri sıfırlamaq istədiyinizə əminsiniz?' : 'Вы уверены, что хотите сбросить все несохраненные изменения?';
    if (!window.confirm(resetConfirmMsg)) return;
    fetchData();
  };

  if (loading) return <div style={{ padding: '40px', fontWeight: '700', color: '#3b82f6' }}>{t.loadingWbs || 'Загрузка WBS...'}</div>;

  const docStatus = data?.doc?.status;
  const isPlan = docStatus && docStatus.startsWith('planned_');
  const isActual = data?.doc?.estimate_type === 'actual';
  const isReadOnlyDoc = isReadOnly || data?.doc?.is_readonly;
  const hasActualEstimate = !!data?.doc?.has_actual_estimate;
  // Плановую смету можно редактировать, пока по ней не создана фактическая версия —
  // после этого плановая блокируется (isApproved), чтобы не разъезжаться с уже созданным фактом.
  const isApproved = docStatus === 'approved' || isReadOnlyDoc || (isPlan && hasActualEstimate);
  const isDocApproved = docStatus === 'approved';
  const canEdit = (userRole === 'admin' || userRole === 'estimator') && !isApproved && !isReadOnlyDoc;

  const PLAN_STATUS_LABELS = {
    planned_formed: t.estEdStatusFormed || 'Сформирована',
    planned_review: t.estEdStatusReview || 'На утверждении',
    planned_approved: t.estEdStatusApproved || 'Утверждена',
    planned_rejected: t.estEdStatusRejected || 'Отклонена',
    planned_inactive: t.estEdStatusInactive || 'Деактивирована'
  };
  const getPlanStatusLabel = (status) => PLAN_STATUS_LABELS[status] || status;

  const PLAN_STATUS_COLORS = {
    planned_formed: { bg: '#eff6ff', color: '#2563eb' },
    planned_review: { bg: '#fff7ed', color: '#ea580c' },
    planned_approved: { bg: '#ecfdf5', color: '#16a34a' },
    planned_rejected: { bg: '#fef2f2', color: '#dc2626' },
    planned_inactive: { bg: '#f8fafc', color: '#94a3b8' }
  };
  const getPlanStatusColor = (status) => PLAN_STATUS_COLORS[status] || { bg: '#f1f5f9', color: '#64748b' };
  // BR-04: утверждать/отклонять может только назначенный утверждающий (plan_approver_id) или admin
  const canApprovePlan = userRole === 'admin' || (userRole === 'financial_director' && !!currentUserId && data?.doc?.plan_approver_id === currentUserId);
  // BR-01/02 (US-06-004): деактивировать может сметчик/admin, только в статусах "Сформирована"/"Утверждена"
  const canDeactivatePlan = (userRole === 'admin' || userRole === 'estimator') && ['planned_formed', 'planned_approved'].includes(docStatus);
  // US-06-005: фактическую версию можно создать только из утверждённой плановой, и только один раз
  const canCreateActual = (userRole === 'admin' || userRole === 'estimator') && docStatus === 'planned_approved' && !data?.doc?.has_actual_estimate;
  const hasPlanActions = docStatus === 'planned_formed' || (docStatus === 'planned_review' && canApprovePlan) || docStatus === 'planned_rejected' || canDeactivatePlan || canCreateActual;

  const ACTUAL_STATUS_LABELS = {
    actual_formed: t.estEdStatusFormed || 'Сформирована'
  };
  const getActualStatusLabel = (status) => ACTUAL_STATUS_LABELS[status] || status;
  const ACTUAL_STATUS_COLORS = {
    actual_formed: { bg: '#fff7ed', color: '#c2410c' }
  };
  const getActualStatusColor = (status) => ACTUAL_STATUS_COLORS[status] || { bg: '#f1f5f9', color: '#64748b' };

  // Сумма план = всегда считается из актуальных ресурсов (не из кэшированного work.amount)
  const getWorkSum = (work) => {
    if (work.is_excluded) return 0;
    const fromResources = data?.resources?.filter(r => r.work_id === work.id && !r.is_excluded).reduce((sum, r) => sum + Number(r.amount || 0), 0) || 0;
    if (fromResources > 0) return fromResources;
    // fallback на work.amount если ресурсов ещё нет в стейте
    return Number(work.amount || 0);
  };

  // US-06-005: фактическая сумма работы = сумма факт-стоимостей её ресурсов
  const getWorkFactSum = (work) => {
    if (work.is_excluded) return null;
    const factResources = (data?.resources?.filter(r => r.work_id === work.id && !r.is_excluded && r.fact_amount != null) || []);
    if (factResources.length === 0) return work.fact_amount != null ? Number(work.fact_amount) : null;
    return factResources.reduce((sum, r) => sum + Number(r.fact_amount || 0), 0);
  };

  const getWorkSumOriginal = (work) => {
    const fromResources = data?.resources?.filter(r => r.work_id === work.id).reduce((sum, r) => sum + Number(r.amount || 0), 0) || 0;
    if (fromResources > 0) return fromResources;
    return Number(work.amount || 0);
  };

  // --- РАСЧЕТЫ ДЛЯ ДАШБОРДА ---
  // В фактической версии итоги считаются по факт-суммам (независимо от плановой сметы)
  const directCosts = data?.works?.filter(w => !w.is_excluded).reduce((sum, work) => {
    if (isActual) {
      const factSum = getWorkFactSum(work);
      return sum + (factSum != null ? factSum : getWorkSum(work));
    }
    return sum + getWorkSum(work);
  }, 0) || 0;
  const coefficientsTotal = data?.coefficients?.reduce((sum, c) => sum + (directCosts * Number(c.value_percent) / 100), 0) || 0;
  const grandTotal = directCosts + coefficientsTotal;

  // Общая маржа и рентабельность (маржа = 25% наценка от себестоимости)
  const MARGIN_MULTIPLIER = 1.25; // 25% маржа от себестоимости
  const totalRevenue = directCosts * MARGIN_MULTIPLIER + coefficientsTotal; // Доход = себестоимость * 1.25 + коэффициенты
  const totalMargin = totalRevenue - directCosts; // Маржа = доход - расход
  const totalProfitability = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0; // Рентабельность

  // --- Определяем ресурсы для показа ---
  const getVisibleResources = () => {
    const worksList = (data?.works || []).filter(w => showExcludedWorks || showExcludedResources || !w.is_excluded);

    if (showAllResources) {
      // Все ресурсы сметы, сгруппированные по работам
      return worksList.map(work => {
        const resources = (data?.resources?.filter(r => r.work_id === work.id) || [])
          .filter(r => {
            if (!showExcludedResources && r.is_excluded) return false;
            if (resourceFilterQuery) {
              const q = resourceFilterQuery.toLowerCase();
              return r.est_resources?.name?.toLowerCase().includes(q) || r.est_resources?.code?.toLowerCase().includes(q);
            }
            return true;
          });
        return { work, resources };
      }).filter(group => group.resources.length > 0) || [];
    }
    
    if (activeWorkId) {
      const work = data?.works?.find(w => w.id === activeWorkId);
      if (!work) return [];
      const resources = (data?.resources?.filter(r => r.work_id === activeWorkId) || [])
        .filter(r => {
          if (!showExcludedResources && r.is_excluded) return false;
          if (resourceFilterQuery) {
            const q = resourceFilterQuery.toLowerCase();
            return r.est_resources?.name?.toLowerCase().includes(q) || r.est_resources?.code?.toLowerCase().includes(q);
          }
          return true;
        });
      return [{ work, resources }];
    }
    return [];
  };

  const visibleResourceGroups = getVisibleResources();
  const showResourcesPanel = showAllResources || activeWorkId;

  const getBreadcrumbs = () => {
    const translateDocField = (val) => {
      if (!val) return '';
      const found = data?.wbs?.find(w => 
        w.name === val ||
        w.name_ru === val ||
        w.name_en === val ||
        w.name_ka === val ||
        w.name_ge === val ||
        w.name_az === val ||
        w.name_tr === val
      );
      if (found) {
        return found[`name_${currentLang}`] || found.name_ge || found.name_ka || found.name;
      }
      return val;
    };

    if (data?.doc) {
      const projName = data.doc.project_id || (t.estWizardStepProject || 'Проект');
      const objName = data.doc.project_objects?.name || (t.estWizardStepObject || 'Объект');
      const parts = [t.estPageTitle || 'Сметы', projName, objName];
      if (data.doc.zone) parts.push(translateDocField(data.doc.zone));
      if (data.doc.phase) parts.push(translateDocField(data.doc.phase));
      if (data.doc.discipline) parts.push(translateDocField(data.doc.discipline));
      return parts;
    }
    return [t.estPageTitle || 'Сметы', t.estWizardTitle || 'Смета'];
  };

  return (
    <div className="animate-fade-in" style={{ width: '100%', height: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* 1. TOP HEADER WITH AUTO-COLLAPSE ON HOVER */}
      <div 
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
        style={{
          background: 'white',
          padding: isHeaderHovered ? '15px 25px' : '8px 20px',
          borderBottom: '2px solid #eef2f6',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          height: isHeaderHovered ? '110px' : '38px',
          boxSizing: 'border-box',
          boxShadow: isHeaderHovered ? '0 10px 15px -3px rgba(0,0,0,0.05)' : 'none',
          zIndex: 10
        }}
      >
        {/* COMPACT VIEW (ALWAYS VISIBLE) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', height: '24px' }}>
          {/* Breadcrumbs / Project Info with Back Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: '#64748b', fontWeight: '700' }}>
            <button 
              onClick={onBack} 
              style={{ 
                background: '#f1f5f9', 
                border: 'none', 
                padding: '3px 6px', 
                borderRadius: '6px', 
                cursor: 'pointer', 
                color: '#64748b', 
                display: 'flex', 
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
              title={t.btnBack || 'Назад'}
            >
              <ArrowLeft size={12} />
            </button>
            {getBreadcrumbs().map((part, pIdx, arr) => (
              <React.Fragment key={pIdx}>
                <span style={{ color: pIdx === arr.length - 1 ? '#0f172a' : '#64748b' }}>{part}</span>
                {pIdx < arr.length - 1 && <span style={{ color: '#cbd5e1', fontWeight: '500' }}>&gt;</span>}
              </React.Fragment>
            ))}
          </div>

          {/* Quick Language & Save Status Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {!isApproved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {autoSaveStatus === 'pending' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>
                    <Cloud size={12} />
                    {t.schedWaiting || 'Ожидание...'}
                  </div>
                )}
                {autoSaveStatus === 'saving' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#3b82f6', fontWeight: '700' }}>
                    <RefreshCw size={12} className="animate-spin" />
                    {t.schedSaving || 'Сохранение...'}
                  </div>
                )}
                {autoSaveStatus === 'saved' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#10b981', fontWeight: '700' }}>
                    <CheckCircle2 size={12} color="#10b981" />
                    {t.schedSaved || 'Сохранено'}
                  </div>
                )}
                {autoSaveStatus === 'error' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#f87171', fontWeight: '700' }}>
                    <AlertTriangle size={12} />
                    {t.schedError || 'Ошибка'}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>{t.estEdLanguageLabel || 'Язык:'}</span>
              <select
                style={{ padding: '2px 6px', borderRadius: '6px', border: '1.5px solid #cbd5e1', background: 'white', fontWeight: 'bold', fontSize: '11px', outline: 'none', cursor: 'pointer' }}
                value={resourceLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                <option value="ru">RU</option>
                <option value="en">EN</option>
                <option value="ka">KA</option>
                <option value="az">AZ</option>
                <option value="tr">TR</option>
              </select>
            </div>
          </div>
        </div>

        {/* EXPANDED VIEW (VISIBLE ONLY ON HOVER) */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          width: '100%', 
          marginTop: '12px',
          opacity: isHeaderHovered ? 1 : 0,
          visibility: isHeaderHovered ? 'visible' : 'hidden',
          transition: 'opacity 0.25s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', padding: '6px', borderRadius: '8px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={16} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '950', color: '#1e293b' }}>{data?.doc?.project_id}</h1>
              {!isApproved && (
                <Edit
                  size={14}
                  style={{ cursor: 'pointer', color: '#94a3b8' }}
                  onClick={() => {
                    setFormData({ 
                      project_id: data?.doc?.project_id,
                      region_id: data?.doc?.region_id || '',
                      currency_id: data?.doc?.currency_id || ''
                    });
                    setModalType('rename-doc');
                  }}
                />
              )}
            </div>

            {isPlan ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '2px' }}>
                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '8px', fontWeight: '700', background: '#e2e8f0', color: '#475569' }}>
                  {t.estEdPlanVersionLabel || 'Плановая ver.'} {data?.doc?.plan_version}
                </span>
                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '8px', fontWeight: '700', background: getPlanStatusColor(docStatus).bg, color: getPlanStatusColor(docStatus).color }}>
                  {getPlanStatusLabel(docStatus)}
                </span>
              </div>
            ) : isActual ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '14px', padding: '2px' }}>
                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '8px', fontWeight: '800', background: '#ea580c', color: 'white' }}>
                  {t.estEdActualVersionLabel || 'Фактическая версия'}
                </span>
                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '8px', fontWeight: '700', background: getActualStatusColor(docStatus).bg, color: getActualStatusColor(docStatus).color }}>
                  {getActualStatusLabel(docStatus)}
                </span>
              </div>
            ) : (
              <span className={`badge ${data?.doc?.status === 'approved' ? 'badge-approved' : 'badge-draft'}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                {data?.doc?.status === 'approved' ? (t.estPageStatusApproved || 'Утверждено') : (t.estEdDraftLabel || 'Черновик')}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Кнопки управления плановой версией в шапке */}
            {isPlan && hasPlanActions && (
              <>

                {docStatus === 'planned_formed' && (
                  <button
                    className="btn-primary"
                    disabled={isSaving}
                    style={{ background: '#10b981', color: 'white', padding: '5px 12px', fontWeight: '700', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: isSaving ? 'not-allowed' : 'pointer' }}
                    onClick={openSubmitReviewModal}
                  >
                    {isSaving ? 'Отправка...' : (t.estEdSubmitReviewBtn || 'Отправить на утверждение')}
                  </button>
                )}

                {canDeactivatePlan && (
                  <button
                    className="btn-primary"
                    disabled={!!data?.doc?.has_actual_estimate}
                    title={data?.doc?.has_actual_estimate ? (t.estEdDeactivatePlanBlocked || 'Деактивация невозможна. На основании данной плановой версии уже создана фактическая смета') : ''}
                    style={{
                      background: data?.doc?.has_actual_estimate ? '#f1f5f9' : 'white',
                      border: '1.5px solid #94a3b8',
                      color: data?.doc?.has_actual_estimate ? '#cbd5e1' : '#475569',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: data?.doc?.has_actual_estimate ? 'not-allowed' : 'pointer'
                    }}
                    onClick={handleDeactivatePlan}
                  >
                    {t.estEdDeactivatePlanBtn || 'Деактивировать'}
                  </button>
                )}

                {canCreateActual && (
                  <button
                    className="btn-primary"
                    disabled={isCreatingActual}
                    style={{
                      background: isCreatingActual ? '#94a3b8' : '#ea580c',
                      color: 'white',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '700',
                      border: 'none',
                      cursor: isCreatingActual ? 'not-allowed' : 'pointer'
                    }}
                    onClick={handleCreateActual}
                  >
                    {isCreatingActual ? (t.estEdCreateActualCreating || 'Создание...') : (t.estEdCreateActualBtn || 'Создать фактическую версию')}
                  </button>
                )}

                {docStatus === 'planned_review' && canApprovePlan && (
                  <>
                    <button
                      className="btn-primary"
                      style={{ background: '#10b981', color: 'white', padding: '5px 12px', fontWeight: '700', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      onClick={async () => {
                        if (!window.confirm(t.estEdApprovePlanConfirm || 'Утвердить эту плановую версию сметы? Все предыдущие утвержденные планы этого черновика будут деактивированы.')) return;
                        try {
                          const res = await api.post(`/estimates/${activeDocId}/approve-plan`);
                          alert(res.data.message);
                          fetchData();
                        } catch (e) {
                          alert(e.response?.data?.error || e.message);
                        }
                      }}
                    >
                      <CheckCircle2 size={12} /> {t.estEdApproveBtn || 'Утвердить'}
                    </button>
                    <button
                      className="btn-primary"
                      style={{ background: '#dc2626', color: 'white', padding: '5px 12px', fontWeight: '700', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                      onClick={async () => {
                        const reason = window.prompt(t.estEdRejectPlanPrompt || 'Укажите причину отклонения:');
                        if (reason === null) return;
                        if (!reason.trim()) {
                          alert(t.estEdRejectReasonRequired || 'Укажите причину отклонения');
                          return;
                        }
                        try {
                          const res = await api.post(`/estimates/${activeDocId}/reject-plan`, { comment: reason.trim() });
                          alert(res.data.message);
                          fetchData();
                        } catch (e) {
                          alert(e.response?.data?.error || e.message);
                        }
                      }}
                    >
                      {t.estEdRejectPlanBtn || 'Отклонить'}
                    </button>
                  </>
                )}

                {docStatus === 'planned_rejected' && (
                  <span style={{ fontSize: '12px', color: '#991b1b', fontWeight: '700', background: '#fee2e2', padding: '4px 10px', borderRadius: '6px' }}>
                    {(t.estEdBannerRejected || 'Причина отклонения:')} {data?.doc?.rejection_reason || (t.estEdBannerRejectedNoReason || 'Не указана')}
                  </span>
                )}
              </>
            )}

            {onOpenScheduling && !isPlan && !isActual && (
              <button
                onClick={() => onOpenScheduling({
                  projectId: data?.doc?.project_uuid || data?.doc?.projects?.id || null,
                  objectId: data?.doc?.object_id || null,
                  estimateId: docId
                })}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '6px', background: '#16a34a', color: 'white',
                  border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s'
                }}
                title={t.tabScheduling || 'Календарное планирование'}
              >
                <Calendar size={14} />
              </button>
            )}

            {!isDocApproved && !isPlan && !isActual && (
              <>
                {showPlanVersioning && (
                  <button
                    className="btn-primary"
                    style={{ background: 'white', border: '1.5px solid #64748b', color: '#64748b', padding: '4px 8px', cursor: 'pointer', display: 'inline-flex', borderRadius: '6px', fontWeight: '700', fontSize: '12px' }}
                    onClick={async () => {
                      setShowHistoryModal(true);
                      setIsLoadingHistory(true);
                      try {
                        const res = await api.get(`/estimates/${activeDocId}/history`);
                        setHistoryLogs(res.data || []);
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsLoadingHistory(false);
                      }
                    }}
                  >
                    {t.estEdHistoryBtn || 'История'}
                  </button>
                )}
                {!isReadOnlyDoc && (
                  <button className="btn-primary" style={{ background: 'white', border: '1.5px solid #3b82f6', color: '#3b82f6', padding: '4px 8px', cursor: 'pointer', display: 'inline-flex', borderRadius: '6px', fontWeight: '700', fontSize: '12px', alignItems: 'center', gap: '4px' }} onClick={() => setModalType('coeff')}>
                    <Percent size={12} /> {t.estEdCoeffsBtn || 'Коэффициенты'}
                  </button>
                )}
                {showPlanVersioning && (
                  <button
                    className="btn-primary"
                    style={{
                      background: (versions.some(v => v.estimate_type === 'planned' && ['planned_formed', 'planned_review', 'planned_approved'].includes(v.status)) || isCreatingPlan) ? '#94a3b8' : '#8b5cf6',
                      color: 'white',
                      padding: '5px 12px',
                      fontWeight: '700',
                      fontSize: '12px',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: (versions.some(v => v.estimate_type === 'planned' && ['planned_formed', 'planned_review', 'planned_approved'].includes(v.status)) || isCreatingPlan) ? 'not-allowed' : 'pointer'
                    }}
                    disabled={versions.some(v => v.estimate_type === 'planned' && ['planned_formed', 'planned_review', 'planned_approved'].includes(v.status)) || isCreatingPlan}
                    onClick={async () => {
                      if (!window.confirm(t.estEdCreatePlanConfirm || "Создать плановую версию сметы?")) return;
                      setIsCreatingPlan(true);
                      try {
                        const res = await api.post(`/estimates/${activeDocId}/create-plan`);
                        alert(res.data.message);
                        if (res.data.planDocId) {
                          setActiveDocId(res.data.planDocId);
                        }
                      } catch (e) {
                        alert(e.response?.data?.error || 'Не удалось создать плановую версию.');
                      } finally {
                        setIsCreatingPlan(false);
                      }
                    }}
                  >
                    {isCreatingPlan ? 'Создание...' : (t.estEdCreatePlanBtn || 'Создать плановую версию')}
                  </button>
                )}
              </>
            )}

            {isDocApproved && (
              <>
                <button
                  className="btn-primary"
                  style={{ background: '#8b5cf6', padding: '5px 12px', fontWeight: '700', border: 'none', borderRadius: '6px', fontSize: '12px', color: 'white', cursor: 'pointer' }}
                  onClick={async () => {
                    const name = window.prompt('Название новой версии:', `${data?.doc?.project_id} (Версия)`);
                    if (!name) return;
                    setIsSaving(true);
                    try {
                      await api.post(`/estimates/${activeDocId}/create-version`, { version_name: name });
                      alert('Новая версия создана!');
                    } catch (err) {
                      alert('Ошибка: ' + err.message);
                    } finally { setIsSaving(false); }
                  }}
                >
                  Создать версию
                </button>
                <button
                  className="btn-secondary"
                  style={{ background: '#f1f5f9', border: '1.5px solid #64748b', color: '#64748b', fontWeight: '700', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                  onClick={() => window.print()}
                >
                  Печать
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 2. MAIN CONTENT AREA */}
      <div style={{ flex: 1, padding: '10px 16px 16px 50px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'hidden', width: '100%', boxSizing: 'border-box', minHeight: 0 }}>

        {/* Переключатель шапки с итогами — скрыта по умолчанию, открывается по клику */}
        <button
          className="btn-primary"
          onClick={() => setShowTotalsDashboard(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            background: 'white', border: '2px solid #3b82f6', color: '#3b82f6',
            padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '700',
            userSelect: 'none', width: 'fit-content', transition: 'all 0.2s'
          }}
        >
          {showTotalsDashboard ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {showTotalsDashboard ? (t.estEdHideTotals || 'Скрыть') : (t.estEdShowTotals || 'Показать')}
        </button>

        {/* TOTALS DASHBOARD AT THE TOP */}
        {showTotalsDashboard && (
        <div className="premium-card" style={{ padding: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', gap: '20px', flexWrap: 'wrap' }}>


          {/* Центральная часть — маржа и рентабельность */}
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
		
	     {/* Расходы */}
            <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', padding: '12px 18px', borderRadius: '14px', textAlign: 'center', minWidth: '160px' }}>
              <div style={{ fontSize: '10px', color: '#e53e3e', fontWeight: '800', textTransform: 'uppercase', marginBottom: '4px' }}>{t.estExpenses || 'РАСХОДЫ'}</div>
              <div style={{ fontSize: '18px', fontWeight: '900', color: '#9b2c2c' }}>{new Intl.NumberFormat('ru-RU').format(directCosts)} {CURRENCY}</div>
            </div>
            {/* Маржа */}
            <div style={{ background: '#ebf8ff', border: '1px solid #bee3f8', padding: '12px 18px', borderRadius: '14px', textAlign: 'center', minWidth: '160px' }}>
              <div style={{ fontSize: '10px', color: '#3182ce', fontWeight: '800', textTransform: 'uppercase', marginBottom: '4px' }}>{t.estMargin || 'ОБЩАЯ МАРЖА'}</div>
              <div style={{ fontSize: '18px', fontWeight: '900', color: '#2b6cb0' }}>{new Intl.NumberFormat('ru-RU').format(totalMargin)} {CURRENCY}</div>
            </div>
            {/* Рентабельность */}
            <div style={{ background: '#faf5ff', border: '1px solid #e9d8fd', padding: '12px 18px', borderRadius: '14px', textAlign: 'center', minWidth: '160px' }}>
              <div style={{ fontSize: '10px', color: '#805ad5', fontWeight: '800', textTransform: 'uppercase', marginBottom: '4px' }}>{t.estProfitability || 'РЕНТАБЕЛЬНОСТЬ'}</div>
              <div style={{ fontSize: '18px', fontWeight: '900', color: '#553c9a' }}>{totalProfitability.toFixed(1)}%</div>
            </div>
          </div>
            {/* Коэффициенты */}
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <Percent size={16} color="#64748b" />
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>{t.estMarkupsCoeffs || 'Наценки и коэффициенты:'}</span>
    </div>
    {data?.coefficients?.map(c => (
        <div key={c.id} style={{ 
            background: '#f1f5f9', 
            padding: '6px 14px', 
            borderRadius: '20px', 
            fontSize: '13px', 
            fontWeight: '600', 
            color: '#0f172a', 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '8px',
            border: '1px solid #e2e8f0'
        }}>
            <span>{c.name}</span>
            <span style={{ color: '#3b82f6', fontWeight: '800' }}>({c.value_percent}%)</span>
            <span style={{ color: '#10b981', fontWeight: '800' }}>
                +{new Intl.NumberFormat('ru-RU').format(directCosts * c.value_percent / 100)} {CURRENCY}
            </span>
            {!isApproved && (
                <button
                    onClick={() => handleDeleteCoeff(c.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', padding: '0', marginLeft: '4px', display: 'flex', alignItems: 'center' }}
                    title="Удалить коэффициент"
                >
                    <X size={12} />
                </button>
            )}
        </div>
    ))}
    {(!data?.coefficients || data.coefficients.length === 0) && (
        <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>{t.estNoCoeffs || 'Нет добавленных коэффициентов'}</span>
    )}
</div>
          {/* Правая часть — итого (сохраняем как было) */}
          <div style={{ textAlign: 'right', minWidth: '200px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>{t.estEdTotalPayment || 'Себестоимость'}</div>
            <div style={{ fontSize: '42px', fontWeight: '950', color: '#2563eb', lineHeight: 1 }}>{new Intl.NumberFormat('ru-RU').format(grandTotal)} {CURRENCY}</div>
          </div>
        </div>
        )}


        {/* MASTER-DETAIL CONTAINER WITH FLOATING HOVER SIDEBAR & FULL STRETCH TWIN TABLES */}
        <div style={{ position: 'relative', width: '100%', boxSizing: 'border-box', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          
          {/* FLOATING HOVER DRAWER SIDEBAR AT FAR LEFT MARGIN */}
          <div
            onMouseEnter={() => setIsWbsSidebarHovered(true)}
            onMouseLeave={() => setIsWbsSidebarHovered(false)}
            style={{
              position: 'fixed',
              left: '8px',
              top: `${(isHeaderHovered ? 120 : 50) + (showTotalsDashboard ? 95 : 0)}px`,
              width: isWbsSidebarHovered ? '280px' : '36px',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              background: 'white',
              borderRadius: '14px',
              border: '2px solid #cbd5e1',
              boxShadow: isWbsSidebarHovered ? '0 12px 35px rgba(15,23,42,0.25)' : '0 2px 8px rgba(0,0,0,0.08)',
              overflow: 'hidden',
              zIndex: 999,
              display: 'flex',
              flexDirection: 'column',
              height: `calc(100vh - ${((isHeaderHovered ? 120 : 50) + (showTotalsDashboard ? 95 : 0)) + 20}px)`
            }}
          >
            {/* Sidebar Header - УМЕНЬШЕННАЯ ВЫСОТА И УВЕЛИЧЕННАЯ ДЛИНА */}
            <div style={{ 
              background: '#3b82f6', 
              padding: '6px 20px', 
              color: 'white', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '10px', 
              minHeight: '36px', 
              boxSizing: 'border-box', 
              whiteSpace: 'nowrap',
              width: '100%' 
            }}>
              <Folder size={18} color="white" />
              {isWbsSidebarHovered && (
                <span style={{ fontSize: '13px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {currentLang === 'en' ? 'WBS SECTIONS MENU' : currentLang === 'ka' ? 'WBS სექციების მენიუ' : currentLang === 'az' ? 'WBS BÖLMƏLƏR MENYUSU' : 'МЕНЮ РАЗДЕЛОВ WBS'}
                </span>
              )}
            </div>

            {/* Sidebar Content (WBS Tree List) */}
            {isWbsSidebarHovered ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div
                  onClick={() => setSelectedSidebarWbsId(null)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    background: !selectedSidebarWbsId ? '#eff6ff' : 'transparent',
                    color: !selectedSidebarWbsId ? '#2563eb' : '#475569',
                    borderLeft: !selectedSidebarWbsId ? '3px solid #2563eb' : '3px solid transparent'
                  }}
                >
                  🌐 {currentLang === 'en' ? 'All estimate sections' : currentLang === 'ka' ? 'ხარჯთაღრიცხვის ყველა სექცია' : currentLang === 'az' ? 'Smetanın bütün bölmələri' : 'Все разделы сметы'}
                </div>
                 {flattenedSidebarWbs.map((node) => {
                  const isSelected = selectedSidebarWbsId === node.id;
                  const isExcluded = node.is_excluded;
                  const isSub = node.depth > 0;
                  const indent = node.depth * 14;
                  let icon = '⚙️';
                  const lowerType = String(node.type).toLowerCase();
                  if (lowerType === 'project') icon = '📁';
                  else if (lowerType === 'facility/zone' || lowerType === 'zone' || lowerType === 'object') icon = '🏢';
                  else if (lowerType === 'phase') icon = '⏱️';
                  else if (lowerType === 'discipline') icon = '📐';
                  else if (lowerType === 'work package' || lowerType === 'work_package') icon = '📦';
                  else if (lowerType === 'activity group' || lowerType === 'activity_group' || lowerType === 'construct') icon = '🏗️';
                  else if (lowerType === 'subconstruct' || lowerType === 'activity type' || lowerType === 'activity_type') icon = '⚙️';
                  else if (lowerType === 'work' || lowerType === 'activity') icon = '🛠️';

                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedSidebarWbsId(node.id)}
                      style={{
                        padding: `6px 12px 6px ${12 + indent}px`,
                        borderRadius: '8px',
                        fontSize: isSub ? '11px' : '12px',
                        fontWeight: isSelected ? '900' : (isSub ? '600' : '800'),
                        cursor: 'pointer',
                        background: isSelected ? '#eff6ff' : (isSub ? '#ffffff' : '#f8fafc'),
                        color: isSelected ? '#2563eb' : (isExcluded ? '#cbd5e1' : (isSub ? '#475569' : '#0f172a')),
                        borderLeft: isSelected ? '3px solid #2563eb' : (isSub ? '1px dashed #cbd5e1' : '3px solid transparent'),
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginTop: isSub ? '2px' : '6px',
                        opacity: isExcluded ? 0.6 : 1,
                        textDecoration: isExcluded ? 'line-through' : 'none'
                      }}
                    >
                      <span>{isSub ? '↳ ' + icon : icon}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '20px', gap: '15px', color: '#64748b' }}>
                <List size={20} />
                <span style={{ writingMode: 'vertical-rl', textTransform: 'uppercase', fontSize: '11px', fontWeight: '800', letterSpacing: '1px' }}>
                  {currentLang === 'en' ? 'WBS Sections' : currentLang === 'ka' ? 'WBS სექციები' : currentLang === 'az' ? 'WBS Bölmələri' : 'Разделы WBS'}
                </span>
              </div>
            )}
          </div>

          {/* MASTER-DETAIL CONTAINER WITH FLOATING HOVER SIDEBAR & FULL STRETCH TWIN TABLES */}
          <div style={{ position: 'relative', width: '100%', boxSizing: 'border-box', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            
            {/* LEFT PANEL: WBS & WORKS TREE TABLE (FULL COLUMNS) */}
            <div className="premium-card" style={{ padding: 0, border: '2px solid #eef2f6', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 20px -5px rgba(0,0,0,0.05)', background: 'white', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              
              {/* LEFT ACTION BAR (Exact Match Screenshot 2: Bright Blue #3b82f6) */}
              <div style={{ background: '#3b82f6', padding: '6px 14px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', minHeight: '36px', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Folder size={18} color="white" />
                  <span style={{ fontSize: '13px', fontWeight: '900', color: 'white', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t.estEdWbsPanelTitle || 'РАЗДЕЛЫ'}
                  </span>
                  {selectedSidebarWbsId && (
                    <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '6px' }}>
                      {currentLang === 'en' ? 'Filter active' : currentLang === 'ka' ? 'ფილტრი აქტიურია' : currentLang === 'az' ? 'Filtr aktivdir' : 'Фильтр активен'} <X size={10} style={{ cursor: 'pointer', marginLeft: '4px' }} onClick={() => setSelectedSidebarWbsId(null)} />
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Search Pill */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'white', padding: '6px 14px', borderRadius: '20px', minWidth: '220px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <input
                      type="text"
                      placeholder={t.estEdSearchPlaceholder || "Поиск..."}
                      value={wbsSearchQuery}
                      onChange={(e) => setWbsSearchQuery(e.target.value)}
                      style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: '11px', color: '#0f172a', fontWeight: '600' }}
                    />
                    {wbsSearchQuery && (
                      <button onClick={() => setWbsSearchQuery('')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}>
                        <X size={10} />
                      </button>
                    )}
                  </div>

                  {/* Translucent Active Toggle Button */}
                  <button
                    onClick={() => setShowExcludedWorks(prev => !prev)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: '1px solid rgba(255,255,255,0.6)',
                      background: showExcludedWorks ? 'rgba(255,255,255,0.3)' : 'transparent',
                      color: 'white',
                      fontWeight: '700',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    title={showExcludedWorks ? (t.btnHideExcluded || "Скрыть снятые работы") : (t.btnShowExcluded || "Отобразить снятые работы")}
                  >
                    {showExcludedWorks ? <Eye size={12} /> : <EyeOff size={12} />}
                    {showExcludedWorks ? (t.tabAll || 'Все') : (t.estEdShowExcludedBtn || 'Отобразить снятые')}
                  </button>

                  {/* White Add Button */}
                  {!isApproved && (
                    <button
                      className="btn-primary"
                      style={{ padding: '6px 14px', fontSize: '11px', background: 'white', color: '#2563eb', border: 'none', borderRadius: '20px', fontWeight: '900', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                      onClick={() => {
                        // Кнопка "Работа" всегда активна по умолчанию при открытии
                        let defaultType = 'work';
                        let defaultParentId = '';
                        if (selectedNodeId) {
                          const selectedNode = data?.wbs?.find(n => n.id === selectedNodeId);
                          if (selectedNode) {
                            const selType = String(selectedNode.type).toLowerCase();
                            if (selType === 'subconstruct' || selType === 'activity type' || selType === 'activity_type') {
                              defaultParentId = selectedNode.id;
                            }
                          }
                        }
                        if (!defaultParentId) {
                          const firstSub = data?.wbs?.find(n => {
                            const t = String(n.type).toLowerCase();
                            return t === 'subconstruct' || t === 'activity type' || t === 'activity_type';
                          });
                          defaultParentId = firstSub?.id || '';
                        }
                        setFormData({
                          type: defaultType,
                          parentId: defaultParentId,
                          nameType: 'standard',
                          standardName: '',
                          customName: '',
                          volume: '',
                          workId: ''
                        });
                        setSelectedWorkId(null);
                        setWorkSearchQuery('');
                        setModalType('add-wbs-element');
                      }}
                    >
                      <Plus size={14} color="#2563eb" /> {t.estEdAddBtn || 'Добавить'}
                    </button>
                  )}
                </div>
              </div>

              {/* LEFT TABLE CONTAINER WITH SCROLL & FULL COLUMNS MATCHING SCREENSHOT 1 */}
              <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
                <table className="estimate-table" style={{ fontSize: '13px', width: '100%', minWidth: '850px', tableLayout: 'auto' }}>
                  <thead style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ width: '25px', padding: '8px 4px', textAlign: 'center' }}></th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px' }}>{t.estEdCode || 'КОД'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 8px', minWidth: '220px', width: '32%' }}>{t.estEdColWorkName || 'НАИМЕНОВАНИЕ РАБОТЫ / РАЗДЕЛА'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'center' }}>{t.estEdColUnit || 'ЕД. ИЗМ.'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{isActual ? (t.estEdColVolFact || 'ОБЪЕМ ФАКТ') : (t.estEdColVolPlan || 'ОБЪЕМ ПЛАН')}</th>
                      {!isPlan && !isActual && <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColVolFact || 'ОБЪЕМ ФАКТ'}</th>}
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{isActual ? (t.estEdColSumFact || 'СУММА ФАКТ') : (t.estEdColSumPlan || 'СУММА ПЛАН')}</th>
                      {!isPlan && !isActual && <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColSumFact || 'СУММА ФАКТ'}</th>}
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColMargin || 'МАРЖА'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColProfitability || 'РЕНТАБЕЛЬНОСТЬ'}</th>
                      <th style={{ width: '55px', padding: '8px 4px', textAlign: 'right', paddingRight: '12px' }}>{t.estEdColActions || 'ДЕЙСТВИЯ'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flattenedTreeRows.map((row) => {
                      if (!row.isVisible) return null;

                      if (row.rowType === 'wbs') {
                        const node = row.nodeData;
                        const isSelected = selectedNodeId === row.id;
                        const isExcluded = node.is_excluded;
                        const nodeSum = getWbsNodeSum(node);
                        const nodeRevenue = nodeSum * MARGIN_MULTIPLIER;
                        const nodeMargin = nodeRevenue - nodeSum;
                        const nodeProfitability = nodeRevenue > 0 ? (nodeMargin / nodeRevenue) * 100 : 0;

                        let nodeIcon = '⚙️';
                        const lowerType = String(node.type).toLowerCase();
                        if (lowerType === 'project') nodeIcon = '📁';
                        else if (lowerType === 'facility/zone' || lowerType === 'zone' || lowerType === 'object') nodeIcon = '🏢';
                        else if (lowerType === 'phase') nodeIcon = '⏱️';
                        else if (lowerType === 'discipline') nodeIcon = '📐';
                        else if (lowerType === 'work package' || lowerType === 'work_package') nodeIcon = '📦';
                        else if (lowerType === 'activity group' || lowerType === 'activity_group' || lowerType === 'construct') nodeIcon = '🏗️';
                        else if (lowerType === 'subconstruct' || lowerType === 'activity type' || lowerType === 'activity_type') nodeIcon = '⚙️';
                        else if (lowerType === 'work' || lowerType === 'activity') nodeIcon = '🛠️';

                        return (
                          <tr
                            key={row.id}
                            style={{
                              background: isSelected ? '#eff6ff' : '#f8fafc',
                              borderLeft: isSelected ? '4px solid #3b82f6' : '4px solid transparent',
                              cursor: 'pointer',
                              opacity: isExcluded ? 0.6 : 1
                            }}
                            onClick={() => {
                              setSelectedNodeId(prev => prev === row.id ? null : row.id);
                              setActiveWorkId(null);
                            }}
                          >
                            <td style={{ textAlign: 'center', padding: '4px' }}>
                              {row.hasChildren && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCollapsedNodes(prev => {
                                      const next = new Set(prev);
                                      if (next.has(row.id)) next.delete(row.id);
                                      else next.add(row.id);
                                      return next;
                                    });
                                  }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0 }}
                                >
                                  {row.isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                              )}
                            </td>
                            <td style={{ fontWeight: '900', color: '#64748b', fontSize: '12px' }}>{row.code}</td>
                            <td style={{
                              fontWeight: '900',
                              color: isExcluded ? '#cbd5e1' : (isSelected ? '#1d4ed8' : '#1e293b'),
                              fontSize: '13px',
                              paddingLeft: `${row.depth * 15}px`,
                              textDecoration: isExcluded ? 'line-through' : 'none'
                            }}>
                              {nodeIcon} {row.name}
                            </td>
                            <td style={{ textAlign: 'center', color: '#94a3b8' }}>-</td>
                            <td style={{ textAlign: 'right', color: '#94a3b8' }}>-</td>
                            {!isPlan && !isActual && <td style={{ textAlign: 'right', color: '#94a3b8' }}>-</td>}
                            <td style={{ textAlign: 'right', fontWeight: '800', color: isExcluded ? '#cbd5e1' : '#1e293b', fontSize: '12px' }}>
                              {new Intl.NumberFormat('ru-RU').format(nodeSum)} {CURRENCY}
                            </td>
                            {!isPlan && !isActual && (
                              <td style={{ textAlign: 'right', fontWeight: '800', color: isExcluded ? '#cbd5e1' : '#1e293b', fontSize: '12px' }}>
                                {new Intl.NumberFormat('ru-RU').format(nodeSum)} {CURRENCY}
                              </td>
                            )}
                            <td style={{ textAlign: 'right', fontWeight: '800', color: isExcluded ? '#cbd5e1' : '#10b981', fontSize: '12px' }}>
                              {new Intl.NumberFormat('ru-RU').format(nodeMargin)} {CURRENCY}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: '800', color: isExcluded ? '#cbd5e1' : '#8b5cf6', fontSize: '12px' }}>
                              {nodeProfitability.toFixed(1)}%
                            </td>
                            <td style={{ textAlign: 'right', paddingRight: '12px' }}>
                              {!isApproved && (
                                <button
                                  title={isExcluded ? "Вернуть в расчет" : "Исключить из расчета"}
                                  onClick={(e) => { e.stopPropagation(); handleToggleWbsExclusion(row.id, isExcluded); }}
                                  style={{ background: 'none', border: 'none', color: isExcluded ? '#3b82f6' : '#f87171', cursor: 'pointer', padding: '2px' }}
                                >
                                  {isExcluded ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      }

                      if (row.rowType === 'work') {
                        const work = row.workData;
                        const workAmount = getWorkSum(work);
                        const originalAmount = getWorkSumOriginal(work);
                        const workFactAmount = getWorkFactSum(work);
                        const isExcluded = work.is_excluded;
                        const isActive = activeWorkId === work.id;

                        const workRevenue = workAmount * MARGIN_MULTIPLIER;
                        const workMargin = workRevenue - workAmount;
                        const workProfitability = workRevenue > 0 ? (workMargin / workRevenue) * 100 : 0;

                        return (
                          <tr
                            key={row.id}
                            style={{
                              background: isActive ? '#f0f9ff' : 'white',
                              borderLeft: isActive ? '4px solid #3b82f6' : '4px solid transparent',
                              opacity: isExcluded ? 0.6 : 1,
                              cursor: 'pointer'
                            }}
                            onClick={() => {
                              setActiveWorkId(prev => prev === work.id ? null : work.id);
                              setSelectedNodeId(null);
                              setShowAllResources(false);
                            }}
                          >
                            <td style={{ textAlign: 'center', padding: '4px' }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={isApproved}
                                onChange={(e) => { e.stopPropagation(); handleToggleWorkExclusion(work.id, isExcluded); }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: '15px', height: '15px', cursor: isApproved ? 'default' : 'pointer', accentColor: '#10b981' }}
                              />
                            </td>
                            <td style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '700' }}>{row.code}</td>
                            <td style={{ paddingLeft: `${row.depth * 15}px`, fontWeight: isActive ? '900' : '700', color: isExcluded ? '#cbd5e1' : (isActive ? '#2563eb' : '#1e293b'), textDecoration: isExcluded ? 'line-through' : 'none', fontSize: '13px' }}>
                              🛠 {row.name || work.est_works?.name}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: '600', color: '#475569', fontSize: '12px' }}>
                              {work.est_works?.[`unit_${resourceLanguage}`] || work.est_works?.unit}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: '700', color: '#334155', fontSize: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                                {isActual ? (work.fact_volume != null ? work.fact_volume : work.volume) : work.volume}
                                {!isApproved && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleEditVolume(work); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
                                  >
                                    <Edit size={12} />
                                  </button>
                                )}
                              </div>
                            </td>
                            {!isPlan && !isActual && (
                              <td style={{ textAlign: 'right', fontWeight: '600', color: '#475569', fontSize: '12px' }}>
                                {work.volume}
                              </td>
                            )}
                            <td style={{ textAlign: 'right', fontWeight: '800', color: isExcluded ? '#cbd5e1' : '#2563eb', fontSize: '12px' }}>
                              {isActual
                                ? (workFactAmount != null ? `${new Intl.NumberFormat('ru-RU').format(workFactAmount)} ${CURRENCY}` : `${new Intl.NumberFormat('ru-RU').format(isExcluded ? originalAmount : workAmount)} ${CURRENCY}`)
                                : `${new Intl.NumberFormat('ru-RU').format(isExcluded ? originalAmount : workAmount)} ${CURRENCY}`}
                            </td>
                            {!isPlan && !isActual && (
                              <td style={{ textAlign: 'right', fontWeight: '800', color: isExcluded ? '#cbd5e1' : '#2563eb', fontSize: '12px' }}>
                                {new Intl.NumberFormat('ru-RU').format(isExcluded ? originalAmount : workAmount)} {CURRENCY}
                              </td>
                            )}
                            <td style={{ textAlign: 'right', fontWeight: '700', color: '#10b981', fontSize: '12px' }}>
                              {new Intl.NumberFormat('ru-RU').format(workMargin)} {CURRENCY}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: '700', color: '#8b5cf6', fontSize: '12px' }}>
                              {workProfitability.toFixed(1)}%
                            </td>
                            <td style={{ textAlign: 'right', paddingRight: '12px' }}>
                              {!isApproved && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggleWorkExclusion(work.id, isExcluded); }}
                                  title={isExcluded ? "Вернуть в расчет" : "Исключить из расчета"}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: isExcluded ? '#3b82f6' : '#f87171', padding: '2px' }}
                                >
                                  {isExcluded ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      }

                      return null;
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT PANEL: RESOURCES & WORK DETAILS TABLE (FULL COLUMNS MATCHING SCREENSHOT 2) */}
            <div className="premium-card" style={{ padding: 0, border: '2px solid #eef2f6', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 20px -5px rgba(0,0,0,0.05)', background: 'white', display: 'flex', flexDirection: 'column', flex: resourcesPanelHidden ? '0 0 auto' : 1, minHeight: 0 }}>

              {/* RIGHT ACTION BAR (Exact Match Screenshot 2: Bright Blue #3b82f6) */}
              <div style={{ background: '#3b82f6', padding: '6px 20px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', minHeight: '36px', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setResourcesPanelHidden(prev => !prev)}
                    title={resourcesPanelHidden ? (t.estEdShowResPanel || 'Показать детализацию ресурсов') : (t.estEdHideResPanel || 'Скрыть детализацию ресурсов')}
                    style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', flexShrink: 0 }}
                  >
                    {resourcesPanelHidden ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                  <Database size={18} color="white" />
                  <span style={{ fontSize: '13px', fontWeight: '900', color: 'white', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t.estEdResPanelTitle || 'РЕСУРСЫ'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* Button 1: Все ресурсы */}
                  <button
                    onClick={() => setShowAllResources(prev => !prev)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: '1px solid rgba(255,255,255,0.6)',
                      background: showAllResources ? 'rgba(255,255,255,0.3)' : 'transparent',
                      color: 'white',
                      fontWeight: '700',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    title={showAllResources ? (currentLang === 'en' ? 'Show only selected work resources' : 'Показать только ресурсы выбранной работы') : (currentLang === 'en' ? 'Show resources for all works' : 'Показать ресурсы всех работ')}
                  >
                    <List size={13} /> {t.estEdAllResBtn || 'Все ресурсы'}
                  </button>

                  {/* Button 2: Отобразить все ресурсы / Скрыть снятые */}
                  <button
                    onClick={() => setShowExcludedResources(prev => !prev)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: '1px solid rgba(255,255,255,0.6)',
                      background: showExcludedResources ? 'rgba(255,255,255,0.3)' : 'transparent',
                      color: 'white',
                      fontWeight: '700',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    title={currentLang === 'en' ? 'Show or hide resources excluded from calculation' : 'Отобразить или скрыть ресурсы, снятые с расчета'}
                  >
                    <EyeOff size={13} /> {showExcludedResources ? (currentLang === 'en' ? 'Hide excluded' : 'Скрыть снятые') : (t.estEdShowAllBtn || 'Отобразить все')}
                  </button>

                  {/* Search Pill: Расширенный поиск ресурсов... */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'white', padding: '6px 12px', borderRadius: '20px', minWidth: '220px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <Briefcase size={12} color="#3b82f6" />
                    <input
                      type="text"
                      placeholder={t.estEdAdvSearchPlaceholder || "Расширенный поиск..."}
                      value={resourceFilterQuery}
                      onChange={(e) => setResourceFilterQuery(e.target.value)}
                      style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: '11px', color: '#0f172a', fontWeight: '600' }}
                    />
                    {resourceFilterQuery && (
                      <button onClick={() => setResourceFilterQuery('')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}>
                        <X size={10} />
                      </button>
                    )}
                  </div>

                  {/* Orange Gradient Add Resource Button */}
                  {!isApproved && (
                    <button
                      className="btn-primary"
                      style={{ padding: '6px 16px', fontSize: '11px', background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)', border: 'none', borderRadius: '20px', fontWeight: '900', color: 'white', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 8px rgba(234, 88, 12, 0.3)' }}
                      onClick={() => {
                        setSelectedTargetWorkId(activeWorkId || null);
                        setModalType('browse-all-resources');
                      }}
                    >
                      <Plus size={14} color="white" /> {t.estEdAddBtn || 'Добавить'}
                    </button>
                  )}
                </div>
              </div>

              {/* RIGHT TABLE CONTAINER WITH SCROLL & FULL COLUMNS MATCHING SCREENSHOT 2 */}
              <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', display: resourcesPanelHidden ? 'none' : 'block' }}>
                <table className="estimate-table" style={{ fontSize: '13px', width: '100%', minWidth: '900px', tableLayout: 'auto' }}>
                  <thead style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ width: '25px', padding: '8px 4px', textAlign: 'center' }}></th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px' }}>{t.estEdCode || 'КОД'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px' }}>{t.estEdColResource || 'РЕСУРС'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'center' }}>{t.estEdColType || 'ТИП'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>{t.estEdColSource || 'ИСТОЧНИК'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>{t.estEdColUnit || 'ЕД. ИЗМ.'}</th>
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{isActual ? (t.estEdColNormFact || 'НОРМА ФАКТ') : (t.estEdColNormPlan || 'НОРМА ПЛАН')}</th>
                      {!isPlan && !isActual && <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColNormFact || 'НОРМА ФАКТ'}</th>}
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{isActual ? (t.estEdColQtyFact || 'КОЛ-ВО ФАКТ') : (t.estEdColQtyPlan || 'КОЛ-ВО ПЛАН')}</th>
                      {!isPlan && !isActual && <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColQtyFact || 'КОЛ-ВО ФАКТ'}</th>}
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{isActual ? (t.estEdColPriceFact || 'ЦЕНА ФАКТ') : (t.estEdColPricePlan || 'ЦЕНА ПЛАН')}</th>
                      {!isPlan && !isActual && <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColPriceFact || 'ЦЕНА ФАКТ'}</th>}
                      <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{isActual ? (t.estEdColSumFact || 'СУММА ФАКТ') : (t.estEdColSumPlan || 'СУММА ПЛАН')}</th>
                      {!isPlan && !isActual && <th style={{ color: '#475569', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', padding: '8px 4px', textAlign: 'right' }}>{t.estEdColSumFact || 'СУММА ФАКТ'}</th>}
                      <th style={{ width: '55px', padding: '8px 4px', textAlign: 'right', paddingRight: '12px' }}>{t.estEdColActions || 'ДЕЙСТВИЯ'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResourceGroups.length > 0 ? (
                      visibleResourceGroups.map(({ work, resources: workRes }) => (
                        <React.Fragment key={work.id}>
                          <tr style={{ background: '#f8fafc' }}>
                            <td colSpan={(isPlan || isActual) ? 11 : 15} style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '800', color: '#3b82f6', borderLeft: '4px solid #3b82f6' }}>
                              📁 {work?.est_works?.[`name_${resourceLanguage}`] || work?.est_works?.name}
                            </td>
                          </tr>
                          {workRes.length > 0 ? workRes.map(res => (
                            <tr key={res.id} style={{ fontSize: '13px', opacity: res.is_excluded ? 0.5 : 1, background: 'white', borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ textAlign: 'center', padding: '4px' }}>
                                <input
                                  type="checkbox"
                                  checked={!res.is_excluded}
                                  disabled={isApproved}
                                  onChange={() => handleToggleResourceExclusion(res.id, res.is_excluded)}
                                  style={{ width: '15px', height: '15px', cursor: isApproved ? 'default' : 'pointer', accentColor: '#10b981' }}
                                />
                              </td>
                              <td style={{ padding: '6px 4px', color: '#64748b', fontWeight: '700', fontSize: '12px' }}>
                                {res.est_resources?.code || '-'}
                              </td>
                              <td style={{ padding: '6px 4px', color: res.is_excluded ? '#94a3b8' : '#0f172a' }}>
                                <div style={{ fontWeight: '700', fontSize: '13px', textDecoration: res.is_excluded ? 'line-through' : 'none' }}>
                                  {res.est_resources?.[`name_${resourceLanguage}`] || res.est_resources?.name_ru || res.est_resources?.name_en || res.est_resources?.name_az || res.est_resources?.name_ka || res.est_resources?.name}
                                </div>
                              </td>
                              <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                {(() => {
                                  const tCode = res.est_resources?.type_code || '';
                                  const tName = res.est_resources?.[`type_${resourceLanguage}`] || res.est_resources?.type || 'Материал';
                                  let bg = '#dcfce7'; let cl = '#15803d';
                                  if (tCode.startsWith('10.100.')) { bg = '#dbeafe'; cl = '#1d4ed8'; }
                                  else if (tCode.startsWith('10.120.')) { bg = '#fef9c3'; cl = '#a16207'; }
                                  else if (tCode.startsWith('10.140.')) { bg = '#f3e8ff'; cl = '#7e22ce'; }
                                  return (
                                    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '800', background: bg, color: cl }}>
                                      {tName}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                {res.source === 'norm' ? (
                                  <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '800', background: '#dbeafe', color: '#1d4ed8' }}>
                                    {t.estEdSourceNorm || 'Норма'}
                                  </span>
                                ) : res.source === 'manual' ? (
                                  <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '800', background: '#f1f5f9', color: '#64748b' }}>
                                    {t.estEdSourceManual || 'Вручную'}
                                  </span>
                                ) : (
                                  <span style={{ color: '#cbd5e1', fontSize: '11px' }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: '6px 4px', textAlign: 'center', fontWeight: '600', color: '#475569' }}>
                                {res.est_resources?.[`unit_${resourceLanguage}`] || res.est_resources?.unit_ru || res.est_resources?.unit_en || res.est_resources?.unit_az || res.est_resources?.unit_ka || res.est_resources?.unit}
                              </td>
                              <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '600', color: '#475569' }}>
                                {isActual ? (res.fact_norm != null ? res.fact_norm : (res.norm || 0)) : (res.norm || 0)}
                              </td>
                              {!isPlan && !isActual && (
                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '600', color: '#475569' }}>
                                  {res.norm || 0}
                                </td>
                              )}
                              <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '700', color: '#334155' }}>
                                {isActual ? (res.fact_quantity != null ? res.fact_quantity : (res.quantity || 0)) : (res.quantity || 0)}
                              </td>
                              {!isPlan && !isActual && (
                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '700', color: '#334155' }}>
                                  {res.quantity || 0}
                                </td>
                              )}
                              <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '600', color: '#475569' }}>
                                {isActual
                                  ? `${new Intl.NumberFormat('ru-RU').format(res.fact_price != null ? res.fact_price : (res.price || 0))} ${CURRENCY}`
                                  : `${new Intl.NumberFormat('ru-RU').format(res.price || 0)} ${CURRENCY}`}
                              </td>
                              {!isPlan && !isActual && (
                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '600', color: '#475569' }}>
                                  {new Intl.NumberFormat('ru-RU').format(res.price || 0)} {CURRENCY}
                                </td>
                              )}
                              <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '800', color: res.is_excluded ? '#cbd5e1' : '#2563eb' }}>
                                {isActual
                                  ? (res.fact_amount != null ? `${new Intl.NumberFormat('ru-RU').format(res.fact_amount)} ${CURRENCY}` : `${new Intl.NumberFormat('ru-RU').format(res.amount || 0)} ${CURRENCY}`)
                                  : `${new Intl.NumberFormat('ru-RU').format(res.amount || 0)} ${CURRENCY}`}
                              </td>
                              {!isPlan && !isActual && (
                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: '800', color: res.is_excluded ? '#cbd5e1' : '#2563eb' }}>
                                  {new Intl.NumberFormat('ru-RU').format(res.amount || 0)} {CURRENCY}
                                </td>
                              )}
                              <td style={{ paddingRight: '12px', textAlign: 'right' }}>
                                {!isApproved && (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                                    <button onClick={() => handleEditResource(res)} title="Изменить норму/кол-во" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '2px' }}>
                                      <Edit size={13} />
                                    </button>
                                    <button
                                      onClick={() => handleToggleResourceExclusion(res.id, res.is_excluded)}
                                      title={res.is_excluded ? "Вернуть в расчет" : "Исключить из расчета"}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: res.is_excluded ? '#3b82f6' : '#f87171', padding: '2px' }}
                                    >
                                      {res.is_excluded ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={(isPlan || isActual) ? 11 : 15} style={{ paddingLeft: '25px', color: '#94a3b8', fontStyle: 'italic', fontSize: '11px', paddingTop: '10px', paddingBottom: '10px' }}>
                                {t.estEdNoWorkResources || 'Нет ресурсов в данной работе. Нажмите "+ Добавить ресурс", чтобы добавить.'}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={(isPlan || isActual) ? 11 : 15} style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontStyle: 'italic', fontSize: '12px' }}>
                          {t.estEdWarningSelectWork || 'Выберите работу в левой таблице WBS, чтобы просмотреть её ресурсы, или нажмите «Все ресурсы», чтобы увидеть ресурсы всей сметы.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>{/* --- МОДАЛЬНЫЕ ОКНА --- */}
      {modalType === 'rename-doc' && (
        <Modal title={t.estEdParamModalTitle || "Параметры сметы"} onClose={() => setModalType(null)} onSubmit={handleRenameEstimate} isSaving={isSaving}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '5px', display: 'block' }}>{t.estEdProjectName || 'Название проекта'}:</label>
              <input
                type="text"
                value={formData.project_id || ''}
                autoFocus
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }}
                onChange={e => setFormData({ ...formData, project_id: e.target.value })}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '5px', display: 'block' }}>{t.estPageRegionFilter || 'Регион цен'}:</label>
              <select
                style={{ 
                  width: '100%', 
                  padding: '12px', 
                  borderRadius: '12px', 
                  border: '2px solid #e2e8f0', 
                  outline: 'none', 
                  background: '#f1f5f9', 
                  color: '#64748b', 
                  fontWeight: 'bold',
                  cursor: 'not-allowed'
                }}
                value={formData.region_id || ''}
                onChange={e => setFormData({ ...formData, region_id: e.target.value })}
                disabled={true}
              >
                <option value="">-- {t.estWizardSelectRegion || 'Выберите регион'} --</option>
                {regions.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '5px', display: 'block' }}>{t.estWizardCurrency || 'Валюта сметы'}:</label>
              <select
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', outline: 'none', background: 'white', fontWeight: 'bold' }}
                value={formData.currency_id || ''}
                onChange={e => setFormData({ ...formData, currency_id: e.target.value })}
              >
                <option value="">-- {t.estWizardSelectCurrency || 'Выберите валюту'} --</option>
                {currencies.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.symbol || c.code})</option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {modalType === 'add-wbs-element' && (
        <Modal 
          title={formData.type === 'work' ? (t.btnAddWork || 'Добавить работу') : (t.btnAddStructureElement || 'Добавить элемент структуры')} 
          onClose={() => { setModalType(null); setSelectedWorkId(null); setWorkSearchQuery(''); }} 
          onSubmit={formData.type === 'work' ? handleAddWorkElement : handleAddWbsElement} 
          isSaving={isSaving}
          style={formData.type === 'work' ? { maxWidth: '850px', width: '90%' } : {}}
        >
          {/* 1. Выбор типа элемента */}
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '8px', display: 'block' }}>
              {t.lblWhatToAdd || 'Что добавить?'}
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { value: 'construct', label: t.estConstructive || 'Конструктив' },
                { value: 'subconstruct', label: t.estSubconstructive || 'Подконструктив' },
                { value: 'work', label: t.estWork || 'Работа' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    let parentId = '';
                    if (opt.value === 'subconstruct') {
                      const firstConst = data?.wbs?.find(n => {
                        const t = String(n.type).toLowerCase();
                        return t === 'construct' || t === 'activity group' || t === 'activity_group';
                      });
                      parentId = firstConst?.id || '';
                    } else if (opt.value === 'work') {
                      const firstSub = data?.wbs?.find(n => {
                        const t = String(n.type).toLowerCase();
                        return t === 'subconstruct' || t === 'activity type' || t === 'activity_type';
                      });
                      parentId = firstSub?.id || '';
                    }
                    setFormData(prev => ({
                      ...prev,
                      type: opt.value,
                      parentId,
                      nameType: 'standard',
                      standardName: '',
                      customName: ''
                    }));
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: formData.type === opt.value ? '#3b82f6' : 'white',
                    color: formData.type === opt.value ? 'white' : '#475569',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Выбор родительского элемента (только для Конструктивов, Подконструкций и Работ) */}
          {(formData.type === 'construct' || formData.type === 'subconstruct' || formData.type === 'work') && (
            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '5px', display: 'block' }}>
                {formData.type === 'construct' && ('Родительский Пакет работ:')}
                {formData.type === 'subconstruct' && (t.lblConstructive || 'Конструктив:')}
                {formData.type === 'work' && (t.lblSubconstructive || 'Подконструктив:')}
              </label>
              <select
                style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '2px solid #e2e8f0', fontWeight: 'bold', outline: 'none' }}
                value={formData.parentId || ''}
                onChange={e => setFormData({ ...formData, parentId: e.target.value })}
              >
                <option value="">-- {t.placeholderSelectParent || 'Выберите родительский элемент (необязательно)'} --</option>
                {data?.wbs
                  ?.filter(n => {
                    const t = String(n.type).toLowerCase();
                    if (formData.type === 'construct') return t === 'work_package' || t === 'work package';
                    if (formData.type === 'subconstruct') return t === 'construct' || t === 'activity group' || t === 'activity_group';
                    if (formData.type === 'work') return t === 'subconstruct' || t === 'activity type' || t === 'activity_type';
                    return false;
                  })
                  .map(n => (
                    <option key={n.id} value={n.id}>{n[`name_${currentLang}`] || n.name_ka || n.name_en || n.name_az || n.name_ru || n.name}</option>
                  ))}
              </select>
            </div>
          )}

          {/* 3. Ввод имени (для WBS элементов) */}
          {formData.type === 'construct' && (
            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '8px', display: 'block' }}>
                {t.lblConstructive || 'Название Конструктива:'}
              </label>
              <input
                type="text"
                placeholder={t.placeholderConstructName || "Напр: Земляные работы / Фундамент"}
                autoFocus
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontWeight: '600' }}
                value={formData.customName || ''}
                onChange={e => setFormData({ ...formData, customName: e.target.value, nameType: 'custom' })}
              />
            </div>
          )}

          {formData.type === 'subconstruct' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '8px', display: 'block' }}>
                  {t.lblSelectOrEnterName || 'Выберите из справочника или укажите новый:'}
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="nameType"
                        checked={formData.nameType === 'standard'}
                        onChange={() => setFormData({ ...formData, nameType: 'standard' })}
                      />
                      {t.lblFromTemplate || 'Из шаблона'}
                    </label>
                    <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="nameType"
                        checked={formData.nameType === 'custom'}
                        onChange={() => setFormData({ ...formData, nameType: 'custom' })}
                      />
                      {t.lblNew || 'Новый'}
                    </label>
                  </div>
                  {formData.nameType === 'standard' ? (
                    <select
                      style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', background: 'white', fontWeight: 'bold' }}
                      value={formData.standardName || ''}
                      onChange={e => setFormData({ ...formData, standardName: e.target.value })}
                    >
                      <option value="">-- {t.placeholderSelectStandard || 'Выберите из справочника'} --</option>
                      {(Array.isArray(wbsTemplates) ? wbsTemplates : [])
                        .filter(temp => temp && temp.code && temp.code.includes('.'))
                        .map((temp, idx) => {
                          const name = temp[`name_${currentLang}`] || temp.name_ru || temp.name || temp.code;
                          return <option key={idx} value={name}>{name}</option>;
                        })}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder={t.placeholderSubconstructName || "Напр: Разработка грунта"}
                      autoFocus
                      style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none' }}
                      value={formData.customName || ''}
                      onChange={e => setFormData({ ...formData, customName: e.target.value })}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 4. Выбор работы и ввод объема (для типа work) */}
          {formData.type === 'work' && (
            <>
              {selectedWorkId ? (
                // Если работа ВЫБРАНА: показываем только форму ввода объема
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <span style={{ fontWeight: '800', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block' }}>Выбранная работа:</span>
                      <span style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>
                        {availableWorks.find(w => w.id === selectedWorkId)?.code} - {availableWorks.find(w => w.id === selectedWorkId)?.[`name_${currentLang}`] || availableWorks.find(w => w.id === selectedWorkId)?.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSelectedWorkId(null); setFormData({ ...formData, volume: '' }); }}
                      style={{ padding: '6px 12px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '11px', fontWeight: '800', color: '#3b82f6', cursor: 'pointer' }}
                    >
                      Изменить работу
                    </button>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '8px', display: 'block' }}>
                      Введите объем:
                    </label>
                    {(() => {
                      const selectedWorkDetails = availableWorks.find(w => w.id === selectedWorkId);
                      return (
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="number"
                            autoFocus
                            placeholder="0.00"
                            style={{ width: '100%', padding: '12px 15px', paddingRight: '80px', borderRadius: '12px', border: '2px solid #3b82f6', boxSizing: 'border-box', outline: 'none', fontWeight: 'bold' }}
                            value={formData.volume || ''}
                            onChange={e => setFormData({ ...formData, volume: e.target.value })}
                          />
                          {selectedWorkDetails && (
                            <span style={{ position: 'absolute', right: '15px', fontWeight: '850', color: '#2563eb', fontSize: '12px', background: '#eff6ff', padding: '4px 10px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                              {selectedWorkDetails[`unit_${currentLang}`] || selectedWorkDetails.unit}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                // Если работа НЕ выбрана: показываем список выбора работ
                <>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                    <select
                      style={{ padding: '10px 14px', borderRadius: '12px', border: '2px solid #e2e8f0', background: 'white', fontWeight: 'bold', outline: 'none', cursor: 'pointer' }}
                      value={currentLang}
                      onChange={(e) => handleLanguageChange(e.target.value)}
                    >
                      <option value="ru">RU</option>
                      <option value="en">EN</option>
                      <option value="ka">KA</option>
                      <option value="az">AZ</option>
                    </select>
                    <select
                      value={selectedWorkUnit}
                      onChange={e => setSelectedWorkUnit(e.target.value)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '12px',
                        border: '2px solid #e2e8f0',
                        background: 'white',
                        fontWeight: 'bold',
                        outline: 'none',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      <option value="">-- {t.placeholderSelectWorkUnit || 'Все ед. изм.'} --</option>
                      {Array.from(new Set(
                        (availableWorks || [])
                          .map(w => w[`unit_${currentLang}`] || w.unit || w.unit_ru || 'PCS')
                          .filter(Boolean)
                      )).sort().map(unit => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder={t.placeholderSearchWork || "Поиск работы..."}
                      style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none' }}
                      value={workSearchQuery}
                      onChange={e => setWorkSearchQuery(e.target.value.toLowerCase())}
                    />
                  </div>
                  {isLangLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px', fontWeight: 'bold', color: '#3b82f6', marginBottom: '15px' }}>
                      {t.loadingWorks || 'Загрузка работ...'}
                    </div>
                  ) : (
                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '12px', marginBottom: '15px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                          <tr>
                            <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '10px', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>{t.estEdCode || 'Код'}</th>
                            <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '10px', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>{t.colWbsName || 'Наименование'}</th>
                            <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '10px', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0', width: '80px' }}>{t.estEdColUnit || 'Ед. изм.'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(availableWorks || [])
                            .filter(w => {
                              const localeName = w[`name_${currentLang}`] || w.name || w.name_ru || w.name_en || w.code || '';
                              if (!localeName || localeName.startsWith('[MISSING]')) return false;
                              
                              const unit = w[`unit_${currentLang}`] || w.unit || w.unit_ru || 'PCS';
                              if (selectedWorkUnit && unit !== selectedWorkUnit) return false;

                              const fullSearchStr = `${w.code || ''} ${localeName}`.toLowerCase();
                              return fullSearchStr.includes(workSearchQuery);
                            })
                            .sort((a, b) => {
                              const hasA = a.has_norms ? 1 : 0;
                              const hasB = b.has_norms ? 1 : 0;
                              if (hasA !== hasB) return hasB - hasA;
                              return (a.code || '').localeCompare(b.code || '');
                            })
                            .map(w => {
                              const name = w[`name_${currentLang}`] || w.name || w.name_ru || w.name_en || w.code || 'Работа';
                              const unit = w[`unit_${currentLang}`] || w.unit || w.unit_ru || 'PCS';
                              const prefix = w.has_norms ? '⭐ ' : '';
                              const isSelected = selectedWorkId === w.id;
                              return (
                                <tr
                                  key={w.id}
                                  onClick={() => setSelectedWorkId(w.id)}
                                  style={{
                                    cursor: 'pointer',
                                    background: isSelected ? '#eff6ff' : 'transparent',
                                    borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                                    transition: 'background 0.12s'
                                  }}
                                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                                >
                                  <td style={{ padding: '8px 10px', fontWeight: '700', color: isSelected ? '#2563eb' : '#475569' }}>
                                    {w.code}
                                  </td>
                                  <td style={{ padding: '8px 10px', color: isSelected ? '#1e3a8a' : '#1e293b', fontWeight: isSelected ? '700' : '500' }}>
                                    {prefix}{name}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                                    {unit}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Modal>
      )}



      {modalType === 'submit-review' && (
        <Modal
          title={t.estEdSubmitReviewBtn || 'Отправить на утверждение'}
          onClose={() => setModalType(null)}
          onSubmit={handleSubmitReview}
          isSaving={isSaving}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '5px', display: 'block' }}>
                {t.estEdSelectApproverLabel || 'Утверждающий (Финансовый директор):'}
              </label>
              {isLoadingApprovers ? (
                <div style={{ padding: '12px', fontSize: '13px', color: '#94a3b8' }}>{t.estEdLoadingApprovers || 'Загрузка...'}</div>
              ) : financialDirectors.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#dc2626', padding: '10px', background: '#fef2f2', borderRadius: '10px' }}>
                  {t.estEdNoFinancialDirectors || 'Нет пользователей с ролью «Финансовый директор». Обратитесь к администратору.'}
                </div>
              ) : (
                <select
                  style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', outline: 'none', fontWeight: 'bold' }}
                  value={selectedApproverId}
                  onChange={e => setSelectedApproverId(e.target.value)}
                >
                  <option value="">-- {t.estEdSelectApproverPlaceholder || 'Выберите утверждающего'} --</option>
                  {financialDirectors.map(fd => (
                    <option key={fd.id} value={fd.id}>{fd.first_name} {fd.last_name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', marginBottom: '5px', display: 'block' }}>
                {t.estEdSubmitReviewCommentLabel || 'Комментарий (необязательно):'}
              </label>
              <textarea
                rows={3}
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid #e2e8f0', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                value={submitReviewComment}
                onChange={e => setSubmitReviewComment(e.target.value)}
                placeholder={t.estEdSubmitReviewCommentPlaceholder || 'Например: срочно, нужно утвердить до конца недели'}
              />
            </div>
          </div>
        </Modal>
      )}

      {modalType === 'coeff' && (
        <Modal 
          title={t.estEdCoeffsTitle || "Накладные расходы / Наценки"} 
          onClose={() => setModalType(null)} 
          onSubmit={handleAddCoeff} 
          isSaving={isSaving}
          hideSubmitButton={isReadOnly}
        >
          {!isReadOnly && (
            <>
              <input
                type="text"
                placeholder={currentLang === 'en' ? 'Name (e.g. VAT)' : currentLang === 'ka' ? 'სახელი (მაგ. დღგ)' : currentLang === 'az' ? 'Ad (məs. ƏDV)' : 'Название (напр. НДС)'}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1', marginBottom: '15px', boxSizing: 'border-box' }}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
              <input
                type="number"
                placeholder={currentLang === 'en' ? 'Percentage (%)' : currentLang === 'ka' ? 'პროცენტი (%)' : currentLang === 'az' ? 'Faiz (%)' : 'Процент (%)'}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                onChange={e => setFormData({ ...formData, percent: e.target.value })}
              />
            </>
          )}
          <div style={{ marginTop: '20px' }}>
            {data?.coefficients?.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', marginBottom: '8px', borderRadius: '10px', alignItems: 'center' }}>
                <span style={{ fontWeight: '700' }}>{c.name} ({c.value_percent}%)</span>
                {!isApproved && !isReadOnly && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCoeff(c.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', padding: '4px', display: 'flex', alignItems: 'center' }}
                    title={currentLang === 'en' ? 'Delete coefficient' : currentLang === 'ka' ? 'კოეფიციენტის წაშლა' : currentLang === 'az' ? 'Əmsalı sil' : 'Удалить коэффициент'}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {modalType === 'fill-work-resources' && (
        <Modal title={currentLang === 'en' ? 'Resource norms' : currentLang === 'ka' ? 'რესურსების ნორმები' : currentLang === 'az' ? 'Resurs normaları' : 'Нормы ресурсов'} onClose={() => setModalType(null)} onSubmit={handleSaveFilledResources} isSaving={isSaving}>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '15px', padding: '10px', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fde68a' }}>
              💡 {currentLang === 'en' ? 'Simply enter either Norm or Quantity. The other value will calculate automatically.' : currentLang === 'ka' ? 'საკმარისია მიუთითოთ ნორმა ან რაოდენობა. მეორე მნიშვნელობა ავტომატურად გამოითвლება.' : currentLang === 'az' ? 'Norma və ya Miqdarı daxil etmək kifayətdir. İkinci dəyər avtomatik hesablanacaq.' : 'Достаточно заполнить либо Норму, либо Количество. Второе значение рассчитается автоматически.'}
            </div>
            {workResourcesToFill.map((r, i) => (
              <div key={i} style={{ marginBottom: '15px', padding: '15px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: '800', marginBottom: '10px', fontSize: '14px' }}>{r.displayName}</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}><label style={{ fontSize: '11px', color: '#64748b' }}>{t.estEdColNormPlan || 'Норма'}:</label><input type="number" value={r.norm} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }} onChange={e => { const n = [...workResourcesToFill]; n[i].norm = e.target.value; n[i].quantity = (parseFloat(e.target.value || 0) * (data?.works?.find(w => w.id === targetWorkId)?.volume || 1)).toFixed(3); setWorkResourcesToFill(n); }} /></div>
                  <div style={{ flex: 1 }}><label style={{ fontSize: '11px', color: '#64748b' }}>{t.estEdColQtyPlan || 'Кол-во'}:</label><input type="number" value={r.quantity} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }} onChange={e => { const n = [...workResourcesToFill]; n[i].quantity = e.target.value; n[i].norm = (parseFloat(e.target.value || 0) / (data?.works?.find(w => w.id === targetWorkId)?.volume || 1)).toFixed(6); setWorkResourcesToFill(n); }} /></div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}



      {modalType === 'browse-all-resources' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, paddingTop: '10vh' }}>
          <div className="premium-card animate-slide-up" style={{ width: '90%', maxWidth: '850px', maxHeight: '75vh', background: 'white', padding: '25px', borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
                {currentLang === 'en' ? 'Resources Table' : currentLang === 'ka' ? 'რესურსების ცხრილი' : currentLang === 'az' ? 'Resurslar cədvəli' : 'Все ресурсы c полным именем'}
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={20} />
              </button>
            </div>

            {/* Выбор работы если активна "все ресурсы" или нет активной */}
            {(!activeWorkId || showAllResources) && (
              <div style={{ marginBottom: '12px', padding: '10px 15px', background: '#f0f9ff', borderRadius: '12px', border: '1px solid #3b82f6', fontSize: '12px' }}>
                <label style={{ fontSize: '11px', color: '#3b82f6', fontWeight: '700', marginBottom: '4px', display: 'block' }}>
                  {currentLang === 'en' ? 'Where to add resource?' : currentLang === 'ka' ? 'სად დავამატოთ რესურსი?' : currentLang === 'az' ? 'Resurs hara əlavə edilsin?' : 'Куда добавить ресурс?'}
                </label>
                <select
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid #3b82f6', fontWeight: 'bold' }}
                  value={selectedTargetWorkId || ''}
                  onChange={e => handleTargetWorkChange(e.target.value)}
                >
                  <option value="">-- {currentLang === 'en' ? 'Select work' : currentLang === 'ka' ? 'აირჩიეთ სამუშაო' : currentLang === 'az' ? 'İş seçin' : 'Выберите работу'} --</option>
                  {data?.works?.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.est_works?.[`name_${resourceLanguage}`] || w.est_works?.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Панель фильтров ресурсов */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* 1. Селектор типа ресурса */}
              <select
                value={resourceTypeFilter}
                onChange={e => handleFilterTypeChange(e.target.value)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '2px solid #e2e8f0',
                  background: 'white',
                  fontWeight: 'bold',
                  outline: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  width: '150px'
                }}
              >
                <option value="all">{t.tabAll || 'Все типы'}</option>
                <option value="labor">{t.tabLabor || 'Люди 👥'}</option>
                <option value="machine">{t.tabMachine || 'Механизмы 🏗️'}</option>
                <option value="material">{t.tabMaterial || 'Материалы 📦'}</option>
                <option value="nonlabor">{t.tabNonLabor || 'Прочие ⚙️'}</option>
              </select>

              {/* 2. Селектор единиц измерения ресурсов */}
              <select
                value={selectedResourceUnit}
                onChange={e => setSelectedResourceUnit(e.target.value)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '2px solid #e2e8f0',
                  background: 'white',
                  fontWeight: 'bold',
                  outline: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  width: '150px'
                }}
              >
                <option value="">-- {t.placeholderSelectResUnit || 'Все ед. изм.'} --</option>
                {Array.from(new Set(
                  (searchResults || [])
                    .map(r => r[`unit_${resourceLanguage}`] || r.unit)
                    .filter(Boolean)
                )).sort().map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>

              {/* 3. Инпут поиска */}
              <input 
                type="text" 
                autoFocus
                placeholder={t.estEdSearchPlaceholder || "Поиск ресурса..."} 
                value={resourceSearchQuery}
                style={{ flex: 1, minWidth: '180px', padding: '10px 14px', borderRadius: '10px', border: '2px solid #3b82f6', outline: 'none', fontSize: '13px' }} 
                onChange={e => handleSearchResource(e.target.value)} 
              />

              {/* 4. Языковой селектор */}
              <select 
                style={{ padding: '10px', borderRadius: '10px', border: '2px solid #e2e8f0', background: 'white', fontWeight: 'bold', fontSize: '13px' }} 
                value={resourceLanguage} 
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                <option value="ru">RU</option>
                <option value="en">EN</option>
                <option value="ka">KA</option>
                <option value="az">AZ</option>
                <option value="tr">TR</option>
              </select>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              {isLangLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', fontWeight: 'bold', color: '#3b82f6' }}>
                  {t.loadingResources || 'Загрузка ресурсов...'}
                </div>
              ) : (
                (() => {
                  const activeWorkIdResolved = selectedTargetWorkId || activeWorkId || (data?.works?.length > 0 ? data.works[0].id : null);

                  const filteredResourcesList = (searchResults || [])
                    .filter(res => {
                      if (resourceTypeFilter !== 'all') {
                        let prefix = '';
                        if (resourceTypeFilter === 'labor') prefix = '10.100.';
                        else if (resourceTypeFilter === 'machine') prefix = '10.120.';
                        else if (resourceTypeFilter === 'material') prefix = '10.130.';
                        else if (resourceTypeFilter === 'nonlabor') prefix = '10.140.';
                        
                        if (prefix && !res.type_code?.startsWith(prefix)) return false;
                      }

                      const unit = res[`unit_${resourceLanguage}`] || res.unit;
                      if (selectedResourceUnit && unit !== selectedResourceUnit) return false;

                      return true;
                    });

                  const getSortScore = (res) => {
                    const hasNorm = activeWorkNorms.some(n => n.resource_id === res.id);
                    const price = resourcePrices[String(res.id)] || 0;
                    const hasPrice = price > 0;

                    if (hasNorm && hasPrice) return 3;
                    if (hasNorm) return 2;
                    if (hasPrice) return 1;
                    return 0;
                  };

                  const sortedResources = [...filteredResourcesList].sort((a, b) => getSortScore(b) - getSortScore(a));

                  return (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                        <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                          <th style={{ padding: '10px 12px', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', width: '90px' }}>Код</th>
                          <th style={{ padding: '10px 12px', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Наименование</th>
                          <th style={{ padding: '10px 12px', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', width: '120px' }}>Тип</th>
                          <th style={{ padding: '10px 12px', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', width: '80px', textAlign: 'center' }}>Ед. изм.</th>
                          <th style={{ padding: '10px 12px', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', width: '100px', textAlign: 'center' }}>Действие</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedResources.length === 0 ? (
                          <tr>
                            <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>Нет ресурсов</td>
                          </tr>
                        ) : (
                          sortedResources.map(res => {
                            const name = resourceLanguage === 'ru' ? res.name : (res[`name_${resourceLanguage}`] || res.name);
                            const unit = res[`unit_${resourceLanguage}`] || res.unit;
                            const typeName = res[`type_${resourceLanguage}`] || res.type;
                            const isAdded = data?.resources?.some(r => r.work_id === activeWorkIdResolved && r.resource_id === res.id);

                            return (
                              <tr
                                key={res.id}
                                style={{ borderBottom: '1px solid #f1f5f9', background: isAdded ? '#f8fafc' : 'transparent', cursor: isAdded ? 'not-allowed' : 'pointer' }}
                                onClick={() => {
                                  if (isAdded) return;
                                  handleInstantAddResource(res);
                                }}
                                onMouseEnter={(e) => { if (!isAdded) e.currentTarget.style.background = '#f1f5f9'; }}
                                onMouseLeave={(e) => { if (!isAdded) e.currentTarget.style.background = 'transparent'; }}
                              >
                                <td style={{ padding: '8px 12px', fontWeight: '700', color: '#3b82f6', whiteSpace: 'nowrap' }}>{res.code}</td>
                                <td style={{ padding: '8px 12px', fontWeight: '600', color: '#1e293b' }}>{name}</td>
                                <td style={{ padding: '8px 12px', color: '#64748b', fontWeight: '600' }}>{typeName}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'center', color: '#475569' }}>{unit}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                  {isAdded ? (
                                    <span style={{ fontSize: '11px', color: '#10b981', fontWeight: '800' }}>✓ Добавлен</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleInstantAddResource(res);
                                      }}
                                      className="btn-primary"
                                      style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px' }}
                                    >
                                      Выбрать
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}


      {modalType === 'edit-volume' && (
        <Modal title={currentLang === 'en' ? 'Edit Volume' : currentLang === 'ka' ? 'მოცულობის შეცვლა' : currentLang === 'az' ? 'Həcmi dəyiş' : 'Изменить объем'} onClose={() => setModalType(null)} onSubmit={submitEditVolume} isSaving={isSaving}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {isActual ? (
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColVolFact || 'Объём'}</label>
                <input autoFocus type="number" value={formData.factVolume ?? ''} placeholder="0.00" style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #ea580c', boxSizing: 'border-box' }} onChange={e => setFormData({ ...formData, factVolume: e.target.value })} />
              </div>
            ) : (
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColVolPlan || 'Объём план'}</label>
                <input autoFocus type="number" value={formData.volume} style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #3b82f6', boxSizing: 'border-box' }} onChange={e => setFormData({ ...formData, volume: e.target.value })} />
              </div>
            )}
          </div>
        </Modal>
      )}
      {modalType === 'edit-resource' && (
        <Modal title={currentLang === 'en' ? 'Edit Resource' : currentLang === 'ka' ? 'რესურსის შეცვლა' : currentLang === 'az' ? 'Resursu dəyiş' : 'Изменить ресурс'} onClose={() => setModalType(null)} onSubmit={submitEditResource} isSaving={isSaving}>
          {isActual ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColNormFact || 'Норма факт'}</label>
                  <input autoFocus type="number" value={formData.factNorm ?? ''} placeholder="0.00" style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #ea580c' }} onChange={e => setFormData({ ...formData, factNorm: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColQtyFact || 'Кол-во факт'}</label>
                  <input type="number" value={formData.factQuantity ?? ''} placeholder="0.00" style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #ea580c' }} onChange={e => setFormData({ ...formData, factQuantity: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColPriceFact || 'Цена факт'} ({CURRENCY})</label>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={formData.factPrice ?? ''} style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #ea580c' }} onChange={e => setFormData({ ...formData, factPrice: e.target.value })} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColNormPlan || 'Норма'}</label>
                  <input type="number" value={formData.norm} style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #3b82f6' }} onChange={e => handleNormChange(e.target.value, data?.works?.find(w => w.id === editingResource.work_id)?.volume || 1)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColQtyPlan || 'Количество'}</label>
                  <input type="number" value={formData.quantity} style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #3b82f6' }} onChange={e => handleQuantityChange(e.target.value, data?.works?.find(w => w.id === editingResource.work_id)?.volume || 1)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColPricePlan || 'Цена'} ({CURRENCY})</label>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={formData.price ?? ''} style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #f59e0b' }} onChange={e => setFormData({ ...formData, price: e.target.value })} />
              </div>
            </div>
          )}
        </Modal>
      )}
      {modalType === 'add-resource-values' && (
        <Modal 
          title={currentLang === 'en' ? 'Enter resource parameters' : currentLang === 'ka' ? 'შეიყვანეთ რესურსის პარამეტრები' : currentLang === 'az' ? 'Resurs parametrlərini daxil edin' : 'Введите параметры ресурса'} 
          onClose={() => { setModalType(null); setEditingResource(null); }} 
          onSubmit={submitAddResourceValues} 
          isSaving={isSaving}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#1e293b' }}>
              {editingResource?.est_resources?.[`name_${resourceLanguage}`] || editingResource?.est_resources?.name}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', padding: '10px', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fde68a' }}>
              💡 {currentLang === 'en' ? 'Enter either Norm or Quantity. The other value will calculate automatically based on work volume.' : currentLang === 'ka' ? 'შეიყვანეთ ნორმა ან რაოდენობა. მეორე მნიშვნელობა ავტომატურად გამოითვლება სამუშაოს მოცულობის საფუძველზე.' : currentLang === 'az' ? 'Norma və ya Miqdarı daxil edin. İkinci dəyər işin həcminə əsasən avtomatik hesablanacaq.' : 'Введите либо Норму, либо Количество. Второе значение рассчитается автоматически на основе объема работы.'}
            </div>
            <div style={{ display: 'flex', gap: '15px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColNormPlan || 'Норма'}:</label>
                <input 
                  type="number" 
                  placeholder="0.00"
                  value={formData.norm || ''} 
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '2px solid #cbd5e1', outline: 'none' }} 
                  onChange={e => handleNormChange(e.target.value, data?.works?.find(w => w.id === editingResource?.work_id)?.volume || 1)} 
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', display: 'block' }}>{t.estEdColQtyPlan || 'Количество'}:</label>
                <input 
                  type="number" 
                  placeholder="0.00"
                  value={formData.quantity || ''} 
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '2px solid #cbd5e1', outline: 'none' }} 
                  onChange={e => handleQuantityChange(e.target.value, data?.works?.find(w => w.id === editingResource?.work_id)?.volume || 1)} 
                />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modalType === 'add-template-selection' && (
        <Modal
          title="Выберите разделы шаблона"
          onClose={() => { setModalType(null); setSelectedTemplateCodes([]); }}
          onSubmit={() => handleApplyTemplate()}
          isSaving={isSaving}
        >
          <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              💡 Выберите разделы WBS из шаблона для добавления в смету. Разделы, которые уже присутствуют, отмечены галочкой и заблокированы.
            </div>
            {wbsTemplates
              .filter(temp => !temp.code.includes('.'))
              .map(temp => {
                const isAdded = data?.wbs?.some(w => 
                  !w.parent_id && (
                    w.name === temp.name_ru ||
                    w.name === temp.name_en ||
                    w.name === temp.name_tr ||
                    w.name === temp.name_az ||
                    w.name === temp.name_ka
                  )
                );
                const displayName = temp[`name_${resourceLanguage}`] || temp.name_ru || temp.name_en;

                return (
                  <label
                    key={temp.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      background: isAdded ? '#f1f5f9' : 'white',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      cursor: isAdded ? 'not-allowed' : 'pointer',
                      opacity: isAdded ? 0.7 : 1,
                      fontWeight: 'bold',
                      fontSize: '13px',
                      color: isAdded ? '#94a3b8' : '#1e293b'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isAdded || selectedTemplateCodes.includes(temp.code)}
                      disabled={isAdded}
                      onChange={(e) => {
                        if (isAdded) return;
                        if (e.target.checked) {
                          setSelectedTemplateCodes(prev => [...prev, temp.code]);
                        } else {
                          setSelectedTemplateCodes(prev => prev.filter(c => c !== temp.code));
                        }
                      }}
                      style={{
                        width: '18px',
                        height: '18px',
                        cursor: isAdded ? 'not-allowed' : 'pointer',
                        accentColor: '#3b82f6'
                      }}
                    />
                    <span>
                      {temp.code}. {displayName}
                    </span>
                  </label>
                );
              })}
          </div>
        </Modal>
      )}
      {showHistoryModal && (
        <Modal
          title={t.estEdHistoryModalTitle || 'История изменений сметы'}
          onClose={() => setShowHistoryModal(false)}
          hideSubmitButton={true}
        >
          <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 0' }}>
            {isLoadingHistory ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px', fontWeight: 'bold', color: '#3b82f6' }}>
                {t.estEdLoadingHistory || 'Загрузка...'}
              </div>
            ) : historyLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontWeight: 'bold' }}>
                {t.estEdHistoryEmpty || 'История изменений пуста'}
              </div>
            ) : (
              historyLogs.map(log => {
                const userFullName = log.profiles
                  ? `${log.profiles.first_name || ''} ${log.profiles.last_name || ''}`.trim() || log.profiles.email
                  : (t.estEdHistorySystem || 'Система');
                
                return (
                  <div key={log.id} style={{ padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', gap: '10px' }}>
                      <span style={{ fontWeight: '800', fontSize: '13px', color: '#1e293b' }}>
                        {log.event}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                        {log.version_label && (
                          <span style={{ fontSize: '10px', fontWeight: '800', color: '#7c3aed', background: '#f3e8ff', padding: '2px 8px', borderRadius: '8px', whiteSpace: 'nowrap' }}>
                            {log.version_label}
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', whiteSpace: 'nowrap' }}>
                          {new Date(log.created_at).toLocaleString('ru-RU')}
                        </span>
                      </div>
                    </div>
                    {log.comment && (
                      <div style={{ fontSize: '12px', color: '#475569', marginBottom: '6px', fontStyle: 'italic' }}>
                        {log.comment}
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {t.estEdHistoryInitiator || 'Инициатор:'} <span style={{ color: '#334155' }}>{userFullName}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}

export default EstimateEditor;
