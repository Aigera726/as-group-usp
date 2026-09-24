import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, ChevronRight, ChevronLeft, Building2, Users, FileText,
  CheckCircle, Clock, XCircle, AlertCircle, Loader, BarChart2,
  ArrowRight, Check, Package, Hammer, TrendingUp
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSteps(t) {
  return [
    { id: 1, label: t.contrStepProject || 'Проект',      icon: Building2 },
    { id: 2, label: t.contrStepObject || 'Объект',      icon: Building2 },
    { id: 3, label: t.contrStepContractor || 'Контрагент',  icon: Users },
    { id: 4, label: t.contrStepItems || 'Позиции',      icon: Hammer },
    { id: 5, label: t.contrStepContract || 'Договор',     icon: FileText },
    { id: 6, label: t.contrStepSummary || 'Итог',        icon: CheckCircle },
  ];
}

function getStatusLabels(t) {
  return {
    DRAFT:            { label: t.contrStatusDraft || 'Черновик',       color: '#64748b', bg: '#f1f5f9' },
    PENDING_APPROVAL: { label: t.contrStatusPendingApproval || 'На согласовании', color: '#d97706', bg: '#fef3c7' },
    APPROVED:         { label: t.contrStatusApproved || 'Согласован',      color: '#059669', bg: '#d1fae5' },
    REVISION:         { label: t.contrStatusRevision || 'На доработке',    color: '#dc2626', bg: '#fee2e2' },
    ACTIVE:           { label: t.contrStatusActive || 'Активный',        color: '#2563eb', bg: '#dbeafe' },
    CLOSED:           { label: t.contrStatusClosed || 'Закрыт',          color: '#7c3aed', bg: '#ede9fe' },
  };
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS BAR
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ percent, color = '#3b82f6', height = 6 }) {
  return (
    <div style={{ background: '#e2e8f0', borderRadius: 99, height, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{
        width: `${Math.min(100, percent || 0)}%`, height: '100%',
        background: color, borderRadius: 99,
        transition: 'width .4s ease',
      }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ current, steps }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 40 }}>
      {steps.map((s, i) => {
        const done = current > s.id;
        const active = current === s.id;
        const Icon = s.icon;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? '#059669' : active ? '#3b82f6' : '#e2e8f0',
                color: done || active ? '#fff' : '#94a3b8',
                fontWeight: 800, fontSize: 14, transition: 'all .3s',
                boxShadow: active ? '0 0 0 4px rgba(59,130,246,.2)' : 'none',
              }}>
                {done ? <Check size={18} /> : <span>{s.id}</span>}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, color: active ? '#3b82f6' : done ? '#059669' : '#94a3b8',
                whiteSpace: 'nowrap',
              }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                height: 2, width: 40, marginBottom: 22,
                background: done ? '#059669' : '#e2e8f0', flexShrink: 0,
                transition: 'background .3s',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WIZARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ContractWizard({ api, onDone, onCancel, preselectedProjectId, preselectedObjectId, t = {} }) {
  const STEPS = getSteps(t);
  const STATUS_LABELS = getStatusLabels(t);
  const [step, setStep] = useState(preselectedProjectId ? 2 : 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step data
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [objects, setObjects] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [contractors, setContractors] = useState([]);
  const [contractorSearch, setContractorSearch] = useState('');
  const [selectedContractor, setSelectedContractor] = useState(null);
  const [existingContracts, setExistingContracts] = useState([]);
  const [selectedExistingContract, setSelectedExistingContract] = useState(null);
  const [contractMode, setContractMode] = useState('new'); // 'new' | 'existing'

  // Contractor dropdown lists
  const [countries, setCountries] = useState([]);
  const [allRegions, setAllRegions] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [currencySearch, setCurrencySearch] = useState('');
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);

  // Contractor creation form state
  const [newContractorForm, setNewContractorForm] = useState({
    company_name: '',
    bin_iin: '',
    contact_person: '',
    phone: '',
    email: '',
    rs: '',
    country_id: '',
    region_id: '',
    city: t.contrPlaceholderCity || 'Тбилиси',
    street: 'Chavchavadze Ave',
    house: '12A',
    office: 'Office 15',
    zip: '0179',
    notes: ''
  });

  // Contract form (step 4)
  const [contractForm, setContractForm] = useState({
    contract_number: '',
    contract_name: t.contrDefaultContractName || 'Основной договор', // mapped from "Вид договора"
    contract_type: 'SUBCONTRACT',
    contract_mode: 'STANDARD',
    date_start: '',
    date_end: '',
    total_amount: '',
    notes: '',
    currency_id: '',
    tender_amount: '',
    tender_resource_types: [], // 'material' | 'labor' | 'machine' — любая комбинация
  });
  // Результат расчёта распределения тендерной суммы по работам (шаг 6) — считается
  // на сервере после того, как работы уже назначены (шаг 5), т.к. коэффициент нужен
  // именно по назначенным договору работам, а не по всей смете целиком.
  const [tenderDistribution, setTenderDistribution] = useState(null);
  const [tenderCalcError, setTenderCalcError] = useState('');
  const [isCalculatingTender, setIsCalculatingTender] = useState(false);
  // Живой предпросмотр того же расчёта прямо на шаге "Позиции", ДО сохранения
  // договора — иначе результат тендерного распределения не был виден нигде, пока
  // не пройдёшь весь визард до конца.
  const [tenderPreview, setTenderPreview] = useState(null);
  const [tenderPreviewError, setTenderPreviewError] = useState('');
  const [isPreviewingTender, setIsPreviewingTender] = useState(false);

  // Assignments (step 5)
  const [worksForAssignment, setWorksForAssignment] = useState([]);
  const [resourcesForAssignment, setResourcesForAssignment] = useState([]);
  const [selectedAssignments, setSelectedAssignments] = useState({}); // {id: {checked, quantity, unit_price, with_materials}}
  const [loadingWorks, setLoadingWorks] = useState(false);

  // New contractor modal
  const [showNewContractorModal, setShowNewContractorModal] = useState(false);

  // Contract created
  const [createdContract, setCreatedContract] = useState(null);

  // ── Loaders ────────────────────────────────────────────────────────────────

  // Fetch initial data
  useEffect(() => {
    api.get('/estimates/projects', { params: { lang: 'ru' } })
      .then(r => setProjects(r.data || []))
      .catch(() => {});

    api.get('/dictionaries/countries')
      .then(r => {
        setCountries(r.data || []);
        // Set Georgia as default country
        const georgia = (r.data || []).find(c => c.name.toLowerCase().includes('грузия') || c.name_en?.toLowerCase().includes('georgia'));
        if (georgia) {
          setNewContractorForm(p => ({ ...p, country_id: georgia.id }));
        }
      })
      .catch(() => {});

    api.get('/dictionaries/regions')
      .then(r => setAllRegions(r.data || []))
      .catch(() => {});

    // В договорах работаем только в трёх реальных валютах региона —
    // доллары, лари (Грузия), манаты (Азербайджан/Баку). Полный справочник
    // (70+ валют) тут ни к чему, только мешает выбрать нужную.
    const CONTRACT_CURRENCY_CODES = ['USD', 'GEL', 'AZN'];
    api.get('/dictionaries/currencies')
      .then(r => setCurrencies((r.data || []).filter(c => CONTRACT_CURRENCY_CODES.includes(c.code))))
      .catch(() => {});
  }, []);

  // Sync currency search string when currency_id changes
  useEffect(() => {
    if (contractForm.currency_id && currencies.length > 0) {
      const found = currencies.find(c => c.id === contractForm.currency_id);
      if (found) {
        setCurrencySearch(`${found.name} (${found.symbol || found.code})`);
      }
    } else if (!contractForm.currency_id) {
      setCurrencySearch('');
    }
  }, [contractForm.currency_id, currencies]);

  // Preselect project & object if props are provided
  useEffect(() => {
    if (preselectedProjectId && projects.length > 0) {
      const proj = projects.find(p => p.id === preselectedProjectId);
      if (proj) {
        setSelectedProject(proj);
        api.get(`/estimates/projects/${preselectedProjectId}/objects`)
          .then(r => {
            const objs = r.data || [];
            setObjects(objs);
            if (preselectedObjectId) {
              const obj = objs.find(o => o.id === preselectedObjectId);
              if (obj) setSelectedObject(obj);
            }
          })
          .catch(() => {});
      }
    }
  }, [preselectedProjectId, projects, preselectedObjectId]);

  // Set default region once country is Georgia
  useEffect(() => {
    if (newContractorForm.country_id && allRegions.length > 0) {
      const tbilisi = allRegions.find(r => r.country_id === newContractorForm.country_id && (r.name.toLowerCase().includes('тбилиси') || r.name_en?.toLowerCase().includes('tbilisi')));
      if (tbilisi) {
        setNewContractorForm(p => ({ ...p, region_id: tbilisi.id }));
      }
    }
  }, [newContractorForm.country_id, allRegions]);

  useEffect(() => {
    if (!selectedProject || preselectedProjectId) return;
    api.get(`/estimates/projects/${selectedProject.id}/objects`)
      .then(r => setObjects(r.data || []))
      .catch(() => {});
  }, [selectedProject, preselectedProjectId]);

  useEffect(() => {
    if (step !== 3) return;
    api.get('/contracts/contractors', { params: contractorSearch ? { search: contractorSearch } : {} })
      .then(r => setContractors(r.data || []))
      .catch(() => {});
  }, [step, contractorSearch]);

  useEffect(() => {
    if (step !== 4 || !selectedContractor || !selectedProject) return;
    api.get('/contracts/list', { params: { project_id: selectedProject.id, contractor_id: selectedContractor.id } })
      .then(r => setExistingContracts(r.data || []))
      .catch(() => {});
  }, [step, selectedContractor, selectedProject]);

  useEffect(() => {
    // Позиции теперь на шаге 4 (не 5 — тот стал шагом реквизитов договора). Ждём, пока тип
    // договора действительно известен (выбран существующий договор или тип нового) — иначе
    // не понятно, работы или ресурсы грузить, а при смене типа прямо на этом же шаге (не
    // меняя step) запрос должен перезапуститься — поэтому тип теперь тоже в зависимостях.
    if (step !== 4) return;
    const typeChosen = contractMode === 'existing' ? !!selectedExistingContract : !!contractForm.contract_type;
    if (!typeChosen) return;
    const isSupply = (selectedExistingContract?.contract_type || contractForm.contract_type) === 'SUPPLY';
    setLoadingWorks(true);
    const params = { project_id: selectedProject?.id };
    if (selectedObject) params.object_id = selectedObject.id;
    const endpoint = isSupply ? '/contracts/resources-for-assignment' : '/contracts/works-for-assignment';
    api.get(endpoint, { params })
      .then(r => {
        if (isSupply) setResourcesForAssignment(r.data || []);
        else setWorksForAssignment(r.data || []);
      })
      .catch(() => {})
      .finally(() => setLoadingWorks(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, contractMode, selectedExistingContract, contractForm.contract_type, selectedProject, selectedObject]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const contractType = selectedExistingContract?.contract_type || contractForm.contract_type;
  const isSupply = contractType === 'SUPPLY';
  const itemsForAssignment = isSupply ? resourcesForAssignment : worksForAssignment;

  const toggleAssignment = (itemId, field, value) => {
    setSelectedAssignments(prev => {
      const cur = prev[itemId] || {};
      const next = { ...cur, [field]: value };

      // Если ставим галочку и количество еще не введено или равно 0, предзаполняем его остатком
      if (field === 'checked' && value === true && (!cur.quantity || Number(cur.quantity) <= 0)) {
        const item = itemsForAssignment.find(i => i.id === itemId);
        if (item) {
          next.quantity = item.remaining_quantity;
        }
      }

      // Автоматически подставляем цену за единицу из сметы — в зависимости от чекбокса
      // "С материалами": без материалов в стоимость входят только трудовые и машины/механизмы
      // (price_without_materials), с материалами — все ресурсы работы (price_with_materials).
      // Пересчитываем при первой отметке позиции и при каждом переключении чекбокса; дальше
      // пользователь может поправить цену вручную — это его не перезапишет, пока он снова не
      // тронет чекбокс. Для ресурсов (договор-поставка) чекбокса нет, price_with_materials
      // не приходит — эта ветка их не трогает.
      if ((field === 'checked' && value === true) || field === 'with_materials') {
        const item = itemsForAssignment.find(i => i.id === itemId);
        if (item && item.price_with_materials != null) {
          const withMaterials = field === 'with_materials' ? value : !!cur.with_materials;
          next.unit_price = withMaterials ? item.price_with_materials : item.price_without_materials;
        }
      }

      return { ...prev, [itemId]: next };
    });
  };

  const assignedCount = Object.values(selectedAssignments).filter(a => a.checked).length;
  const totalAssignedAmount = Object.entries(selectedAssignments)
    .filter(([, a]) => a.checked)
    .reduce((sum, [id, a]) => {
      const qty = Number(a.quantity || 0);
      const price = Number(a.unit_price || 0);
      return sum + qty * price;
    }, 0);

  const checkedWorkIds = Object.entries(selectedAssignments)
    .filter(([, a]) => a.checked)
    .map(([id]) => id);

  // Сумма договора считается автоматически из выбранных позиций (кол-во × цена за единицу,
  // с учётом "с материалами"/"без материалов" — см. toggleAssignment). "Тендерная сумма" ниже
  // остаётся как ручная альтернатива: если она указана, она и становится суммой договора,
  // а система пропорционально пересчитывает стоимость каждой позиции под неё.
  useEffect(() => {
    const amount = contractForm.tender_amount ? Number(contractForm.tender_amount) : totalAssignedAmount;
    const next = amount > 0 ? String(amount) : '';
    setContractForm(p => (p.total_amount === next ? p : { ...p, total_amount: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAssignedAmount, contractForm.tender_amount]);

  // Живой предпросмотр распределения тендерной суммы: пересчитываем с небольшой
  // задержкой при любом изменении суммы, отмеченных видов ресурсов или отмеченных
  // работ — чтобы пользователь видел результат сразу на этом же шаге, а не только
  // после сохранения всего договора.
  useEffect(() => {
    if (isSupply || !contractForm.tender_amount || contractForm.tender_resource_types.length === 0 || checkedWorkIds.length === 0) {
      setTenderPreview(null);
      setTenderPreviewError('');
      return;
    }
    setIsPreviewingTender(true);
    const timer = setTimeout(() => {
      api.post('/contracts/tender-distribution-preview', {
        work_ids: checkedWorkIds,
        tender_amount: Number(contractForm.tender_amount),
        resource_types: contractForm.tender_resource_types
      })
        .then(res => { setTenderPreview(res.data); setTenderPreviewError(''); })
        .catch(err => { setTenderPreview(null); setTenderPreviewError(err.response?.data?.error || err.message); })
        .finally(() => setIsPreviewingTender(false));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractForm.tender_amount, JSON.stringify(contractForm.tender_resource_types), JSON.stringify(checkedWorkIds), isSupply]);

  const formatAddress = (addressStr) => {
    if (!addressStr) return '—';
    try {
      const data = JSON.parse(addressStr);
      const parts = [
        data.country_name,
        data.region_name,
        data.city,
        data.street ? `${data.street} ${data.house || ''}`.trim() : null,
        data.office ? `${t.contrAddressOfficeAbbr || 'оф.'} ${data.office}` : null,
        data.zip
      ].filter(Boolean);
      return parts.join(', ') || '—';
    } catch (e) {
      return addressStr;
    }
  };

  const validateNewContractor = () => {
    if (!newContractorForm.company_name?.trim()) return t.contrValCompanyNameRequired || 'Название компании обязательно для заполнения';
    if (!newContractorForm.bin_iin?.trim()) return t.contrValBinRequired || 'Идентификационный номер компании обязателен для заполнения';
    if (!newContractorForm.contact_person?.trim()) return t.contrValContactPersonRequired || 'ФИО директора обязательно для заполнения';

    // Email FLK
    if (newContractorForm.email?.trim()) {
      const email = newContractorForm.email.trim();
      if (/\s/.test(email)) return t.contrValEmailNoSpaces || 'Email не должен содержать пробелы';
      const parts = email.split('@');
      if (parts.length !== 2) return t.contrValEmailOneAt || 'Email должен содержать ровно один символ @';
      const [localPart, domainPart] = parts;
      if (!localPart || !domainPart) return t.contrValEmailParts || 'Email должен иметь часть до и после символа @';
      if (email.startsWith('.') || email.endsWith('.')) return t.contrValEmailDot || 'Email не должен начинаться или заканчиваться точкой';
      if (!domainPart.includes('.')) return t.contrValEmailDomainDot || 'Домен должен содержать минимум одну точку';
      if (domainPart.includes('..')) return t.contrValEmailDoubleDot || 'Домен не должен содержать две точки подряд';
      const domainDots = domainPart.split('.');
      const lastPart = domainDots[domainDots.length - 1];
      if (lastPart.length < 2) return t.contrValEmailTld || 'После последней точки должно быть минимум 2 символа';
    }

    if (!newContractorForm.rs?.trim()) return t.contrValRsRequired || 'Расчетный счет (Р/С) обязателен для заполнения';
    if (!newContractorForm.country_id) return t.contrValCountryRequired || 'Выберите страну юридического адреса';
    if (!newContractorForm.city?.trim()) return t.contrValCityRequired || 'Укажите город юридического адреса';
    if (!newContractorForm.street?.trim()) return t.contrValStreetRequired || 'Укажите улицу юридического адреса';
    if (!newContractorForm.house?.trim()) return t.contrValHouseRequired || 'Укажите номер дома';

    return null;
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async (submitForApproval = false) => {
    setSaving(true);
    setError('');
    try {
      let contract = selectedExistingContract;

      // Create contract if new
      if (contractMode === 'new') {
        const res = await api.post('/contracts', {
          project_id: selectedProject.id,
          object_id: selectedObject?.id || null,
          contractor_id: selectedContractor.id,
          ...contractForm,
        });
        contract = res.data;
        setCreatedContract(contract);
      } else {
        setCreatedContract(contract);
      }

      // Build assignments
      const toSave = Object.entries(selectedAssignments)
        .filter(([, a]) => a.checked && Number(a.quantity || 0) > 0)
        .map(([id, a]) => {
          const item = itemsForAssignment.find(w => w.id === id);
          return {
            assignment_type: isSupply ? 'RESOURCE' : 'WORK',
            est_doc_work_id: isSupply ? null : id,
            est_doc_resource_id: isSupply ? id : null,
            work_name: isSupply ? null : item?.name,
            work_unit: isSupply ? null : item?.unit,
            resource_name: isSupply ? item?.name : null,
            resource_unit: isSupply ? item?.unit : null,
            total_quantity: item?.total_quantity || 0,
            assigned_quantity: Number(a.quantity || 0),
            unit_price: Number(a.unit_price || 0),
            with_materials: Boolean(a.with_materials),
          };
        });

      if (toSave.length > 0) {
        await api.post(`/contracts/${contract.id}/assignments`, { assignments: toSave });
      }

      // Распределение тендерной суммы считается только после того, как работы уже
      // назначены договору (коэффициент нужен именно по ним) — поэтому этот вызов идёт
      // здесь, а не в POST /contracts.
      if (!isSupply && contractForm.tender_amount && contractForm.tender_resource_types.length > 0) {
        try {
          const distRes = await api.post(`/contracts/${contract.id}/tender-distribution`, {
            tender_amount: Number(contractForm.tender_amount),
            resource_types: contractForm.tender_resource_types
          });
          setTenderDistribution(distRes.data);
        } catch (distErr) {
          // Не блокируем сохранение договора из-за нерасчитавшегося распределения —
          // просто показываем ошибку на итоговом шаге, договор всё равно сохранён.
          setTenderCalcError(distErr.response?.data?.error || distErr.message);
        }
      }

      if (submitForApproval) {
        await api.post(`/contracts/${contract.id}/submit`, {});
        contract.status = 'PENDING_APPROVAL';
      }

      setCreatedContract({ ...contract, status: submitForApproval ? 'PENDING_APPROVAL' : contract.status });
      setStep(6);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const createContractor = async () => {
    const valErr = validateNewContractor();
    if (valErr) {
      alert(valErr);
      return;
    }

    setSaving(true);
    try {
      const countryObj = countries.find(c => c.id === newContractorForm.country_id);
      const regionObj = allRegions.find(r => r.id === newContractorForm.region_id);

      const addressJson = JSON.stringify({
        country_id: newContractorForm.country_id,
        country_name: countryObj ? countryObj.name : 'Georgia',
        region_id: newContractorForm.region_id,
        region_name: regionObj ? regionObj.name : '',
        city: newContractorForm.city,
        street: newContractorForm.street,
        house: newContractorForm.house,
        office: newContractorForm.office,
        zip: newContractorForm.zip
      });

      const payload = {
        company_name: newContractorForm.company_name,
        bin_iin: newContractorForm.bin_iin,
        contact_person: newContractorForm.contact_person,
        phone: newContractorForm.phone,
        email: newContractorForm.email,
        rs: newContractorForm.rs,
        address: addressJson,
        notes: newContractorForm.notes || ''
      };

      const res = await api.post('/contracts/contractors', payload);
      setSelectedContractor(res.data);
      setContractors(prev => [res.data, ...prev]);
      setShowNewContractorModal(false);

      const georgia = countries.find(c => c.name.toLowerCase().includes('грузия') || c.name_en?.toLowerCase().includes('georgia'));
      const tbilisi = allRegions.find(r => georgia && r.country_id === georgia.id && (r.name.toLowerCase().includes('тбилиси') || r.name_en?.toLowerCase().includes('tbilisi')));

      setNewContractorForm({
        company_name: '',
        bin_iin: '',
        contact_person: '',
        phone: '',
        email: '',
        rs: '',
        country_id: georgia ? georgia.id : '',
        region_id: tbilisi ? tbilisi.id : '',
        city: t.contrPlaceholderCity || 'Тбилиси',
        street: 'Chavchavadze Ave',
        house: '12A',
        office: 'Office 15',
        zip: '0179',
        notes: ''
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Navigation ─────────────────────────────────────────────────────────────

  const canNext = () => {
    if (step === 1) return !!selectedProject;
    if (step === 2) return true; // object is optional
    if (step === 3) return !!selectedContractor;
    if (step === 4) {
      // Шаг "Позиции": нужен выбранный существующий договор (или тип нового договора),
      // и хотя бы одна корректно назначенная позиция.
      const typeChosen = contractMode === 'existing' ? !!selectedExistingContract : !!contractForm.contract_type;
      if (!typeChosen) return false;
      if (assignedCount === 0) return false;

      const hasOverAssignment = Object.entries(selectedAssignments).some(([id, a]) => {
        if (!a.checked) return false;
        const item = itemsForAssignment.find(i => i.id === id);
        if (!item) return false;
        return Number(a.quantity || 0) > item.remaining_quantity;
      });

      return !hasOverAssignment;
    }
    if (step === 5) {
      // Шаг "Договор": для существующего договора реквизиты не заполняются — уже есть.
      if (contractMode === 'existing') return true;
      if (!contractForm.contract_number?.trim()) return false;
      if (!contractForm.contract_name?.trim()) return false;
      if (!contractForm.date_start) return false;
      if (contractForm.contract_mode === 'STANDARD') {
        if (!totalAssignedAmount || totalAssignedAmount <= 0) return false;
        if (!contractForm.currency_id) return false;
      }
      return true;
    }
    return true;
  };

  const goNext = () => {
    if (step === 4) {
      const hasOverAssignment = Object.entries(selectedAssignments).some(([id, a]) => {
        if (!a.checked) return false;
        const item = itemsForAssignment.find(i => i.id === id);
        if (!item) return false;
        return Number(a.quantity || 0) > item.remaining_quantity;
      });
      if (hasOverAssignment) {
        setError(t.contrErrOverAssignment || 'Некоторые работы имеют превышение по объему назначения. Пожалуйста, исправьте объемы перед продолжением.');
        return;
      }
    }
    if (!canNext()) return;
    setError('');
    setStep(s => s + 1);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER STEPS
  // ─────────────────────────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div>
      <h3 style={styles.stepTitle}>{t.contrStep1Title || 'Выберите проект'}</h3>
      <p style={styles.stepSubtitle}>{t.contrStep1Subtitle || 'Выберите проект, по которому будет создан договор'}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {projects.filter(p => ['approved','active','suspended','completed'].includes(p.status)).map(p => (
          <div
            key={p.id}
            onClick={() => setSelectedProject(p)}
            style={{
              ...styles.card,
              borderColor: selectedProject?.id === p.id ? '#3b82f6' : 'transparent',
              background: selectedProject?.id === p.id ? '#eff6ff' : '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Building2 size={18} color="#2563eb" />
              </div>
              <span style={{ fontWeight: 800, fontSize: 14, color: '#1e293b' }}>{p.name}</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{p.code || ''} {p.region_name ? `• ${p.region_name}` : ''}</div>
            {selectedProject?.id === p.id && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, color: '#2563eb', fontWeight: 700, fontSize: 12 }}>
                <Check size={14} /> {t.contrSelected || 'Выбран'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div>
      <h3 style={styles.stepTitle}>{t.contrStep2Title || 'Выберите объект'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>{t.contrOptional || '(необязательно)'}</span></h3>
      <p style={styles.stepSubtitle}>{t.contrStep2Subtitle || 'Уточните объект в рамках проекта или оставьте пустым'}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        <div
          onClick={() => setSelectedObject(null)}
          style={{
            ...styles.card,
            borderColor: !selectedObject ? '#3b82f6' : 'transparent',
            background: !selectedObject ? '#eff6ff' : '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: !selectedObject ? '#2563eb' : '#64748b' }}>
            {!selectedObject ? <Check size={16} /> : <div style={{ width: 16 }} />}
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t.contrWholeProjectNoObject || 'Весь проект (без объекта)'}</span>
          </div>
        </div>
        {objects.map(obj => (
          <div
            key={obj.id}
            onClick={() => setSelectedObject(obj)}
            style={{
              ...styles.card,
              borderColor: selectedObject?.id === obj.id ? '#3b82f6' : 'transparent',
              background: selectedObject?.id === obj.id ? '#eff6ff' : '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Building2 size={16} color="#d97706" />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{obj.name}</span>
            </div>
            {obj.address && <div style={{ fontSize: 12, color: '#94a3b8' }}>📍 {obj.address}</div>}
            {selectedObject?.id === obj.id && (
              <div style={{ marginTop: 8, color: '#2563eb', fontWeight: 700, fontSize: 12, display: 'flex', gap: 4 }}>
                <Check size={14} /> {t.contrSelected || 'Выбран'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div>
      <h3 style={styles.stepTitle}>{t.contrStep3Title || 'Выберите контрагента'}</h3>
      <p style={styles.stepSubtitle}>{t.contrStep3Subtitle || 'Найдите подрядчика или поставщика'}</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            style={{ ...styles.input, paddingLeft: 40 }}
            placeholder={t.contrSearchByNamePlaceholder || 'Поиск по названию...'}
            value={contractorSearch}
            onChange={e => setContractorSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowNewContractorModal(true)}
          style={{ ...styles.btnPrimary, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
        >
          <Plus size={16} /> {t.contrNewContractorBtn || 'Новый контрагент'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {contractors.map(c => (
          <div
            key={c.id}
            onClick={() => setSelectedContractor(c)}
            style={{
              ...styles.card,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderColor: selectedContractor?.id === c.id ? '#3b82f6' : 'transparent',
              background: selectedContractor?.id === c.id ? '#eff6ff' : '#f8fafc',
              padding: '14px 20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12, background: selectedContractor?.id === c.id ? '#dbeafe' : '#e2e8f0',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <Users size={20} color={selectedContractor?.id === c.id ? '#2563eb' : '#64748b'} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 14 }}>{c.company_name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px', marginTop: 4 }}>
                  {c.bin_iin && <div style={{ fontSize: 11, color: '#64748b' }}>{t.contrLabelBin || 'ИД номер:'} <b style={{ color: '#1e293b' }}>{c.bin_iin}</b></div>}
                  {c.contact_person && <div style={{ fontSize: 11, color: '#64748b' }}>{t.contrLabelDirector || 'Директор:'} <b style={{ color: '#1e293b' }}>{c.contact_person}</b></div>}
                  {c.phone && <div style={{ fontSize: 11, color: '#64748b' }}>{t.contrLabelPhone || 'Телефон:'} <b style={{ color: '#1e293b' }}>{c.phone}</b></div>}
                  {c.email && <div style={{ fontSize: 11, color: '#64748b' }}>{t.contrLabelEmail || 'Email:'} <b style={{ color: '#1e293b' }}>{c.email}</b></div>}
                  {c.bank_account && <div style={{ fontSize: 11, color: '#059669' }}>{t.contrLabelRs || 'Р/С:'} <b style={{ color: '#047857' }}>{c.bank_account}</b></div>}
                </div>
                {c.address && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 5, fontStyle: 'italic' }}>
                    {t.contrLabelAddress || 'Адрес:'} {formatAddress(c.address)}
                  </div>
                )}
              </div>
            </div>
            {selectedContractor?.id === c.id && <Check size={20} color="#2563eb" style={{ marginLeft: 12, flexShrink: 0 }} />}
          </div>
        ))}
        {contractors.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>
            {t.contrNoContractorsFound || 'Контрагенты не найдены. Создайте нового.'}
          </div>
        )}
      </div>

      {/* New Contractor Modal */}
      {showNewContractorModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, width: '600px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h4 style={{ margin: '0 0 20px', fontWeight: 800, fontSize: 16 }}>{t.contrNewContractorModalTitle || 'Новый контрагент'}</h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={styles.label}>{t.contrFieldCompanyName || 'Название компании *'}</label>
                <input
                  style={styles.input}
                  placeholder={t.contrPlaceholderCompanyName || 'ООО "СтройМаш"'}
                  value={newContractorForm.company_name}
                  onChange={e => setNewContractorForm(p => ({ ...p, company_name: e.target.value }))}
                />
              </div>

              <div>
                <label style={styles.label}>{t.contrFieldBin || 'Идентификационный номер компании *'}</label>
                <input
                  style={styles.input}
                  placeholder="123456789012"
                  value={newContractorForm.bin_iin}
                  onChange={e => setNewContractorForm(p => ({ ...p, bin_iin: e.target.value }))}
                />
              </div>

              <div>
                <label style={styles.label}>{t.contrFieldContactPerson || 'ФИО директора *'}</label>
                <input
                  style={styles.input}
                  placeholder={t.contrPlaceholderDirectorName || 'Иванов Иван'}
                  value={newContractorForm.contact_person}
                  onChange={e => setNewContractorForm(p => ({ ...p, contact_person: e.target.value }))}
                />
              </div>

              <div>
                <label style={styles.label}>{t.contrFieldPhone || 'Контактный телефон'}</label>
                <input
                  style={styles.input}
                  placeholder="+995XXXXXXXXX"
                  value={newContractorForm.phone}
                  onChange={e => setNewContractorForm(p => ({ ...p, phone: e.target.value.replace(/[^0-9+\s]/g, '') }))}
                />
              </div>

              <div>
                <label style={styles.label}>{t.contrFieldEmail || 'Email'}</label>
                <input
                  style={styles.input}
                  placeholder="info@company.ge"
                  value={newContractorForm.email}
                  onChange={e => setNewContractorForm(p => ({ ...p, email: e.target.value }))}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={styles.label}>{t.contrFieldRs || 'Р/С (Расчетный счет) *'}</label>
                <input
                  style={styles.input}
                  placeholder="GE29NB0000000101904917"
                  value={newContractorForm.rs}
                  onChange={e => setNewContractorForm(p => ({ ...p, rs: e.target.value }))}
                />
              </div>

              {/* Legal Address Block */}
              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 16 }}>
                <h5 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>{t.contrLegalAddressHeading || 'Юридический адрес'}</h5>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
                  <div>
                    <label style={styles.label}>{t.contrFieldCountry || 'Страна *'}</label>
                    <select
                      style={styles.select}
                      value={newContractorForm.country_id}
                      onChange={e => setNewContractorForm(p => ({ ...p, country_id: e.target.value, region_id: '' }))}
                    >
                      <option value="">{t.contrSelectCountryPlaceholder || '-- Выберите страну --'}</option>
                      {countries.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={styles.label}>{t.contrFieldRegion || 'Регион / край'}</label>
                    <select
                      style={styles.select}
                      value={newContractorForm.region_id}
                      onChange={e => setNewContractorForm(p => ({ ...p, region_id: e.target.value }))}
                      disabled={!newContractorForm.country_id}
                    >
                      <option value="">{t.contrSelectRegionPlaceholder || '-- Выберите регион --'}</option>
                      {allRegions.filter(r => r.country_id === newContractorForm.country_id).map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={styles.label}>{t.contrFieldCity || 'Город / населенный пункт *'}</label>
                    <input
                      style={styles.input}
                      placeholder={t.contrPlaceholderCity || 'Тбилиси'}
                      value={newContractorForm.city}
                      onChange={e => setNewContractorForm(p => ({ ...p, city: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>{t.contrFieldStreet || 'Улица *'}</label>
                    <input
                      style={styles.input}
                      placeholder="Chavchavadze Ave"
                      value={newContractorForm.street}
                      onChange={e => setNewContractorForm(p => ({ ...p, street: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>{t.contrFieldHouse || 'Дом *'}</label>
                    <input
                      style={styles.input}
                      placeholder="12A"
                      value={newContractorForm.house}
                      onChange={e => setNewContractorForm(p => ({ ...p, house: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>{t.contrFieldOffice || 'Офис / помещение'}</label>
                    <input
                      style={styles.input}
                      placeholder="Office 15"
                      value={newContractorForm.office}
                      onChange={e => setNewContractorForm(p => ({ ...p, office: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>{t.contrFieldZip || 'Почтовый индекс'}</label>
                    <input
                      style={styles.input}
                      placeholder="0179"
                      value={newContractorForm.zip}
                      onChange={e => setNewContractorForm(p => ({ ...p, zip: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <button onClick={() => setShowNewContractorModal(false)} style={styles.btnSecondary}>{t.contrCancel || 'Отмена'}</button>
              <button onClick={createContractor} style={styles.btnPrimary} disabled={saving}>
                {saving ? (t.contrSaving || 'Сохранение...') : (t.contrCreate || 'Создать')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderStep4 = () => {
    const isSupplyType = (selectedExistingContract?.contract_type || contractForm.contract_type) === 'SUPPLY';
    const items = isSupplyType ? resourcesForAssignment : worksForAssignment;
    // Тип договора должен быть известен до показа позиций — от него зависит, что назначаем:
    // работы (подряд) или ресурсы (поставка). Для уже существующего договора тип берём из
    // самого договора, для нового — ждём, пока пользователь выберет его ниже.
    const typeChosen = contractMode === 'existing' ? !!selectedExistingContract : !!contractForm.contract_type;

    return (
      <div>
        <h3 style={styles.stepTitle}>{t.contrStep4Title || 'Позиции'}</h3>
        <p style={styles.stepSubtitle}>{t.contrStep4Subtitle || 'Выберите договор (или его тип), затем отметьте позиции — сумма договора посчитается по ним автоматически'}</p>

        {existingContracts.length > 0 && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                {[
                  { val: 'existing', label: t.contrChooseExisting || 'Выбрать существующий' },
                  { val: 'new', label: t.contrCreateNew || 'Создать новый' },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setContractMode(opt.val)}
                    style={{
                      padding: '10px 20px', borderRadius: 12, fontWeight: 700, fontSize: 13,
                      border: `2px solid ${contractMode === opt.val ? '#3b82f6' : '#e2e8f0'}`,
                      background: contractMode === opt.val ? '#eff6ff' : '#fff',
                      color: contractMode === opt.val ? '#2563eb' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {contractMode === 'existing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {existingContracts.map(c => {
                  const s = STATUS_LABELS[c.status] || STATUS_LABELS.DRAFT;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedExistingContract(c)}
                      style={{
                        ...styles.card,
                        borderColor: selectedExistingContract?.id === c.id ? '#3b82f6' : 'transparent',
                        background: selectedExistingContract?.id === c.id ? '#eff6ff' : '#f8fafc',
                        padding: '14px 20px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
                            №{c.contract_number} {c.contract_name ? `— ${c.contract_name}` : ''}
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                            {c.contract_type === 'SUPPLY' ? (t.contrTypeSupply || '📦 Поставка') : (t.contrTypeSubcontract || '🔨 Подряд')}
                            {c.date_start && ` • ${new Date(c.date_start).toLocaleDateString('ru-RU')}`}
                            {c.date_end && ` — ${new Date(c.date_end).toLocaleDateString('ru-RU')}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{s.label}</span>
                          {selectedExistingContract?.id === c.id && <Check size={18} color="#2563eb" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {(contractMode === 'new' || existingContracts.length === 0) && (
          <div style={{ background: '#f8fafc', borderRadius: 20, padding: '24px', border: '1px solid #e2e8f0', marginBottom: 24 }}>
            <label style={styles.label}>{t.contrFieldContractType || 'Тип договора'}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { val: 'SUBCONTRACT', label: t.contrTypeSubcontractLong || '🔨 Подряд (Работы)', desc: t.contrTypeSubcontractDesc || 'Выполнение строительных работ' },
                { val: 'SUPPLY', label: t.contrTypeSupplyLong || '📦 Поставка (Материалы)', desc: t.contrTypeSupplyDesc || 'Поставка строительных материалов' },
              ].map(opt => (
                <label
                  key={opt.val}
                  style={{
                    border: `2px solid ${contractForm.contract_type === opt.val ? '#3b82f6' : '#e2e8f0'}`,
                    borderRadius: 14, padding: '14px 16px', cursor: 'pointer',
                    background: contractForm.contract_type === opt.val ? '#eff6ff' : '#fff',
                  }}
                >
                  <input
                    type="radio" name="contract_type" value={opt.val}
                    checked={contractForm.contract_type === opt.val}
                    onChange={() => setContractForm(p => ({ ...p, contract_type: opt.val }))}
                    style={{ display: 'none' }}
                  />
                  <div style={{ fontWeight: 700, fontSize: 14, color: contractForm.contract_type === opt.val ? '#2563eb' : '#1e293b' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{opt.desc}</div>
                </label>
              ))}
            </div>
          </div>
        )}

        {!typeChosen ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
            {t.contrChooseTypeFirst || 'Сначала выберите договор (или тип нового договора) выше — тогда появится список позиций.'}
          </div>
        ) : (
          <>
        <h4 style={{ margin: '8px 0 4px', fontWeight: 800, color: '#1e293b', fontSize: 16 }}>{isSupplyType ? (t.contrStep5TitleResources || '📦 Распределение ресурсов') : (t.contrStep5TitleWorks || '🔨 Распределение работ')}</h4>
        <p style={styles.stepSubtitle}>
          {isSupplyType
            ? (t.contrStep5SubtitleResources || 'Выберите ресурсы из смет и укажите количество для этого договора')
            : (t.contrStep5SubtitleWorks || 'Выберите работы из смет и укажите объём для этого договора')}
        </p>

        {loadingWorks ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60, color: '#94a3b8' }}>
            <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /> {t.contrLoadingEstimateData || 'Загрузка данных из смет...'}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
            <Package size={40} style={{ marginBottom: 12, opacity: .3 }} />
            <div>{(t.contrNoItemsFound || 'Нет {type} в сметах по выбранному проекту/объекту').replace('{type}', isSupplyType ? (t.contrWordResourcesGen || 'ресурсов') : (t.contrWordWorksGen || 'работ'))}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {/* Summary bar */}
            <div style={{ background: '#f0fdf4', borderRadius: 14, padding: '12px 20px', marginBottom: 16, display: 'flex', gap: 24, alignItems: 'center' }}>
              <span style={{ color: '#059669', fontWeight: 700, fontSize: 13 }}>{t.contrSelectedCount || '✓ Выбрано:'} {assignedCount}</span>
              <span style={{ color: '#64748b', fontSize: 13 }}>{t.contrAssignedSum || 'Сумма назначений:'} <strong>{formatNum(totalAssignedAmount)} ₸</strong></span>
            </div>

            {/* Живой предпросмотр тендерного распределения — виден сразу, как только
                указана тендерная сумма (шаг "Договор"), выбраны виды ресурсов и
                отмечена хотя бы одна работа в списке ниже. */}
            {!isSupply && contractForm.tender_amount && contractForm.tender_resource_types.length > 0 && (
              <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 14, padding: '14px 20px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', marginBottom: 8 }}>
                  {t.contrTenderPreviewHeading || 'Предпросмотр распределения тендерной суммы'}
                </div>
                {isPreviewingTender ? (
                  <div style={{ fontSize: 13, color: '#64748b' }}>{t.contrTenderCalculating || 'Считаю...'}</div>
                ) : checkedWorkIds.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#64748b' }}>{t.contrTenderPreviewNoWorks || 'Отметьте ниже хотя бы одну работу, чтобы увидеть расчёт.'}</div>
                ) : tenderPreviewError ? (
                  <div style={{ fontSize: 13, color: '#b91c1c' }}>{tenderPreviewError}</div>
                ) : tenderPreview ? (
                  <>
                    <div style={{ display: 'flex', gap: 24, marginBottom: 8, fontSize: 13, color: '#1e3a8a' }}>
                      <span>{t.contrTenderResultSource || 'Сумма по смете (выбранные ресурсы)'}: <strong>{formatNum(tenderPreview.source_total)}</strong></span>
                      <span>{t.contrTenderResultCoefficient || 'Коэффициент'}: <strong>{tenderPreview.coefficient.toFixed(4)}</strong></span>
                    </div>
                    {tenderPreview.distribution.map(row => (
                      <div key={row.est_doc_work_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #dbeafe', fontSize: 13 }}>
                        <span style={{ color: '#1e293b' }}>{row.work_name || row.est_doc_work_id}</span>
                        <span style={{ color: '#475569' }}>{formatNum(row.original_amount)} → <strong style={{ color: '#1d4ed8' }}>{formatNum(row.distributed_amount)}</strong></span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
              <thead>
                <tr style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '0 16px', textAlign: 'left', width: 36 }}></th>
                  <th style={{ padding: '0 16px', textAlign: 'left' }}>{t.contrColName || 'Наименование'}</th>
                  <th style={{ padding: '0 12px', textAlign: 'center', width: 50 }}>{t.contrColUnit || 'Ед.'}</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', width: 90 }}>{t.contrColBySpec || 'По смете'}</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', width: 90 }}>{t.contrColDistributed || 'Распред.'}</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', width: 90 }}>{t.contrColRemaining || 'Остаток'}</th>
                  <th style={{ padding: '0 12px', textAlign: 'center', width: 120 }}>{t.contrColAssign || 'Назначить'}</th>
                  <th style={{ padding: '0 12px', textAlign: 'center', width: 120 }}>{t.contrColUnitPrice || 'Цена/ед.'}</th>
                  {!isSupplyType && <th style={{ padding: '0 12px', textAlign: 'center', width: 90 }}>{t.contrColWithMaterials || 'С матер.'}</th>}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const a = selectedAssignments[item.id] || {};
                  const checked = !!a.checked;
                  const qty = Number(a.quantity || 0);
                  const price = Number(a.unit_price || item.price || 0);
                  const remaining = Math.max(0, item.remaining_quantity - qty);
                  const isExhausted = !checked && item.remaining_quantity <= 0;
                  return (
                    <tr key={item.id} style={{
                      background: checked ? '#f0fdf4' : (isExhausted ? '#f1f5f9' : '#f8fafc'),
                      opacity: isExhausted ? 0.55 : 1,
                      borderRadius: 12,
                      cursor: 'pointer',
                    }}>
                      <td style={{ padding: '10px 16px' }}>
                        <div
                          onClick={() => { if (isExhausted) return; toggleAssignment(item.id, 'checked', !checked); }}
                          title={isExhausted ? (t.contrExhaustedTooltip || 'Остаток по смете исчерпан — назначать больше нечего') : undefined}
                          style={{
                            width: 20, height: 20, borderRadius: 6, border: `2px solid ${checked ? '#059669' : '#cbd5e1'}`,
                            background: checked ? '#059669' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: isExhausted ? 'not-allowed' : 'pointer', transition: 'all .2s', flexShrink: 0,
                          }}
                        >
                          {checked && <Check size={12} color="#fff" />}
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{item.name}</div>
                        {item.type && <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.type}</div>}
                        {/* Progress bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <div style={{ flex: 1, maxWidth: 120 }}>
                            <ProgressBar percent={item.assigned_percent} color={item.assigned_percent >= 100 ? '#059669' : '#3b82f6'} />
                          </div>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{item.assigned_percent}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#64748b' }}>{item.unit}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{formatNum(item.total_quantity)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: '#64748b' }}>{formatNum(item.assigned_quantity)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: remaining <= 0 ? '#059669' : '#dc2626' }}>
                        {remaining <= 0 ? '✓ 0' : formatNum(remaining)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <input
                          type="number" min="0"
                          disabled={isExhausted}
                          style={{ ...styles.inputSmall, width: '100%', textAlign: 'right', cursor: isExhausted ? 'not-allowed' : 'auto', background: isExhausted ? '#e2e8f0' : undefined }}
                          value={a.quantity ?? ''}
                          placeholder="0"
                          onClick={() => !checked && !isExhausted && toggleAssignment(item.id, 'checked', true)}
                          onChange={e => {
                            let val = e.target.value;
                            const maxAllowed = item.remaining_quantity;
                            if (val !== '') {
                              const numVal = Number(val);
                              if (numVal > maxAllowed) {
                                setError((t.contrErrOverLimit || 'Нельзя назначить объем больше, чем осталось по смете для "{name}" (доступно: {max} {unit})').replace('{name}', item.name).replace('{max}', maxAllowed).replace('{unit}', item.unit || ''));
                                val = maxAllowed.toString();
                              } else {
                                setError('');
                              }
                              if (numVal < 0) {
                                val = '0';
                              }
                            } else {
                              setError('');
                            }
                            toggleAssignment(item.id, 'quantity', val);
                            if (Number(val) > 0 && !checked) toggleAssignment(item.id, 'checked', true);
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <input
                          type="number" min="0"
                          disabled={isExhausted}
                          style={{ ...styles.inputSmall, width: '100%', textAlign: 'right', cursor: isExhausted ? 'not-allowed' : 'auto', background: isExhausted ? '#e2e8f0' : undefined }}
                          value={a.unit_price ?? price ?? ''}
                          placeholder="0"
                          onChange={e => toggleAssignment(item.id, 'unit_price', e.target.value)}
                        />
                      </td>
                      {!isSupplyType && (
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            disabled={isExhausted}
                            checked={!!a.with_materials}
                            onChange={e => toggleAssignment(item.id, 'with_materials', e.target.checked)}
                            style={{ width: 16, height: 16, cursor: isExhausted ? 'not-allowed' : 'pointer' }}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}
      </div>
    );
  };

  const renderStep5 = () => {
    const curObj = currencies.find(c => c.id === contractForm.currency_id);
    const curSym = curObj?.symbol || curObj?.code || '₸';

    return (
      <div>
        <h3 style={styles.stepTitle}>{t.contrStep5Title || 'Реквизиты договора'}</h3>
        <p style={styles.stepSubtitle}>{t.contrStep5Subtitle || 'Сумма уже посчитана по выбранным позициям — заполните остальные данные договора'}</p>

        {contractMode === 'existing' ? (
          <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 16, padding: 20, color: '#166534', fontWeight: 600 }}>
            {t.contrExistingContractNoRequisites || 'Вы добавляете позиции к уже существующему договору — реквизиты заполнять не нужно, они уже заданы.'}
          </div>
        ) : (
          <div style={{ background: '#f8fafc', borderRadius: 20, padding: '24px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={styles.label}>{t.contrFieldContractMode || 'Режим договора'}</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[
                    { val: 'STANDARD', label: t.contrModeStandard || 'Стандартный' },
                    { val: 'OPEN', label: t.contrModeOpen || 'Открытый' },
                  ].map(opt => (
                    <label key={opt.val} style={{
                      flex: 1, border: `2px solid ${contractForm.contract_mode === opt.val ? '#1e293b' : '#e2e8f0'}`,
                      borderRadius: 12, padding: '10px 14px', cursor: 'pointer', textAlign: 'center',
                      background: contractForm.contract_mode === opt.val ? '#1e293b' : '#fff',
                      color: contractForm.contract_mode === opt.val ? '#fff' : '#64748b',
                      fontWeight: 700, fontSize: 12,
                    }}>
                      <input
                        type="radio" name="contract_mode" value={opt.val}
                        checked={contractForm.contract_mode === opt.val}
                        onChange={() => setContractForm(p => ({ ...p, contract_mode: opt.val }))}
                        style={{ display: 'none' }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={styles.label}>{t.contrFieldNumber || '№ Договора *'}</label>
                <input style={styles.input} placeholder={t.contrNumberPlaceholder || 'Б/Н или №ДГ-2025-001'}
                  value={contractForm.contract_number}
                  onChange={e => setContractForm(p => ({ ...p, contract_number: e.target.value }))} />
              </div>

              <div>
                <label style={styles.label}>{t.contrFieldDateStart || 'Дата начала *'}</label>
                <input type="date" style={styles.input}
                  value={contractForm.date_start}
                  onChange={e => setContractForm(p => ({ ...p, date_start: e.target.value }))} />
              </div>
              <div>
                <label style={styles.label}>{t.contrFieldDateEnd || 'Дата окончания'}</label>
                <input type="date" style={styles.input}
                  value={contractForm.date_end}
                  onChange={e => setContractForm(p => ({ ...p, date_end: e.target.value }))} />
              </div>

              {contractForm.contract_mode === 'STANDARD' && (
                <>
                  <div>
                    <label style={styles.label}>{t.contrFieldTotalAmount || 'Общая сумма договора'}</label>
                    <div style={{ ...styles.input, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#eff6ff', border: '2px solid #bfdbfe', fontWeight: 800, color: '#1d4ed8' }}>
                      <span>{formatNum(totalAssignedAmount)} {curSym}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                      {t.contrTotalAutoHint || 'Считается автоматически по выбранным позициям (объём × цена/ед.). Чтобы указать другую сумму — заполните «Тендерная сумма» ниже.'}
                    </div>
                  </div>
                  <div>
                    <label style={styles.label}>{t.contrFieldCurrency || 'Валюта *'}</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        style={styles.input}
                        placeholder={t.contrCurrencySearchPlaceholder || 'Введите название или код валюты...'}
                        value={currencySearch}
                        onFocus={() => setShowCurrencyDropdown(true)}
                        onBlur={() => {
                          setTimeout(() => setShowCurrencyDropdown(false), 200);
                        }}
                        onChange={e => {
                          setCurrencySearch(e.target.value);
                          setShowCurrencyDropdown(true);
                          if (!e.target.value) {
                            setContractForm(p => ({ ...p, currency_id: '' }));
                          }
                        }}
                      />
                      {showCurrencyDropdown && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          background: '#fff',
                          border: '1.5px solid #cbd5e1',
                          borderRadius: 12,
                          maxHeight: 200,
                          overflowY: 'auto',
                          zIndex: 50,
                          marginTop: 4,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                        }}>
                          {currencies.filter(c => {
                            const s = currencySearch.toLowerCase();
                            return (
                              (c.name || '').toLowerCase().includes(s) ||
                              (c.code || '').toLowerCase().includes(s) ||
                              (c.symbol || '').toLowerCase().includes(s)
                            );
                          }).map(c => (
                            <div
                              key={c.id}
                              onMouseDown={() => {
                                setContractForm(p => ({ ...p, currency_id: c.id }));
                                setCurrencySearch(`${c.name} (${c.symbol || c.code})`);
                                setShowCurrencyDropdown(false);
                              }}
                              style={{
                                padding: '10px 14px',
                                cursor: 'pointer',
                                fontSize: 13,
                                borderBottom: '1px solid #f1f5f9',
                                fontWeight: 600,
                                color: '#1e293b',
                                background: contractForm.currency_id === c.id ? '#eff6ff' : '#fff',
                                transition: 'background 0.15s'
                              }}
                              onMouseEnter={e => e.target.style.background = '#f1f5f9'}
                              onMouseLeave={e => e.target.style.background = contractForm.currency_id === c.id ? '#eff6ff' : '#fff'}
                            >
                              {c.name} ({c.symbol || c.code})
                            </div>
                          ))}
                          {currencies.filter(c => {
                            const s = currencySearch.toLowerCase();
                            return (
                              (c.name || '').toLowerCase().includes(s) ||
                              (c.code || '').toLowerCase().includes(s) ||
                              (c.symbol || '').toLowerCase().includes(s)
                            );
                          }).length === 0 && (
                            <div style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                              {t.contrNothingFound || 'Ничего не найдено'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={styles.label}>{t.contrFieldNotes || 'Примечания'}</label>
                <textarea style={{ ...styles.input, height: 80, resize: 'vertical' }} placeholder={t.contrNotesPlaceholder || 'Дополнительные условия...'}
                  value={contractForm.notes}
                  onChange={e => setContractForm(p => ({ ...p, notes: e.target.value }))} />
              </div>

              {/* Тендерная сумма — ручная альтернатива автосчёту: если указана, становится
                  суммой договора вместо автоматической, а стоимость каждой позиции
                  пропорционально пересчитывается под неё. Только для подрядных договоров. */}
              {contractForm.contract_type !== 'SUPPLY' && (
                <div style={{ gridColumn: '1 / -1', background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16, marginTop: 4 }}>
                  <label style={styles.label}>{t.contrFieldTenderAmount || 'Тендерная сумма (необязательно)'}</label>
                  <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
                    {t.contrTenderHint || 'Если сумма по итогам тендера отличается от автоматически посчитанной — укажите её здесь. Система пропорционально пересчитает стоимость каждой назначенной позиции, сохранив исходные соотношения между ними.'}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start' }}>
                    <input type="number" style={styles.input} placeholder="0"
                      value={contractForm.tender_amount}
                      onChange={e => setContractForm(p => ({ ...p, tender_amount: e.target.value }))} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
                        {t.contrTenderResourceTypesLabel || 'Распределять по видам ресурсов'}
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {[
                          { value: 'material', label: t.contrResTypeMaterial || 'Материалы' },
                          { value: 'labor', label: t.contrResTypeLabor || 'Трудовые ресурсы' },
                          { value: 'machine', label: t.contrResTypeMachine || 'Машины и механизмы' },
                        ].map(opt => (
                          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={contractForm.tender_resource_types.includes(opt.value)}
                              onChange={e => setContractForm(p => ({
                                ...p,
                                tender_resource_types: e.target.checked
                                  ? [...p.tender_resource_types, opt.value]
                                  : p.tender_resource_types.filter(v => v !== opt.value)
                              }))}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStep6 = () => {
    const contract = createdContract;
    const statusInfo = STATUS_LABELS[contract?.status] || STATUS_LABELS.DRAFT;
    const lines = Object.entries(selectedAssignments)
      .filter(([, a]) => a.checked)
      .map(([id, a]) => {
        const item = itemsForAssignment.find(w => w.id === id);
        return { name: item?.name || '—', unit: item?.unit || '', quantity: a.quantity, unit_price: a.unit_price };
      });

    const curObj = currencies.find(c => c.id === contractForm.currency_id);
    const curSym = curObj?.symbol || curObj?.code || '₸';

    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', background: '#d1fae5',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <CheckCircle size={42} color="#059669" />
          </div>
          <h3 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{t.contrSavedSuccess || 'Договор сохранён!'}</h3>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 20, background: statusInfo.bg }}>
            <span style={{ fontWeight: 700, color: statusInfo.color }}>{statusInfo.label}</span>
          </div>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 20, padding: 24, textAlign: 'left', marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: t.contrSummaryProject || 'Проект', value: selectedProject?.name },
              { label: t.contrSummaryObject || 'Объект', value: selectedObject?.name || (t.contrSummaryWholeProject || 'Весь проект') },
              { label: t.contrSummaryContractor || 'Контрагент', value: selectedContractor?.company_name },
              { label: t.contrSummaryNumber || '№ Договора', value: contract?.contract_number },
              { label: t.contrSummaryType || 'Тип', value: contract?.contract_type === 'SUPPLY' ? (t.contrTypeSupplyShort || 'Поставка') : (t.contrTypeSubcontractShort || 'Подряд') },
              { label: t.contrSummaryItemsCount || 'Позиций назначено', value: lines.length },
            ].map(item => (
              <div key={item.label} style={{ padding: '10px 16px', background: '#fff', borderRadius: 12 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 14 }}>{item.value || '—'}</div>
              </div>
            ))}
          </div>

          {lines.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>{t.contrAssignmentsHeading || 'Назначения'}</div>
              {lines.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#1e293b' }}>{l.name}</span>
                  <span style={{ color: '#64748b' }}>{formatNum(l.quantity)} {l.unit} × {formatNum(l.unit_price)} = <strong>{formatNum(l.quantity * l.unit_price)} {curSym}</strong></span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', fontWeight: 800, fontSize: 15 }}>
                {t.contrTotal || 'Итого:'} {formatNum(totalAssignedAmount)} {curSym}
              </div>
            </div>
          )}

          {tenderCalcError && (
            <div style={{ marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#991b1b', fontSize: 13 }}>
              {t.contrTenderCalcErrorPrefix || 'Не удалось рассчитать распределение тендерной суммы: '}{tenderCalcError}
            </div>
          )}

          {tenderDistribution && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>
                {t.contrTenderResultHeading || 'Распределение тендерной суммы по работам'}
              </div>
              <div style={{ display: 'flex', gap: 24, marginBottom: 10, fontSize: 13, color: '#475569' }}>
                <span>{t.contrTenderResultSource || 'Сумма по смете (выбранные ресурсы)'}: <strong>{formatNum(tenderDistribution.source_total)} {curSym}</strong></span>
                <span>{t.contrTenderResultCoefficient || 'Коэффициент'}: <strong>{tenderDistribution.coefficient.toFixed(4)}</strong></span>
                <span>{t.contrTenderResultTarget || 'Тендерная сумма'}: <strong>{formatNum(tenderDistribution.tender_amount)} {curSym}</strong></span>
              </div>
              {tenderDistribution.distribution.map(row => (
                <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#1e293b' }}>{row.work_name || row.est_doc_work_id}</span>
                  <span style={{ color: '#64748b' }}>{formatNum(row.original_amount)} → <strong>{formatNum(row.distributed_amount)} {curSym}</strong></span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={onDone} style={{ ...styles.btnPrimary, padding: '14px 32px' }}>
            {t.contrGoToRegistry || 'Перейти к реестру договоров'}
          </button>
        </div>
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <StepIndicator current={step} steps={STEPS} />

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 24, padding: '32px', boxShadow: '0 4px 24px rgba(0,0,0,.06)', border: '1px solid #f1f5f9', minHeight: 300 }}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
        {step === 6 && renderStep6()}
      </div>

      {step < 6 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
          <button
            onClick={(step === 1 || (preselectedProjectId && step === 2)) ? onCancel : () => setStep(s => s - 1)}
            style={{ ...styles.btnSecondary, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <ChevronLeft size={16} /> {(step === 1 || (preselectedProjectId && step === 2)) ? (t.contrCancel || 'Отмена') : (t.contrBack || 'Назад')}
          </button>

          {step === 5 ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => handleSave(false)}
                disabled={saving || assignedCount === 0}
                style={{ ...styles.btnSecondary, display: 'flex', alignItems: 'center', gap: 8, opacity: assignedCount === 0 ? .5 : 1 }}
              >
                {saving ? <Loader size={14} /> : null} {t.contrSaveDraft || 'Сохранить черновик'}
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={saving || assignedCount === 0}
                style={{ ...styles.btnPrimary, display: 'flex', alignItems: 'center', gap: 8, opacity: assignedCount === 0 ? .5 : 1 }}
              >
                {saving ? <Loader size={14} /> : <ArrowRight size={16} />}
                {t.contrSubmitForApproval || 'Отправить на согласование'}
              </button>
            </div>
          ) : (
            <button
              onClick={goNext}
              disabled={!canNext()}
              style={{ ...styles.btnPrimary, display: 'flex', alignItems: 'center', gap: 8, opacity: canNext() ? 1 : .4 }}
            >
              {t.contrNext || 'Далее'} <ChevronRight size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  stepTitle: { margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#1e293b' },
  stepSubtitle: { margin: '0 0 24px', color: '#64748b', fontSize: 14 },
  card: {
    border: '2px solid transparent', borderRadius: 16, padding: '16px 20px', cursor: 'pointer',
    transition: 'all .2s', boxShadow: '0 1px 4px rgba(0,0,0,.04)',
  },
  input: {
    width: '100%', padding: '11px 16px', borderRadius: 12, border: '1.5px solid #e2e8f0',
    fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff',
    transition: 'border-color .2s', fontFamily: 'inherit',
  },
  inputSmall: {
    padding: '7px 10px', borderRadius: 8, border: '1.5px solid #e2e8f0',
    fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit',
  },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  btnPrimary: {
    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff',
    border: 'none', padding: '12px 24px', borderRadius: 12, fontWeight: 700, fontSize: 14,
    cursor: 'pointer', transition: 'all .2s',
  },
  btnSecondary: {
    background: '#f1f5f9', color: '#475569', border: 'none',
    padding: '12px 24px', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  },
  modalBox: {
    background: '#fff', borderRadius: 24, padding: 32, width: '100%', maxWidth: 480,
    boxShadow: '0 25px 50px rgba(0,0,0,.15)',
  },
};