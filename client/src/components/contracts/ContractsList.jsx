import React, { useState, useEffect } from 'react';
import {
  Search, Filter, RefreshCw, FileText, Clock, CheckCircle, XCircle,
  ArrowRight, Loader, ChevronRight, Package, Hammer, Users, Plus
} from 'lucide-react';
import ContractDetail from './ContractDetail';

function getStatusLabels(t) {
  return {
    DRAFT:            { label: t.contrStatusDraft || 'Черновик',        color: '#64748b', bg: '#f1f5f9' },
    PENDING_APPROVAL: { label: t.contrStatusPendingApproval || 'На согласовании', color: '#d97706', bg: '#fef3c7' },
    APPROVED:         { label: t.contrStatusApproved || 'Согласован',       color: '#059669', bg: '#d1fae5' },
    REVISION:         { label: t.contrStatusRevision || 'На доработке',     color: '#dc2626', bg: '#fee2e2' },
    ACTIVE:           { label: t.contrStatusActive || 'Активный',         color: '#2563eb', bg: '#dbeafe' },
    CLOSED:           { label: t.contrStatusClosed || 'Закрыт',           color: '#7c3aed', bg: '#ede9fe' },
  };
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ContractsList({ api, projects, userRole, selectedProjectId, selectedObjectId, t = {} }) {
  const STATUS_LABELS = getStatusLabels(t);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchText, setSearchText] = useState('');

  const loadContracts = () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const params = { project_id: selectedProjectId };
    if (selectedObjectId) params.object_id = selectedObjectId;
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.contract_type = filterType;
    api.get('/contracts/list', { params })
      .then(r => setContracts(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadContracts(); }, [selectedProjectId, selectedObjectId, filterStatus, filterType]);

  const filtered = contracts.filter(c => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (
      (c.contract_number || '').toLowerCase().includes(q) ||
      (c.contract_name || '').toLowerCase().includes(q) ||
      (c.contractors?.company_name || '').toLowerCase().includes(q)
    );
  });

  const handleContractUpdate = (updated) => {
    setContracts(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
    setSelectedContract(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
  };

  // Group by status for stats
  const stats = {};
  for (const c of contracts) {
    stats[c.status] = (stats[c.status] || 0) + 1;
  }

  return (
    <div>
      {/* Stats strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_LABELS).map(([status, info]) => {
          const count = stats[status] || 0;
          if (!count && status !== 'DRAFT') return null;
          return (
            <div
              key={status}
              onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12,
                background: filterStatus === status ? info.bg : '#f8fafc',
                border: `1.5px solid ${filterStatus === status ? info.color : '#e2e8f0'}`,
                cursor: 'pointer', transition: 'all .15s',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 18, color: info.color }}>{count}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: info.color }}>{info.label}</span>
            </div>
          );
        })}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              style={{ ...styles.input, paddingLeft: 38 }}
              placeholder={t.contrListSearchPlaceholder || 'Поиск по № / названию / контрагенту...'}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
        </div>
        <div style={{ minWidth: 160 }}>
          <select style={styles.select} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">{t.contrAllTypes || 'Все типы'}</option>
            <option value="SUBCONTRACT">{t.contrTypeSubcontract || '🔨 Подряд'}</option>
            <option value="SUPPLY">{t.contrTypeSupply || '📦 Поставка'}</option>
          </select>
        </div>
        <button onClick={loadContracts} style={{ padding: '11px 16px', borderRadius: 12, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60, color: '#94a3b8' }}>
          <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /> {t.contrLoading || 'Загрузка...'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
          <FileText size={48} style={{ marginBottom: 12, opacity: .3 }} />
          <div style={{ fontSize: 15 }}>{t.contrNoContracts || 'Договоров нет'}</div>
        </div>
      ) : (
        <div>
          {/* Two-column layout: list + detail */}
          <div style={{ display: 'grid', gridTemplateColumns: selectedContract ? '1fr 1.3fr' : '1fr', gap: 20 }}>
            {/* Contracts list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(c => {
                const s = STATUS_LABELS[c.status] || STATUS_LABELS.DRAFT;
                const isSelected = selectedContract?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedContract(isSelected ? null : { ...c, approvals: [] })}
                    style={{
                      background: isSelected ? '#eff6ff' : '#fff',
                      border: `1.5px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                      borderRadius: 16, padding: '14px 18px', cursor: 'pointer',
                      transition: 'all .2s', boxShadow: isSelected ? '0 0 0 3px rgba(59,130,246,.1)' : '0 1px 4px rgba(0,0,0,.04)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{s.label}</span>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>
                            {c.contract_type === 'SUPPLY' ? (t.contrTypeSupply || '📦 Поставка') : (t.contrTypeSubcontract || '🔨 Подряд')}
                          </span>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          №{c.contract_number || '—'} {c.contract_name ? `— ${c.contract_name}` : ''}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                          <Users size={12} /> {c.contractors?.company_name || '—'}
                          {c.project_objects && <><span>•</span> {c.project_objects.name}</>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b' }}>
                          {c.total_amount > 0 ? `${formatNum(c.total_amount)} ${c.dic_currencies?.symbol || c.dic_currencies?.code || '₸'}` : '—'}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {formatDate(c.date_start)} {c.date_end ? `— ${formatDate(c.date_end)}` : ''}
                        </div>
                        <ChevronRight size={14} color={isSelected ? '#2563eb' : '#cbd5e1'} style={{ marginTop: 4 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Contract detail */}
            {selectedContract && (
              <div>
                <ContractDetail
                  contract={selectedContract}
                  api={api}
                  userRole={userRole}
                  onClose={() => setSelectedContract(null)}
                  onUpdate={handleContractUpdate}
                  t={t}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  input: {
    width: '100%', padding: '11px 16px', borderRadius: 12, border: '1.5px solid #e2e8f0',
    fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  select: {
    width: '100%', padding: '11px 14px', borderRadius: 12, border: '1.5px solid #e2e8f0',
    fontSize: 14, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
  },
};
