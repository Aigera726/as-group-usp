import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { Briefcase, Package, Hammer, Ruler, ListTree, Plus, Pencil, Trash2, X, Search, ChevronLeft, ChevronRight, Scale, Coins } from 'lucide-react';

const SUB_TABS = [
  { key: 'projects', labelKey: 'dictCardProjects', icon: Briefcase },
  { key: 'resources', labelKey: 'dictCardResources', icon: Package },
  { key: 'works', labelKey: 'dictCardWorks', icon: Hammer },
  { key: 'norms', labelKey: 'dictCardNorms', icon: Ruler },
  { key: 'measures', labelKey: 'dictCardMeasures', icon: Scale },
  { key: 'wbs', labelKey: 'dictCardWbs', icon: ListTree },
];

// Тексты кнопок/сообщений форм справочников на 4 языках (из ТЗ "Ресурсы")
const DICT_I18N = {
  save: { ru: 'Сохранить', en: 'Save', az: 'Yadda saxla', ka: 'შენახვა' },
  cancel: { ru: 'Отмена', en: 'Cancel', az: 'Ləğv et', ka: 'გაუქმება' },
  CODE_EXISTS: {
    ru: 'Элемент с указанным кодом уже существует',
    en: 'An item with the specified code already exists',
    az: 'Göstərilən kod ilə element artıq mövcuddur',
    ka: 'მითითებული კოდის მქონე ელემენტი უკვე არსებობს',
  },
  NAME_EXISTS: {
    ru: 'Элемент с указанным наименованием уже существует',
    en: 'An item with the specified name already exists',
    az: 'Göstərilən ad ilə element artıq mövcuddur',
    ka: 'მითითებული დასახელების მქონე ელემენტი უკვე არსებობს',
  },
  deleteSuccess: {
    ru: 'Ресурс успешно удален из справочника',
    en: 'The resource has been successfully removed from the directory',
    az: 'Resurs sorğu kitabçasından uğurla silindi',
    ka: 'რესურსი წარმატებით წაიშალა ცნობარიდან',
  },
  RESOURCE_IN_USE: {
    ru: 'Ресурс добавлен в активной смете',
    en: 'The resource is used in an active estimate',
    az: 'Resurs aktiv smetada istifadə olunur',
    ka: 'რესურსი გამოიყენება აქტიურ ხარჯთაღრიცხვაში',
  },
  WORK_IN_USE: {
    ru: 'Работа используется в смете — деактивация невозможна',
    en: 'The work is used in an estimate — deactivation is not possible',
    az: 'İş smetada istifadə olunur — deaktivasiya mümkün deyil',
    ka: 'სამუშაო გამოიყენება ხარჯთაღრიცხვაში — დეაქტივაცია შეუძლებელია',
  },
};
const dt = (key, lang) => DICT_I18N[key]?.[lang] || DICT_I18N[key]?.ru || key;

const th = { padding: '12px 14px', textAlign: 'left', color: '#64748b', textTransform: 'uppercase', fontSize: '12px', fontWeight: '700', letterSpacing: '0.02em' };
const td = { padding: '12px 14px', fontSize: '14px', color: '#1e293b', borderBottom: '1px solid #f1f5f9' };
const PAGE_SIZE = 25;

// Заглушка для справочников, где ещё нет бэкенд-роутов на добавление/изменение/удаление
// (Ресурсы, Работы и Единицы измерения уже подключены к полноценному CRUD).
const notReadyYet = () => alert('Добавление/редактирование/удаление для этого справочника подключим следующим шагом (нужны новые роуты на бэкенде).');

// Достаём название/единицу на нужном языке; если перевода нет — берём то,
// что вернул бэкенд по умолчанию (ru -> en -> ka -> az -> tr), но не молча,
// а с пометкой, что это не выбранный язык.
function pickLocalized(row, lang, field) {
  const langKey = lang === 'ge' ? 'ka' : lang; // на бэке грузинский иногда приходит как ge
  const localized = row[`${field}_${langKey}`];
  if (localized) return { text: localized, isFallback: false };
  return { text: row[field] || '', isFallback: true };
}

function LocalizedCell({ row, lang, field }) {
  const { text, isFallback } = pickLocalized(row, lang, field);
  if (!text) return <span style={{ color: '#cbd5e1' }}>—</span>;
  return (
    <span>
      {text}
      {isFallback && <span title="Нет перевода на выбранный язык" style={{ marginLeft: '6px', fontSize: '10px', color: '#f59e0b', fontWeight: '700' }}>⚠ др. язык</span>}
    </span>
  );
}

function Toolbar({ title, count, onAdd, hideAdd, search, onSearchChange, searchPlaceholder, t }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '21px', fontWeight: '800', color: '#1e293b' }}>{title}</h3>
        {typeof count === 'number' && <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#94a3b8' }}>{t.dictTotalRecords}: {count}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {onSearchChange && (
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              style={{ padding: '9px 10px 9px 32px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', width: '220px' }}
            />
          </div>
        )}
        {!hideAdd && (
          <button onClick={onAdd || notReadyYet} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 16px', fontSize: '14px', whiteSpace: 'nowrap' }}>
            <Plus size={17} /> {t.dictBtnAdd}
          </button>
        )}
      </div>
    </div>
  );
}

function RowActions({ onEdit, onDelete, canEdit = true, t }) {
  if (!canEdit) return null;
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <button onClick={onEdit || notReadyYet} title={t.dictBtnEdit} style={{ background: '#eff6ff', border: 'none', color: '#3b82f6', width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer' }}><Pencil size={13} /></button>
      <button onClick={onDelete || notReadyYet} title={t.dictBtnDelete} style={{ background: '#fff1f2', border: 'none', color: '#ef4444', width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer' }}><Trash2 size={13} /></button>
    </div>
  );
}

function Pagination({ page, setPage, totalItems, pageSize = PAGE_SIZE, t }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
      <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
        <ChevronLeft size={14} />
      </button>
      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>{t.dictPageOf} {page + 1} {t.dictOfTotal} {totalPages}</span>
      <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// Общий хук: клиентский поиск + пагинация по уже загруженному массиву
function useFilteredPage(rows, search, searchFields) {
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(row => searchFields.some(f => String(row[f] || '').toLowerCase().includes(q)));
  }, [rows, search, searchFields]);

  useEffect(() => { setPage(0); }, [search]);

  const pageRows = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  return { filtered, pageRows, page, setPage };
}

function ProjectsDict({ lang, canEdit, t }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/estimates/projects?lang=${lang}&show_inactive=true`)
      .then(res => setRows(res.data || []))
      .catch(err => console.error('Ошибка загрузки проектов:', err))
      .finally(() => setLoading(false));
  }, [lang]);

  const { filtered, pageRows, page, setPage } = useFilteredPage(rows, search, ['code', 'name', 'customer_name', 'object_type_name']);

  if (loading) return <p style={{ color: '#94a3b8' }}>{t.dictLoading}</p>;
  return (
    <>
      <Toolbar title={t.dictCardProjects} count={filtered.length} hideAdd search={search} onSearchChange={setSearch} searchPlaceholder={`${t.dictFilterCode}, ${t.dictFilterName}, ${t.dictColCustomer}...`} t={t} />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: '#f8fafc' }}>
          <th style={th}>{t.dictColCode}</th><th style={th}>{t.dictColName}</th><th style={th}>{t.dictColObjectType}</th><th style={th}>{t.dictColCustomer}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {pageRows.map(p => (
            <tr key={p.id}>
              <td style={td}>{p.code}</td>
              <td style={td}>{p.name}</td>
              <td style={td}>{p.object_type_name}</td>
              <td style={td}>{p.customer_name}</td>
              <td style={td}><RowActions canEdit={false} t={t} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} setPage={setPage} totalItems={filtered.length} t={t} />
    </>
  );
}

// Выпадающий список с поиском по тексту — для выбора единицы измерения при
// добавлении/редактировании ресурса (ТЗ: "дать пользователю возможность поиска").
function MeasureSearchSelect({ measures, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selected = measures.find(m => m.id === value);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? measures.filter(m => `${m.name} ${m.code}`.toLowerCase().includes(q)) : measures;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        value={open ? query : (selected ? `${selected.name} (${selected.code})` : '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        placeholder={placeholder}
        style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '14px' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', marginTop: '4px', maxHeight: '220px', overflowY: 'auto', zIndex: 20, boxShadow: '0 8px 20px rgba(15,23,42,0.12)' }}>
          {filtered.length === 0 && <div style={{ padding: '9px 11px', color: '#94a3b8', fontSize: '13px' }}>—</div>}
          {filtered.map(m => (
            <div
              key={m.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(m.id); setOpen(false); setQuery(''); }}
              style={{ padding: '8px 11px', cursor: 'pointer', fontSize: '13px', background: m.id === value ? '#eff6ff' : 'white' }}
            >
              {m.name} ({m.code})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceFormModal({ initial, types, measures, lang = 'ru', t, onClose, onSaved }) {
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code || '');
  const [codeAutoFilled, setCodeAutoFilled] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [measureId, setMeasureId] = useState(initial?.measure_id || '');
  const [nameRu, setNameRu] = useState(initial?.name_ru || '');
  const [nameEn, setNameEn] = useState(initial?.name_en || '');
  const [nameKa, setNameKa] = useState(initial?.name_ka || '');
  const [nameAz, setNameAz] = useState(initial?.name_az || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Страна/регион/цена — только при создании (у существующего ресурса цены редактируются отдельно от карточки самого ресурса)
  const [countries, setCountries] = useState([]);
  const [regions, setRegions] = useState([]);
  const [countryId, setCountryId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (isEdit) return;
    // При добавлении ресурса в списке стран показываем только Азербайджан и Грузию
    api.get('/dictionaries/countries').then(res => setCountries((res.data || []).filter(c => c.code === 'AZ' || c.code === 'GE'))).catch(err => console.error(err));
    api.get('/dictionaries/regions').then(res => setRegions(res.data || [])).catch(err => console.error(err));
  }, [isEdit]);

  const regionsForCountry = countryId ? regions.filter(r => r.country_id === countryId) : [];
  const selectedCountry = countries.find(c => c.id === countryId);

  // Автогенерация кода — только для Грузии, только при создании, и только пока пользователь не начал править код руками
  useEffect(() => {
    if (isEdit || selectedCountry?.code !== 'GE' || !typeId || codeAutoFilled === 'edited') return;
    api.get(`/dictionaries/resources/suggest-code?type_id=${typeId}`)
      .then(res => { setCode(res.data.suggested_code); setCodeAutoFilled(true); })
      .catch(err => console.error(err));
  }, [selectedCountry?.code, typeId, isEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!code || !nameRu || (!isEdit && (!typeId || !measureId))) {
      setError(t.validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = { code, type_id: typeId, measure_id: measureId, name_ru: nameRu, name_en: nameEn, name_ka: nameKa, name_az: nameAz };
      if (isEdit) {
        await api.put(`/dictionaries/resources/${initial.id}`, payload);
      } else {
        if (regionId) { payload.region_id = regionId; payload.price = price; }
        await api.post('/dictionaries/resources', payload);
      }
      onSaved();
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode && DICT_I18N[errCode]) {
        setError(dt(errCode, lang));
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '420px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>{isEdit ? t.dictFormEditResource : t.dictFormNewResource}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        {!isEdit && (
          <>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldType}</label>
            <select value={typeId} onChange={e => setTypeId(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px' }}>
              <option value="">{t.dictFormSelectPlaceholder}</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldCountry}</label>
            <select value={countryId} onChange={e => { setCountryId(e.target.value); setRegionId(''); }} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px' }}>
              <option value="">{t.dictFormSelectPlaceholder}</option>
              {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldRegion}</label>
            <select value={regionId} onChange={e => setRegionId(e.target.value)} disabled={!countryId} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px', background: !countryId ? '#f8fafc' : 'white' }}>
              <option value="">{countryId ? t.dictFormSelectPlaceholder : t.dictFormSelectCountryFirst}</option>
              {regionsForCountry.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </>
        )}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
          {t.dictFormFieldCode} {!isEdit && selectedCountry?.code === 'GE' && <span style={{ color: '#3b82f6', fontWeight: '600' }}>{t.dictFormAutoCodeHint}</span>} {isEdit && <span style={{ color: '#94a3b8', fontWeight: '500' }}>({t.dictFormCodeLocked})</span>}
        </label>
        <input
          value={code}
          onChange={e => { setCode(e.target.value); setCodeAutoFilled('edited'); }}
          disabled={isEdit}
          style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px', background: isEdit ? '#f8fafc' : 'white', color: isEdit ? '#64748b' : 'inherit' }}
        />

        {isEdit && (
          <>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldType} {t.dictFormFieldTypeKeepNote}</label>
            <select value={typeId} onChange={e => setTypeId(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px' }}>
              <option value="">{initial.type}</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Единица измерения {!isEdit && '*'} {isEdit && '(можно не менять)'}</label>
        <div style={{ marginBottom: '14px' }}>
          <MeasureSearchSelect
            measures={measures}
            value={measureId}
            onChange={setMeasureId}
            placeholder={isEdit ? initial.unit : t.dictFormSelectPlaceholder}
          />
        </div>

        {!isEdit && regionId && (
          <>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldPrice}</label>
            <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />
          </>
        )}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameRu}</label>
        <input value={nameRu} onChange={e => setNameRu(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameEn}</label>
        <input value={nameEn} onChange={e => setNameEn(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameKa}</label>
        <input value={nameKa} onChange={e => setNameKa(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameAz}</label>
        <input value={nameAz} onChange={e => setNameAz(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '18px', boxSizing: 'border-box', fontSize: '14px' }} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>{dt('cancel', lang)}</button>
          <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '10px' }}>{saving ? '...' : dt('save', lang)}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

const RESOURCE_STATUS_OPTIONS = [
  { value: 'active', labelKey: 'dictStatusActive' },
  { value: 'inactive', labelKey: 'dictStatusInactive' },
  { value: 'all', labelKey: 'dictStatusAll' },
];

function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const filterInputStyle = { padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', width: '100%', boxSizing: 'border-box' };
const filterLabelStyle = { display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' };

function ResourcesDict({ lang, canEdit, userRole, t }) {
  const isRegionRestricted = userRole === 'pricer' || userRole === 'estimator' || userRole === 'manager';
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null);
  const [priceModalState, setPriceModalState] = useState(null);
  const [historyDrawerResource, setHistoryDrawerResource] = useState(null);
  const [historyDrawerData, setHistoryDrawerData] = useState([]);
  const [historyDrawerPeriod, setHistoryDrawerPeriod] = useState('week');
  const [loadingHistoryDrawer, setLoadingHistoryDrawer] = useState(false);

  const [countries, setCountries] = useState([]);
  const [regions, setRegions] = useState([]);
  const [types, setTypes] = useState([]);
  const [measures, setMeasures] = useState([]);
  const [allowedRegionIds, setAllowedRegionIds] = useState(null);

  const [countryFilter, setCountryFilter] = useState('');
  const [regionId, setRegionId] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [typeId, setTypeId] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const debouncedCode = useDebounced(codeFilter);
  const debouncedName = useDebounced(nameFilter);

  useEffect(() => {
    // Фильтр "страна" — сначала выбирают страну, потом регион в её пределах;
    // если ничего не выбрано, показываются все ресурсы (по всем регионам)
    api.get('/dictionaries/countries').then(res => setCountries((res.data || []).filter(c => c.code === 'AZ' || c.code === 'GE'))).catch(err => console.error(err));
    api.get('/dictionaries/regions').then(res => setRegions(res.data || [])).catch(err => console.error(err));
    api.get('/dictionaries/resource-types').then(res => setTypes(res.data || [])).catch(err => console.error(err));
    api.get('/dictionaries/measures').then(res => setMeasures(res.data || [])).catch(err => console.error(err));

    if (userRole === 'pricer' || userRole === 'estimator' || userRole === 'manager') {
      api.get('/dictionaries/profile/regions')
        .then(res => {
          setAllowedRegionIds(res.data || []);
        })
        .catch(err => {
          console.error("Error loading allowed regions:", err);
          setAllowedRegionIds([]);
        });
    }
  }, [userRole]);

  const loadDrawerHistory = (resId) => {
    if (!resId) return;
    setLoadingHistoryDrawer(true);
    const params = {};
    if (regionId) params.region_id = regionId;
    api.get(`/dictionaries/prices/${resId}/history`, { params: { ...params, lang } })
      .then(res => {
        setHistoryDrawerData(res.data || []);
      })
      .catch(err => {
        console.error("Error loading drawer price history:", err);
        setHistoryDrawerData([]);
      })
      .finally(() => {
        setLoadingHistoryDrawer(false);
      });
  };

  const openResourceHistoryDrawer = (resItem) => {
    setHistoryDrawerResource(resItem);
    setHistoryDrawerPeriod('week');
    loadDrawerHistory(resItem.id);
  };

  useEffect(() => {
    if (isRegionRestricted && allowedRegionIds && regions.length > 0) {
      if (allowedRegionIds.length === 1) {
        const singleRegionId = allowedRegionIds[0];
        setRegionId(singleRegionId);
        const regObj = regions.find(r => r.id === singleRegionId);
        if (regObj) {
          const cObj = countries.find(c => c.id === regObj.country_id);
          if (cObj) setCountryFilter(cObj.code);
        }
      } else if (allowedRegionIds.length > 1 && !regionId) {
        const firstRegionId = allowedRegionIds[0];
        setRegionId(firstRegionId);
        const regObj = regions.find(r => r.id === firstRegionId);
        if (regObj) {
          const cObj = countries.find(c => c.id === regObj.country_id);
          if (cObj) setCountryFilter(cObj.code);
        }
      }
    }
  }, [allowedRegionIds, regions, countries, isRegionRestricted]);

  const regionsForCountry = countryFilter
    ? regions.filter(r => r.country_id === countries.find(c => c.code === countryFilter)?.id)
    : regions;

  const filteredCountries = isRegionRestricted && allowedRegionIds
    ? countries.filter(c => regions.some(r => allowedRegionIds.includes(r.id) && r.country_id === c.id))
    : countries;

  const filteredRegions = isRegionRestricted && allowedRegionIds
    ? regionsForCountry.filter(r => allowedRegionIds.includes(r.id))
    : regionsForCountry;

  const load = () => {
    // Если пользователь ограничен по регионам и не имеет привязок, не загружаем ничего
    if (isRegionRestricted && allowedRegionIds && allowedRegionIds.length === 0) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setLoading(false);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams({
      page: String(page), page_size: String(pageSize), status, lang,
    });
    if (regionId) params.set('region_id', regionId);
    if (debouncedCode.trim()) params.set('code', debouncedCode.trim());
    if (debouncedName.trim()) params.set('name', debouncedName.trim());
    if (typeId) params.set('type_id', typeId);

    api.get(`/dictionaries/resources/list?${params.toString()}`)
      .then(res => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
      })
      .catch(err => console.error('Ошибка загрузки ресурсов:', err))
      .finally(() => setLoading(false));
  };

  useEffect(load, [regionId, debouncedCode, debouncedName, typeId, status, page, pageSize, lang]);

  const handleFilterChange = (setter) => (value) => { setter(value); setPage(1); };

  const handleReset = () => {
    if (isRegionRestricted && allowedRegionIds) {
      setCodeFilter(''); setNameFilter(''); setTypeId(''); setStatus('active'); setPage(1);
    } else {
      setCountryFilter(''); setRegionId(''); setCodeFilter(''); setNameFilter(''); setTypeId(''); setStatus('active'); setPage(1);
    }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Удалить ресурс "${r.name}"? Он будет деактивирован (скрыт из списков).`)) return;
    try {
      await api.delete(`/dictionaries/resources/${r.id}`);
      alert(dt('deleteSuccess', lang));
      load();
    } catch (err) {
      if (err.response?.data?.code === 'RESOURCE_IN_USE') {
        alert(dt('RESOURCE_IN_USE', lang));
      } else {
        alert(t.dictDeleteError + ': ' + (err.response?.data?.error || err.message));
      }
    }
  };

  const isSelectorDisabled = isRegionRestricted && allowedRegionIds && allowedRegionIds.length === 1;

  const hasNoRegions = isRegionRestricted && allowedRegionIds && allowedRegionIds.length === 0;

  return (
    <>
      <Toolbar title={t.dictCardResources} count={total} onAdd={() => setModalState('new')} hideAdd={!canEdit} t={t} />

      {/* Вывод плашки разрешенных регионов для пользователя */}
      {isRegionRestricted && allowedRegionIds && allowedRegionIds.length > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', color: '#166534', padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span>📍 Ваши разрешенные регионы:</span>
          <span style={{ background: '#bbf7d0', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', display: 'inline-block' }}>
            {allowedRegionIds.map(rid => regions.find(r => r.id === rid)?.name).filter(Boolean).join(', ') || '—'}
          </span>
        </div>
      )}

      {/* Предупреждение о том, что регионы не назначены */}
      {hasNoRegions && (
        <div style={{ padding: '40px', textAlign: 'center', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '12px', color: '#b45309', margin: '20px 0' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>⚠️ Доступ ограничен</div>
          <div style={{ fontSize: '13px' }}>Для вашего аккаунта не назначены доступные регионы. Обратитесь к администратору системы.</div>
        </div>
      )}

      {!hasNoRegions && (
        <>
          {/* Фильтры */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '18px', padding: '16px', background: '#f8fafc', borderRadius: '10px' }}>
            <div>
              <label style={filterLabelStyle}>{t.dictFormFieldCountry}</label>
          <select
            value={countryFilter}
            onChange={e => { handleFilterChange(setCountryFilter)(e.target.value); setRegionId(''); }}
            style={filterInputStyle}
            disabled={isSelectorDisabled}
          >
            {!isRegionRestricted && <option value="">{t.dictFilterAllRegions}</option>}
            {filteredCountries.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterRegion}</label>
          <select 
            value={regionId} 
            onChange={e => handleFilterChange(setRegionId)(e.target.value)} 
            style={filterInputStyle}
            disabled={isSelectorDisabled}
          >
            {!isRegionRestricted && <option value="">{t.dictFilterAllRegions}</option>}
            {filteredRegions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterCode}</label>
          <input value={codeFilter} onChange={e => handleFilterChange(setCodeFilter)(e.target.value)} placeholder={t.dictFilterCodePlaceholder} style={filterInputStyle} />
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterName}</label>
          <input value={nameFilter} onChange={e => handleFilterChange(setNameFilter)(e.target.value)} placeholder={t.dictFilterNamePlaceholder} style={filterInputStyle} />
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterType}</label>
          <select value={typeId} onChange={e => handleFilterChange(setTypeId)(e.target.value)} style={filterInputStyle}>
            <option value="">{t.dictFilterAllTypes}</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterStatus}</label>
          <select value={status} onChange={e => handleFilterChange(setStatus)(e.target.value)} style={filterInputStyle}>
            {RESOURCE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{t[o.labelKey]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button type="button" onClick={handleReset} style={{ width: '100%', padding: '8px 10px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: '600', color: '#64748b', cursor: 'pointer' }}>
            {t.dictBtnReset}
          </button>
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '14px' }}>{t.dictLoading}</p>}

      {!loading && total === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>{t.dictNotFound}</div>
      )}

      {!loading && total > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              <th style={th}>{t.dictColCode}</th>
              <th style={th}>{t.dictColName}</th>
              <th style={th}>{t.dictColType}</th>
              <th style={th}>{t.dictColRegion}</th>
              <th style={th}>{t.dictColUnit}</th>
              <th style={th}>{t.dictColPrice}{regionId ? '' : ` ${t.dictColPriceHint}`}</th>
              <th style={th}>{t.dictColActive}</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id}>
                  <td
                    style={{ ...td, color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}
                    onClick={() => openResourceHistoryDrawer(r)}
                    title="Посмотреть график и историю цен"
                  >
                    {r.code}
                  </td>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.type}</td>
                  <td style={td}>{regionId ? (r.region || '—') : (r.pricesList && r.pricesList.length > 0 ? r.pricesList.map(pl => pl.region).filter(Boolean).join(', ') : '—')}</td>
                  <td style={td}>{r.unit}</td>
                  <td style={td}>
                    {regionId ? (
                      r.price !== null && r.price !== undefined ? `${r.price.toLocaleString('ru-RU')} ${r.currency || ''}` : '—'
                    ) : (
                      r.pricesList && r.pricesList.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {r.pricesList.map((pl, idx) => (
                            <div key={idx} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                              <strong>{pl.price.toLocaleString('ru-RU')} {pl.currency}</strong>
                              {pl.region && <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '4px' }}>({pl.region})</span>}
                            </div>
                          ))}
                        </div>
                      ) : '—'
                    )}
                  </td>
                  <td style={td}>{r.is_active ? '✅' : '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {/* Кнопка редактирования цены (доступна для admin и pricer) */}
                      {(userRole === 'admin' || userRole === 'pricer') && (
                        <button
                          type="button"
                          onClick={() => {
                            // Если это Грузия (код 10.110. или у ресурса есть регион), то регион в фильтре обязателен
                            // Для ресурсов Баку (Азербайджан, коды 10.100., 10.120., 10.130.) регион в БД равен null
                            const isGeorgia = r.code.startsWith('10.110.');
                            if (isGeorgia && !regionId) {
                              alert('Пожалуйста, выберите конкретный регион в фильтре сверху, чтобы просмотреть историю и изменить цену ресурса.');
                              return;
                            }
                            setPriceModalState(r);
                          }}
                          title="Редактирование цены"
                          style={{
                            background: '#ecfdf5', border: 'none', color: '#059669',
                            width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                        >
                          <Coins size={13} />
                        </button>
                      )}
                      
                      {/* Кнопки редактирования карточки (доступны только admin) */}
                      {userRole === 'admin' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setModalState(r)}
                            title={t.dictBtnEdit}
                            style={{ background: '#eff6ff', border: 'none', color: '#3b82f6', width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(r)}
                            title={t.dictBtnDelete}
                            style={{ background: '#fff1f2', border: 'none', color: '#ef4444', width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Пагинация с выбором размера страницы */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {t.dictShownRange} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {t.dictOfTotal} {total}
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ marginLeft: '10px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}>
                <option value={20}>20 {t.dictPerPage}</option>
                <option value={50}>50 {t.dictPerPage}</option>
                <option value={100}>100 {t.dictPerPage}</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button onClick={() => setPage(1)} disabled={page === 1} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1, fontSize: '12px' }}>«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}><ChevronLeft size={14} /></button>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>{t.dictPageOf} {page} {t.dictOfTotal} {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}><ChevronRight size={14} /></button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: '12px' }}>»</button>
            </div>
          </div>
        </>
      )}
      </>
      )}

      {modalState && (
        <ResourceFormModal
          initial={modalState === 'new' ? null : modalState}
          types={types}
          measures={measures}
          lang={lang}
          t={t}
          onClose={() => setModalState(null)}
          onSaved={() => { setModalState(null); load(); }}
        />
      )}

      {priceModalState && (
        <ResourcePriceModal
          resource={priceModalState}
          regionId={regionId}
          regionName={regions.find(r => r.id === regionId)?.name}
          lang={lang}
          t={t}
          onClose={() => setPriceModalState(null)}
          onSaved={(close = true) => { if (close) setPriceModalState(null); load(); }}
        />
      )}

      {/* Drawer истории изменения цены с SVG-графиком */}
      {historyDrawerResource && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '500px',
          background: 'white',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          padding: '24px',
          borderLeft: '1px solid #e2e8f0',
          transition: 'all 0.3s ease'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
                История цены ресурса
              </h3>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', fontWeight: '600' }}>
                Код: {historyDrawerResource.code}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHistoryDrawerResource(null)}
              style={{
                background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#64748b',
                outline: 'none'
              }}
            >
              ✕
            </button>
          </div>

          {/* Название ресурса */}
          <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', color: '#475569', marginBottom: '20px', lineHeight: '1.4' }}>
            <strong>Название:</strong> {historyDrawerResource.name}
          </div>

          {/* Вкладки периодов графика */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', background: '#f1f5f9', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
            {[
              { id: 'week', label: 'Неделя' },
              { id: 'month', label: 'Месяц' },
              { id: 'year', label: 'Год' }
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setHistoryDrawerPeriod(p.id)}
                style={{
                  padding: '6px 12px', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600',
                  background: historyDrawerPeriod === p.id ? 'white' : 'transparent',
                  color: historyDrawerPeriod === p.id ? '#1e293b' : '#64748b',
                  boxShadow: historyDrawerPeriod === p.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  outline: 'none'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* График изменений (SVG) */}
          <div style={{ flexShrink: 0, height: '200px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', marginBottom: '20px' }}>
            {(() => {
              const now = new Date();
              const width = 430;
              const height = 150;
              const paddingX = 45;
              const paddingY = 20;
              const chartWidth = width - paddingX - 20;
              const chartHeight = height - paddingY * 2;

              let points = [];

              if (historyDrawerPeriod === 'year') {
                // Группируем всю историю по годам
                const groups = {};
                historyDrawerData.forEach(h => {
                  const date = new Date(h.changed_at);
                  const yr = date.getFullYear();
                  if (!groups[yr] || new Date(h.changed_at) > new Date(groups[yr].changed_at)) {
                    groups[yr] = h;
                  }
                });

                const sortedGroups = Object.keys(groups)
                  .map(yr => ({ label: String(yr), price: Number(groups[yr].new_price), time: Number(yr) }))
                  .sort((a, b) => a.time - b.time);

                if (sortedGroups.length === 0) {
                  return <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>Нет данных</div>;
                }

                if (sortedGroups.length === 1) {
                  const item = sortedGroups[0];
                  points.push({ x: paddingX, y: 0, price: item.price, date: item.label });
                  points.push({ x: paddingX + chartWidth, y: 0, price: item.price, date: item.label });
                } else {
                  sortedGroups.forEach((item, i) => {
                    const x = paddingX + (i / (sortedGroups.length - 1)) * chartWidth;
                    points.push({ x, y: 0, price: item.price, date: item.label });
                  });
                }
              } 
              else if (historyDrawerPeriod === 'month') {
                // Группируем по месяцам (название месяца + год)
                const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
                const groups = {};
                historyDrawerData.forEach(h => {
                  const date = new Date(h.changed_at);
                  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                  if (!groups[key] || new Date(h.changed_at) > new Date(groups[key].changed_at)) {
                    groups[key] = h;
                  }
                });

                const sortedGroups = Object.keys(groups)
                  .map(key => {
                    const [yr, mn] = key.split('-');
                    const label = `${monthNames[parseInt(mn, 10) - 1]} ${yr.substring(2)}`;
                    return { label, price: Number(groups[key].new_price), time: key };
                  })
                  .sort((a, b) => a.time.localeCompare(b.time));

                if (sortedGroups.length === 0) {
                  return <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>Нет данных</div>;
                }

                if (sortedGroups.length === 1) {
                  const item = sortedGroups[0];
                  points.push({ x: paddingX, y: 0, price: item.price, date: item.label });
                  points.push({ x: paddingX + chartWidth, y: 0, price: item.price, date: item.label });
                } else {
                  sortedGroups.forEach((item, i) => {
                    const x = paddingX + (i / (sortedGroups.length - 1)) * chartWidth;
                    points.push({ x, y: 0, price: item.price, date: item.label });
                  });
                }
              } 
              else {
                // Неделя (week) - по умолчанию
                const cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                let periodData = historyDrawerData.filter(h => new Date(h.changed_at) >= cutoffDate);
                periodData = [...periodData].sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

                if (periodData.length === 0) {
                  return <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>Нет данных за выбранный период</div>;
                }

                const prices = periodData.map(h => Number(h.new_price));
                periodData.forEach(h => {
                  if (h.old_price !== null && h.old_price !== undefined) {
                    prices.push(Number(h.old_price));
                  }
                });

                const dates = periodData.map(h => new Date(h.changed_at).getTime());
                const minDate = Math.min(...dates);
                const maxDate = Math.max(...dates);
                const isOneDay = (maxDate - minDate) < 24 * 60 * 60 * 1000;

                if (periodData.length === 1) {
                  const h = periodData[0];
                  const formattedDate = new Date(h.changed_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                  points.push({ x: paddingX, y: 0, price: Number(h.new_price), date: formattedDate });
                  points.push({ x: paddingX + chartWidth, y: 0, price: Number(h.new_price), date: formattedDate });
                } else {
                  periodData.forEach((h, i) => {
                    const x = paddingX + (i / (periodData.length - 1)) * chartWidth;
                    const dateObj = new Date(h.changed_at);
                    const formattedDate = isOneDay
                      ? dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                      : dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                    points.push({ x, y: 0, price: Number(h.new_price), date: formattedDate });
                  });
                }
              }

              // Вычисляем y-координаты для всех сгенерированных точек
              const allPrices = points.map(p => p.price);
              const maxPrice = Math.max(...allPrices) * 1.1;
              const minPrice = Math.max(0, Math.min(...allPrices) * 0.9);
              const priceDiff = maxPrice - minPrice || 1;

              points.forEach(p => {
                p.y = paddingY + chartHeight - ((p.price - minPrice) / priceDiff) * chartHeight;
              });

              const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const fillD = points.length > 1 
                ? `${pathD} L ${points[points.length - 1].x} ${paddingY + chartHeight} L ${points[0].x} ${paddingY + chartHeight} Z`
                : '';

              return (
                <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25"/>
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0"/>
                    </linearGradient>
                  </defs>
                  {[0, 0.5, 1].map((ratio, i) => {
                    const y = paddingY + ratio * chartHeight;
                    const val = (maxPrice - ratio * priceDiff).toFixed(2);
                    return (
                      <g key={i}>
                        <line x1={paddingX} y1={y} x2={width - 20} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
                        <text x={paddingX - 8} y={y + 4} textAnchor="end" style={{ fontSize: '10px', fill: '#94a3b8', fontFamily: 'sans-serif' }}>{val}</text>
                      </g>
                    );
                  })}

                  {points.length > 1 && fillD && (
                    <path d={fillD} fill="url(#chartGrad)" />
                  )}

                  {points.length > 1 && (
                    <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  {points.length === 2 && points[0].price === points[1].price && (
                    <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3 3" />
                  )}

                  {points.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r="4" fill="#3b82f6" stroke="white" strokeWidth="1" />
                      <text x={p.x} y={p.y - 8} textAnchor="middle" style={{ fontSize: '9px', fontWeight: 'bold', fill: '#1e293b', fontFamily: 'sans-serif' }}>{p.price}</text>
                      <text x={p.x} y={height - 4} textAnchor="middle" style={{ fontSize: '8px', fill: '#94a3b8', fontFamily: 'sans-serif' }}>{p.date}</text>
                    </g>
                  ))}
                </svg>
              );
            })()}
          </div>

          {/* Таблица изменений */}
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700', color: '#475569' }}>Таблица изменений</h4>
          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 12px', color: '#64748b', width: '40px' }}>№</th>
                  <th style={{ padding: '8px 12px', color: '#64748b' }}>Регион</th>
                  <th style={{ padding: '8px 12px', color: '#64748b' }}>Дата</th>
                  <th style={{ padding: '8px 12px', color: '#64748b' }}>Было</th>
                  <th style={{ padding: '8px 12px', color: '#64748b' }}>Стало</th>
                  <th style={{ padding: '8px 12px', color: '#64748b' }}>Изменил</th>
                </tr>
              </thead>
              <tbody>
                {loadingHistoryDrawer ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>Загрузка истории...</td>
                  </tr>
                ) : (
                  <>
                    {historyDrawerData.map((h, idx) => {
                      const formattedDate = new Date(h.changed_at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      const oldPriceFormatted = (h.old_price === null || h.old_price === undefined || Number(h.old_price) === 0)
                        ? '0 (нет цены)'
                        : `${h.old_price} ${historyDrawerResource.currency || '₼'}`;

                      const newPriceFormatted = `${h.new_price} ${historyDrawerResource.currency || '₼'}`;

                      return (
                        <tr key={h.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', color: '#64748b', fontWeight: '600' }}>{historyDrawerData.length - idx}</td>
                          <td style={{ padding: '8px 12px' }}>{h.region_name || 'Баку'}</td>
                          <td style={{ padding: '8px 12px' }}>{formattedDate}</td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{oldPriceFormatted}</td>
                          <td style={{ padding: '8px 12px', color: '#16a34a', fontWeight: '600' }}>{newPriceFormatted}</td>
                          <td style={{ padding: '8px 12px', color: '#475569' }}>
                            {h.profiles ? `${h.profiles.first_name} ${h.profiles.last_name || ''}`.trim() : 'Система'}
                          </td>
                        </tr>
                      );
                    })}
                    
                    {historyDrawerData.length === 0 && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontStyle: 'italic' }}>История изменений пуста</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function ResourcePriceModal({ resource, regionId, regionName, lang = 'ru', t, onClose, onSaved }) {
  const [price, setPrice] = useState(resource.price !== null ? String(resource.price) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    
    if (price === '' || price === null || price === undefined) {
      setError('Укажите цену ресурса');
      return;
    }
    const newPrice = Number(price);
    if (isNaN(newPrice) || newPrice < 0) {
      setError('Цена не может быть отрицательной или некорректной');
      return;
    }
    
    setSaving(true);
    try {
      const res = await api.put(`/dictionaries/prices/${resource.id}`, {
        price: newPrice,
        region_id: regionId || null
      });
      
      if (res.data?.is_same) {
        setError('Новая цена совпадает с текущей ценой ресурса');
      } else {
        onSaved(true);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };



  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '550px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#1e293b' }}>
            Редактирование цены
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}>⚠️ {error}</div>}
        {successMessage && <div style={{ background: '#ecfdf5', color: '#047857', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}>✓ {successMessage}</div>}

        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div><strong style={{ color: '#475569' }}>Ресурс:</strong> <span style={{ color: '#0f172a', fontWeight: '600' }}>{resource.code} — {resource.name}</span></div>
          <div><strong style={{ color: '#475569' }}>Регион:</strong> <span style={{ color: '#059669', fontWeight: '600' }}>{regionName || 'Все регионы (Азербайджан/Баку)'}</span></div>
          <div><strong style={{ color: '#475569' }}>Ед. изм.:</strong> <span style={{ color: '#475569' }}>{resource.unit || '—'}</span></div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px', textTransform: 'uppercase' }}>Установить новую стоимость</label>
            <input
              type="number"
              step="any"
              value={price}
              onChange={e => { setPrice(e.target.value); setError(''); setSuccessMessage(''); }}
              placeholder="0.00"
              style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: error ? '1.5px solid #ef4444' : '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '14px', outline: 'none' }}
              required
            />
          </div>
          <button type="submit" disabled={saving} className="btn-primary" style={{ padding: '10px 24px', height: '40px' }}>
            {saving ? '...' : 'Сохранить'}
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
            Закрыть
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
}

function WorkFormModal({ initial, measures, lang = 'ru', t, onClose, onSaved }) {
  const isEdit = !!initial;
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState('');
  const [code, setCode] = useState(initial?.code || '');
  const [measureId, setMeasureId] = useState(initial?.measure_id || '');
  const [nameRu, setNameRu] = useState(initial?.name_ru || '');
  const [nameEn, setNameEn] = useState(initial?.name_en || '');
  const [nameKa, setNameKa] = useState(initial?.name_ka || initial?.name_ge || '');
  const [nameAz, setNameAz] = useState(initial?.name_az || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Страна выбирается только при создании — она определяет, в какую таблицу
  // (jobs/jobs_cas) попадёт новая работа. При редактировании таблица уже известна.
  useEffect(() => {
    if (isEdit) return;
    api.get('/dictionaries/countries')
      .then(res => setCountries((res.data || []).filter(c => c.code === 'AZ' || c.code === 'GE')))
      .catch(err => console.error(err));
  }, [isEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!code || !nameRu || !measureId || (!isEdit && !country)) {
      setError(t.validationError);
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const payload = { table: initial.table, measure_id: measureId, name_ru: nameRu, name_en: nameEn, name_ka: nameKa, name_az: nameAz };
        await api.put(`/dictionaries/works/${initial.id}`, payload);
      } else {
        const payload = { country, code, measure_id: measureId, name_ru: nameRu, name_en: nameEn, name_ka: nameKa, name_az: nameAz };
        await api.post('/dictionaries/works', payload);
      }
      onSaved();
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode && DICT_I18N[errCode]) {
        setError(dt(errCode, lang));
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '420px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>{isEdit ? t.dictFormEditWork : t.dictFormNewWork}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        {!isEdit && (
          <>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldCountry}</label>
            <select value={country} onChange={e => setCountry(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px' }}>
              <option value="">{t.dictFormSelectPlaceholder}</option>
              {countries.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
            </select>
          </>
        )}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
          {t.dictFormFieldCode} {isEdit && <span style={{ color: '#94a3b8', fontWeight: '500' }}>({t.dictFormCodeLocked})</span>}
        </label>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          disabled={isEdit}
          style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px', background: isEdit ? '#f8fafc' : 'white', color: isEdit ? '#64748b' : 'inherit' }}
        />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldUnit}</label>
        <select value={measureId} onChange={e => setMeasureId(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px' }}>
          <option value="">{isEdit ? initial.unit : t.dictFormSelectPlaceholder}</option>
          {measures.map(m => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
        </select>

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameRu}</label>
        <input value={nameRu} onChange={e => setNameRu(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameEn}</label>
        <input value={nameEn} onChange={e => setNameEn(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameKa}</label>
        <input value={nameKa} onChange={e => setNameKa(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameAz}</label>
        <input value={nameAz} onChange={e => setNameAz(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '18px', boxSizing: 'border-box', fontSize: '14px' }} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>{dt('cancel', lang)}</button>
          <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '10px' }}>{saving ? '...' : dt('save', lang)}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function WorksDict({ lang, canEdit, t }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null);

  const [countries, setCountries] = useState([]);
  const [measures, setMeasures] = useState([]);

  const [countryFilter, setCountryFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [measureFilter, setMeasureFilter] = useState('');
  const [hasNormFilter, setHasNormFilter] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const debouncedCode = useDebounced(codeFilter);
  const debouncedName = useDebounced(nameFilter);

  useEffect(() => {
    api.get('/dictionaries/countries')
      .then(res => setCountries((res.data || []).filter(c => c.code === 'AZ' || c.code === 'GE')))
      .catch(err => console.error(err));
    api.get('/dictionaries/measures').then(res => setMeasures(res.data || [])).catch(err => console.error(err));
  }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), status, lang });
    if (countryFilter) params.set('country', countryFilter);
    if (debouncedCode.trim()) params.set('code', debouncedCode.trim());
    if (debouncedName.trim()) params.set('name', debouncedName.trim());
    if (measureFilter) params.set('measure_id', measureFilter);
    if (hasNormFilter) params.set('has_norm', hasNormFilter);

    api.get(`/dictionaries/works/list?${params.toString()}`)
      .then(res => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
      })
      .catch(err => console.error('Ошибка загрузки работ:', err))
      .finally(() => setLoading(false));
  };

  useEffect(load, [countryFilter, debouncedCode, debouncedName, measureFilter, hasNormFilter, status, page, pageSize, lang]);

  const handleFilterChange = (setter) => (value) => { setter(value); setPage(1); };

  const handleReset = () => {
    setCountryFilter(''); setCodeFilter(''); setNameFilter(''); setMeasureFilter(''); setHasNormFilter(''); setStatus('active'); setPage(1);
  };

  const handleDelete = async (w) => {
    if (!window.confirm(`Удалить работу "${w.name}"? Она будет деактивирована (скрыта из списков).`)) return;
    try {
      await api.delete(`/dictionaries/works/${w.id}?table=${w.table}`);
      load();
    } catch (err) {
      if (err.response?.data?.code === 'WORK_IN_USE') {
        alert(dt('WORK_IN_USE', lang));
      } else {
        alert(t.dictDeleteError + ': ' + (err.response?.data?.error || err.message));
      }
    }
  };

  return (
    <>
      <Toolbar title={t.dictCardWorks} count={total} onAdd={() => setModalState('new')} hideAdd={!canEdit} t={t} />

      {/* Фильтры */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '18px', padding: '16px', background: '#f8fafc', borderRadius: '10px' }}>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterRegion}</label>
          <select value={countryFilter} onChange={e => handleFilterChange(setCountryFilter)(e.target.value)} style={filterInputStyle}>
            <option value="">{t.dictFilterAllRegions}</option>
            {countries.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterCode}</label>
          <input value={codeFilter} onChange={e => handleFilterChange(setCodeFilter)(e.target.value)} placeholder={t.dictFilterCodePlaceholder} style={filterInputStyle} />
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterName}</label>
          <input value={nameFilter} onChange={e => handleFilterChange(setNameFilter)(e.target.value)} placeholder={t.dictFilterNamePlaceholder} style={filterInputStyle} />
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterMeasure}</label>
          <select value={measureFilter} onChange={e => handleFilterChange(setMeasureFilter)(e.target.value)} style={filterInputStyle}>
            <option value="">{t.dictFilterAllMeasures}</option>
            {measures.map(m => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterHasNorm}</label>
          <select value={hasNormFilter} onChange={e => handleFilterChange(setHasNormFilter)(e.target.value)} style={filterInputStyle}>
            <option value="">{t.dictStatusAll}</option>
            <option value="true">✅</option>
            <option value="false">—</option>
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>{t.dictFilterStatus}</label>
          <select value={status} onChange={e => handleFilterChange(setStatus)(e.target.value)} style={filterInputStyle}>
            {RESOURCE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{t[o.labelKey]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button type="button" onClick={handleReset} style={{ width: '100%', padding: '8px 10px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: '600', color: '#64748b', cursor: 'pointer' }}>
            {t.dictBtnReset}
          </button>
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '14px' }}>{t.dictLoading}</p>}

      {!loading && total === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>{t.dictNotFound}</div>
      )}

      {!loading && total > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              <th style={th}>{t.dictColCode}</th>
              <th style={th}>{t.dictColName}</th>
              <th style={th}>{t.dictColRegion}</th>
              <th style={th}>{t.dictColUnit}</th>
              <th style={th}>{t.dictColHasNorms}</th>
              <th style={th}>{t.dictColActive}</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {items.map(w => (
                <tr key={w.id}>
                  <td style={td}>{w.code}</td>
                  <td style={td}>{w.name}</td>
                  <td style={td}>{w.region}</td>
                  <td style={td}>{w.unit}</td>
                  <td style={td}>{w.has_norms ? '✅' : '—'}</td>
                  <td style={td}>{w.is_active ? '✅' : '—'}</td>
                  <td style={td}><RowActions onEdit={() => setModalState(w)} onDelete={() => handleDelete(w)} canEdit={canEdit} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Пагинация с выбором размера страницы */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {t.dictShownRange} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {t.dictOfTotal} {total}
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ marginLeft: '10px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}>
                <option value={20}>20 {t.dictPerPage}</option>
                <option value={50}>50 {t.dictPerPage}</option>
                <option value={100}>100 {t.dictPerPage}</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button onClick={() => setPage(1)} disabled={page === 1} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1, fontSize: '12px' }}>«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}><ChevronLeft size={14} /></button>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>{t.dictPageOf} {page} {t.dictOfTotal} {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}><ChevronRight size={14} /></button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: '12px' }}>»</button>
            </div>
          </div>
        </>
      )}

      {modalState && (
        <WorkFormModal
          initial={modalState === 'new' ? null : modalState}
          measures={measures}
          lang={lang}
          t={t}
          onClose={() => setModalState(null)}
          onSaved={() => { setModalState(null); load(); }}
        />
      )}
    </>
  );
}

function ResourcePicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setOptions([]); return; }
    const t = setTimeout(() => {
      api.get(`/dictionaries/resources/search?q=${encodeURIComponent(query.trim())}`)
        .then(res => setOptions(res.data || []))
        .catch(err => console.error(err));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value ? `${value.code} — ${value.name}` : query}
        onChange={e => { onChange(null); setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={t.dictResourceSearchPlaceholder}
        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
      />
      {open && options.length > 0 && !value && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }}>
          {options.map(o => (
            <div
              key={o.id}
              onClick={() => { onChange(o); setOpen(false); setQuery(''); }}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f1f5f9' }}
              onMouseDown={e => e.preventDefault()}
            >
              <strong>{o.code}</strong> — {o.name} <span style={{ color: '#94a3b8' }}>({o.unit})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkPicker({ works, worksLoading, value, onChange, placeholder, t }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return works.filter(w => w.code.toLowerCase().includes(q) || (w.name || '').toLowerCase().includes(q)).slice(0, 30);
  }, [works, query]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value ? `${value.code} — ${value.name}` : query}
        onChange={e => { onChange(null); setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={worksLoading ? t.dictWorksLoadingList : (placeholder || t.dictWorkSearchPlaceholder)}
        disabled={worksLoading}
        style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', minWidth: '320px', boxSizing: 'border-box', width: '100%', background: worksLoading ? '#f8fafc' : 'white' }}
      />
      {open && !worksLoading && options.length > 0 && !value && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', marginTop: '4px', maxHeight: '240px', overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }}>
          {options.map(w => (
            <div
              key={w.id}
              onClick={() => { onChange(w); setOpen(false); setQuery(''); }}
              onMouseDown={e => e.preventDefault()}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f1f5f9' }}
            >
              <strong>{w.code}</strong> — {w.name}
            </div>
          ))}
        </div>
      )}
      {open && !worksLoading && query.trim().length > 0 && options.length === 0 && !value && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', marginTop: '4px', padding: '10px', fontSize: '12px', color: '#94a3b8', zIndex: 10 }}>
          {t.dictNothingFoundShort}
        </div>
      )}
    </div>
  );
}

function NormFormModal({ workId, initial, lang = 'ru', t, onClose, onSaved }) {
  const isEdit = !!initial;
  const [resource, setResource] = useState(isEdit ? { id: initial.resource_id, code: initial.est_resources?.code, name: initial.est_resources?.name, unit: initial.est_resources?.unit } : null);
  const [normValue, setNormValue] = useState(initial?.norm ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if ((!isEdit && !resource) || normValue === '') {
      setError(t.validationError);
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/dictionaries/norms/${initial.id}`, { norm: Number(normValue) });
      } else {
        await api.post('/dictionaries/norms', { work_id: workId, resource_id: resource.id, norm: Number(normValue) });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '420px', maxWidth: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>{isEdit ? t.dictFormEditNorm : t.dictFormNewNorm}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldResource}</label>
        {isEdit ? (
          <div style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', marginBottom: '12px', fontSize: '13px' }}>{resource?.code} — {resource?.name}</div>
        ) : (
          <div style={{ marginBottom: '12px' }}>
            <ResourcePicker value={resource} onChange={setResource} />
          </div>
        )}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNormValue} {resource?.unit && `(${resource.unit})`}</label>
        <input type="number" step="any" value={normValue} onChange={e => setNormValue(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '18px', boxSizing: 'border-box', fontSize: '14px' }} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>{dt('cancel', lang)}</button>
          <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '10px' }}>{saving ? '...' : dt('save', lang)}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function MeasureFormModal({ initial, lang = 'ru', t, onClose, onSaved }) {
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code || '');
  const [nameRu, setNameRu] = useState(initial?.name_ru || '');
  const [nameEn, setNameEn] = useState(initial?.name_en || '');
  const [nameKa, setNameKa] = useState(initial?.name_ka || '');
  const [nameAz, setNameAz] = useState(initial?.name_az || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!code || !nameRu) {
      setError(t.validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = { code, name_ru: nameRu, name_en: nameEn, name_ka: nameKa, name_az: nameAz };
      if (isEdit) {
        await api.put(`/dictionaries/measures/${initial.id}`, payload);
      } else {
        await api.post('/dictionaries/measures', payload);
      }
      onSaved();
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode && DICT_I18N[errCode]) {
        setError(dt(errCode, lang));
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '420px', maxWidth: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>{isEdit ? t.dictFormEditMeasure : t.dictFormNewMeasure}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
          {t.dictFormFieldCode} {isEdit && <span style={{ color: '#94a3b8', fontWeight: '500' }}>({t.dictFormCodeLocked})</span>}
        </label>
        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          disabled={isEdit}
          style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px', background: isEdit ? '#f8fafc' : 'white', color: isEdit ? '#64748b' : 'inherit' }}
        />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameRu}</label>
        <input value={nameRu} onChange={e => setNameRu(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameEn}</label>
        <input value={nameEn} onChange={e => setNameEn(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameKa}</label>
        <input value={nameKa} onChange={e => setNameKa(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameAz}</label>
        <input value={nameAz} onChange={e => setNameAz(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '18px', boxSizing: 'border-box', fontSize: '14px' }} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>{dt('cancel', lang)}</button>
          <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '10px' }}>{saving ? '...' : dt('save', lang)}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function MeasuresDict({ lang, canEdit, t }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalState, setModalState] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/dictionaries/measures?lang=${lang}`)
      .then(res => setRows(res.data || []))
      .catch(err => console.error('Ошибка загрузки единиц измерения:', err))
      .finally(() => setLoading(false));
  };

  useEffect(load, [lang]);

  const { filtered, pageRows, page, setPage } = useFilteredPage(rows, search, ['code', 'name']);

  const handleDelete = async (m) => {
    if (!window.confirm(`${t.dictBtnDelete} "${m.name}"?`)) return;
    try {
      await api.delete(`/dictionaries/measures/${m.id}`);
      load();
    } catch (err) {
      alert(t.dictDeleteError + ': ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) return <p style={{ color: '#94a3b8' }}>{t.dictLoading}</p>;
  return (
    <>
      <Toolbar title={t.dictCardMeasures} count={filtered.length} onAdd={() => setModalState('new')} hideAdd={!canEdit} search={search} onSearchChange={setSearch} searchPlaceholder={t.dictFilterCode + ' / ' + t.dictFilterName} t={t} />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: '#f8fafc' }}>
          <th style={th}>{t.dictColCode}</th><th style={th}>{t.dictColName}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {pageRows.map(m => (
            <tr key={m.id}>
              <td style={td}>{m.code}</td>
              <td style={td}>{m.name}</td>
              <td style={td}><RowActions onEdit={() => setModalState(m)} onDelete={() => handleDelete(m)} canEdit={canEdit} t={t} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} setPage={setPage} totalItems={filtered.length} t={t} />

      {modalState && (
        <MeasureFormModal
          initial={modalState === 'new' ? null : modalState}
          lang={lang}
          t={t}
          onClose={() => setModalState(null)}
          onSaved={() => { setModalState(null); load(); }}
        />
      )}
    </>
  );
}

function NormsDict({ lang, canEdit, t }) {
  const [works, setWorks] = useState([]);
  const [worksLoading, setWorksLoading] = useState(true);
  const [selectedWork, setSelectedWork] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalState, setModalState] = useState(null);

  useEffect(() => {
    api.get('/dictionaries/works')
      .then(res => setWorks(res.data || []))
      .catch(err => console.error(err))
      .finally(() => setWorksLoading(false));
  }, []);

  const loadNorms = () => {
    if (!selectedWork) { setRows([]); return; }
    setLoading(true);
    api.get(`/dictionaries/norms/${selectedWork.id}`)
      .then(res => setRows(res.data || []))
      .catch(err => console.error('Ошибка загрузки норм:', err))
      .finally(() => setLoading(false));
  };

  useEffect(loadNorms, [selectedWork]);

  const handleDelete = async (n) => {
    if (!window.confirm(`Удалить норму для ресурса "${n.est_resources?.name}"?`)) return;
    try {
      await api.delete(`/dictionaries/norms/${n.id}`);
      loadNorms();
    } catch (err) {
      alert(t.dictDeleteError + ': ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <>
      <Toolbar
        title={t.dictCardNorms}
        onAdd={() => setModalState('new')}
        hideAdd={!selectedWork || !canEdit}
        t={t}
      />
      <div style={{ marginBottom: '18px' }}>
        <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#475569', marginBottom: '18px' }}>{t.dictNormsFindWork}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ minWidth: '320px' }}>
            <WorkPicker works={works} worksLoading={worksLoading} value={selectedWork} onChange={setSelectedWork} t={t} />
          </div>
          {selectedWork && (
            <button type="button" onClick={() => setSelectedWork(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '9px 14px', fontSize: '13px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>
              {t.dictNormsChangeWork}
            </button>
          )}
        </div>
      </div>
      {loading && <p style={{ color: '#94a3b8', fontSize: '14px' }}>{t.dictLoading}</p>}
      {!loading && selectedWork && (
        <>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#94a3b8' }}>{t.dictNormsFound}: {rows.length}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8fafc' }}>
            <th style={th}>{t.dictColResource}</th><th style={th}>{t.dictColType}</th><th style={th}>{t.dictColNorm}</th><th style={th}>{t.dictColUnit}</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {rows.map(n => (
              <tr key={n.id}>
                <td style={td}><LocalizedCell row={n.est_resources || {}} lang={lang} field="name" /></td>
                <td style={td}><LocalizedCell row={n.est_resources || {}} lang={lang} field="type" /></td>
                <td style={td}>{n.norm}</td>
                <td style={td}><LocalizedCell row={n.est_resources || {}} lang={lang} field="unit" /></td>
                <td style={td}><RowActions onEdit={() => setModalState(n)} onDelete={() => handleDelete(n)} canEdit={canEdit} t={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}

      {modalState && (
        <NormFormModal
          workId={selectedWork?.id}
          initial={modalState === 'new' ? null : modalState}
          lang={lang}
          t={t}
          onClose={() => setModalState(null)}
          onSaved={() => { setModalState(null); loadNorms(); }}
        />
      )}
    </>
  );
}

function WbsStageFormModal({ templateId, initial, existingStages, lang = 'ru', t, onClose, onSaved }) {
  const isEdit = !!initial;
  const [parentCode, setParentCode] = useState('');
  const [nameRu, setNameRu] = useState(initial?.name_ru || '');
  const [nameEn, setNameEn] = useState(initial?.name_en || '');
  const [nameKa, setNameKa] = useState(initial?.name_ka || '');
  const [nameAz, setNameAz] = useState(initial?.name_az || '');
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!nameRu) {
      setError(t.validationError);
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/dictionaries/wbs/templates/${initial.id}`, { name_ru: nameRu, name_en: nameEn, name_ka: nameKa, name_az: nameAz, sort_order: sortOrder === '' ? undefined : Number(sortOrder) });
      } else {
        await api.post('/dictionaries/wbs/templates', { template_id: templateId, parent_code: parentCode || null, name_ru: nameRu, name_en: nameEn, name_ka: nameKa, name_az: nameAz });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '420px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>{isEdit ? t.dictFormEditStage : t.dictFormNewStage}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        {!isEdit && (
          <>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldParentStage}</label>
            <select value={parentCode} onChange={e => setParentCode(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', fontSize: '14px' }}>
              <option value="">{t.dictFormTopLevelOption}</option>
              {existingStages.map(s => <option key={s.id} value={s.code}>{'—'.repeat(s.level)} {s.code} {s.name}</option>)}
            </select>
          </>
        )}

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameRu}</label>
        <input value={nameRu} onChange={e => setNameRu(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameEn}</label>
        <input value={nameEn} onChange={e => setNameEn(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameKa}</label>
        <input value={nameKa} onChange={e => setNameKa(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldNameAz}</label>
        <input value={nameAz} onChange={e => setNameAz(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '14px', boxSizing: 'border-box', fontSize: '14px' }} />

        {isEdit && (
          <>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{t.dictFormFieldSortOrder}</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '18px', boxSizing: 'border-box', fontSize: '14px' }} />
          </>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>{dt('cancel', lang)}</button>
          <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '10px' }}>{saving ? '...' : dt('save', lang)}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function WbsDict({ canEdit, lang = 'ru', t }) {
  const [headers, setHeaders] = useState([]);
  const [selectedHeader, setSelectedHeader] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalState, setModalState] = useState(null);

  useEffect(() => {
    api.get(`/dictionaries/wbs/headers?lang=${lang}`).then(res => setHeaders(res.data || [])).catch(err => console.error(err));
  }, [lang]);

  const loadStages = () => {
    if (!selectedHeader) { setStages([]); return; }
    setLoading(true);
    api.get(`/dictionaries/wbs/templates/${selectedHeader.id}?lang=${lang}`)
      .then(res => setStages(res.data || []))
      .catch(err => console.error('Ошибка загрузки этапов WBS:', err))
      .finally(() => setLoading(false));
  };

  useEffect(loadStages, [selectedHeader, lang]);

  const handleDelete = async (s) => {
    if (!window.confirm(`Удалить этап "${s.name}"?`)) return;
    try {
      await api.delete(`/dictionaries/wbs/templates/${s.id}`);
      loadStages();
    } catch (err) {
      alert(t.dictDeleteError + ': ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <>
      <Toolbar title={t.dictCardWbs} onAdd={() => setModalState('new')} hideAdd={!selectedHeader || !canEdit} t={t} />

      <div style={{ marginBottom: '1px' }}>
        <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#475569', marginBottom: '18px' }}>
          {t.dictWbsSelectHeader}
        </label>
        <select
          value={selectedHeader?.id || ''}
          onChange={e => setSelectedHeader(headers.find(h => h.id === e.target.value) || null)}
          style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', minWidth: '320px', fontSize: '14px' }}
        >
          <option value="">{t.dictFormSelectPlaceholder}</option>
          {headers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <p style={{ margin: '14px 0 0', fontSize: '12px', color: '#94a3b8' }}>
          {t.dictWbsFixedNote}
        </p>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '14px' }}>{t.dictLoading}</p>}
      {!loading && selectedHeader && (
        <>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#94a3b8' }}>{t.dictWbsStagesCount}: {stages.length}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              <th style={th}>{t.dictColCode}</th><th style={th}>{t.dictColStage}</th><th style={th}>{t.dictColStageSort}</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {stages.map(s => (
                <tr key={s.id}>
                  <td style={td}>{s.code}</td>
                  <td style={td}>
                    <span style={{ paddingLeft: `${s.level * 20}px`, display: 'inline-block' }}>
                      {s.level > 0 && <span style={{ color: '#cbd5e1', marginRight: '6px' }}>└</span>}
                      {s.name}
                    </span>
                  </td>
                  <td style={td}>{s.sort_order}</td>
                  <td style={td}><RowActions onEdit={() => setModalState(s)} onDelete={() => handleDelete(s)} canEdit={canEdit} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {modalState && (
        <WbsStageFormModal
          templateId={selectedHeader?.id}
          initial={modalState === 'new' ? null : modalState}
          existingStages={stages}
          lang={lang}
          t={t}
          onClose={() => setModalState(null)}
          onSaved={() => { setModalState(null); loadStages(); }}
        />
      )}
    </>
  );
}

const dictCardStyle = {
  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px',
  padding: '20px 12px', textAlign: 'center', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
  transition: 'border-color 0.15s, background 0.15s',
};

const DictionariesPage = ({ lang = 'ru', userRole, t, renderProjectsRegistry }) => {
  const [activeSub, setActiveSub] = useState(null); // null = показываем сетку выбора
  const [dictSearch, setDictSearch] = useState('');
  const canEdit = userRole === 'admin' || userRole === 'manager';

  const isPrivileged = userRole === 'admin' || userRole === 'manager' || userRole === 'director';
  const visibleSubTabs = SUB_TABS.filter(tab => {
    if (userRole === 'pricer') {
      return tab.key === 'resources';
    }
    if (tab.key === 'projects') {
      return isPrivileged;
    }
    return true;
  });

  const filteredTabs = visibleSubTabs.filter(tab => (t[tab.labelKey] || '').toLowerCase().includes(dictSearch.trim().toLowerCase()));
  const activeTab = visibleSubTabs.find(tab => tab.key === activeSub);

  // --- Экран выбора справочника (сетка карточек + поиск) ---
  if (!activeSub) {
    return (
      <div>
        <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#94a3b8' }}>
          {t.dictSubtitle}
        </p>

        <div style={{ position: 'relative', marginBottom: '20px', maxWidth: '360px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            value={dictSearch}
            onChange={e => setDictSearch(e.target.value)}
            placeholder={t.dictSearchPlaceholder}
            style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          {filteredTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <div
                key={tab.key}
                onClick={() => setActiveSub(tab.key)}
                style={dictCardStyle}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
              >
                <Icon size={24} color="#3b82f6" />
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b' }}>{t[tab.labelKey]}</span>
              </div>
            );
          })}
          {filteredTabs.length === 0 && (
            <p style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '20px' }}>{t.dictNotFound}</p>
          )}
        </div>
      </div>
    );
  }

  // --- Экран конкретного справочника ---
  const ActiveIcon = activeTab?.icon;
  return (
    <div>
      <button
        onClick={() => setActiveSub(null)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '13px', fontWeight: '600', padding: 0, marginBottom: '16px' }}
      >
        <ChevronLeft size={16} /> {t.dictBackToAll}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        {ActiveIcon && <ActiveIcon size={20} color="#3b82f6" />}
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>{activeTab && t[activeTab.labelKey]}</h2>
      </div>

      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        {activeSub === 'projects' && (renderProjectsRegistry ? renderProjectsRegistry() : <ProjectsDict lang={lang} canEdit={canEdit} t={t} />)}
        {activeSub === 'resources' && <ResourcesDict lang={lang} canEdit={canEdit} userRole={userRole} t={t} />}
        {activeSub === 'works' && <WorksDict lang={lang} canEdit={canEdit} t={t} />}
        {activeSub === 'norms' && <NormsDict lang={lang} canEdit={canEdit} t={t} />}
        {activeSub === 'measures' && <MeasuresDict lang={lang} canEdit={canEdit} t={t} />}
        {activeSub === 'wbs' && <WbsDict canEdit={canEdit} lang={lang} t={t} />}
      </div>
    </div>
  );
};

export default DictionariesPage;