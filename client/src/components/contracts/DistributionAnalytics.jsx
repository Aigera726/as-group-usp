import React, { useState, useEffect } from 'react';
import {
  TrendingUp, BarChart2, ChevronDown, ChevronUp, ExternalLink,
  Users, FileText, Package, Hammer, AlertTriangle, CheckCircle, Loader
} from 'lucide-react';

function formatNum(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function ProgressBar({ percent, color = '#3b82f6', showLabel = true }) {
  const pct = Math.min(100, Math.max(0, percent || 0));
  const c = pct >= 100 ? '#059669' : pct >= 70 ? '#2563eb' : pct >= 30 ? '#d97706' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, background: '#e2e8f0', borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 99, transition: 'width .5s ease' }} />
      </div>
      {showLabel && <span style={{ fontSize: 12, fontWeight: 700, color: c, minWidth: 36 }}>{pct}%</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACTOR ROW (aggregated by contractor)
// ─────────────────────────────────────────────────────────────────────────────

function ContractorRow({ contractor, total }) {
  const [open, setOpen] = useState(false);
  const pct = total > 0 ? Math.round((contractor.amount / total) * 100) : 0;
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 10 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
          background: '#f8fafc', cursor: 'pointer', transition: 'background .2s',
        }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Users size={18} color="#2563eb" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{contractor.name}</div>
          <div style={{ marginTop: 4 }}><ProgressBar percent={pct} showLabel={false} /></div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b' }}>{formatNum(contractor.amount)} ₸</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>{pct}% от итого</div>
        </div>
        {open ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #e2e8f0', background: '#fff', padding: '12px 20px' }}>
          {contractor.contracts.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
              <span style={{ color: '#475569' }}>№{c.contract_number || '—'} <span style={{ color: '#94a3b8' }}>{c.contract_type === 'SUPPLY' ? '📦 Поставка' : '🔨 Подряд'}</span></span>
              <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatNum(c.total_amount)} ₸</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WORK ROW
// ─────────────────────────────────────────────────────────────────────────────

function WorkRow({ item }) {
  const [open, setOpen] = useState(false);
  const hasContracts = item.contracts && item.contracts.length > 0;
  return (
    <tr key={item.id}>
      <td style={{ padding: '10px 16px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{item.name}</div>
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#64748b' }}>{item.unit}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{formatNum(item.total_quantity)}</td>
      <td style={{ padding: '10px 16px', minWidth: 160 }}>
        <ProgressBar percent={item.assigned_percent} />
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
          {formatNum(item.assigned_quantity)} из {formatNum(item.total_quantity)}
        </div>
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: item.remaining_quantity <= 0 ? '#059669' : '#dc2626' }}>
        {item.remaining_quantity <= 0 ? '✓ 0' : formatNum(item.remaining_quantity)}
      </td>
      <td style={{ padding: '10px 16px' }}>
        {hasContracts ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {item.contracts.map((c, i) => (
              <span key={i} style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: '#dbeafe', color: '#1d4ed8',
              }}>
                №{c.contract_number} — {c.contractor}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>Не распределено</span>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function DistributionAnalytics({ api, projects, selectedProjectId, selectedObjectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('works'); // works | resources

  const loadData = () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const params = { project_id: selectedProjectId };
    if (selectedObjectId) params.object_id = selectedObjectId;
    api.get('/contracts/distribution-summary', { params })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [selectedProjectId, selectedObjectId]);

  // Aggregate by contractor
  const contractorMap = {};
  if (data) {
    const allContracts = [...(data.works || []), ...(data.resources || [])].flatMap(w => w.contracts || []);
    for (const c of allContracts) {
      if (!c.contract_id) continue;
      if (!contractorMap[c.contractor]) contractorMap[c.contractor] = { name: c.contractor, amount: 0, contracts: [] };
      contractorMap[c.contractor].amount += Number(c.total_price || 0);
      const existing = contractorMap[c.contractor].contracts.find(x => x.id === c.contract_id);
      if (!existing) contractorMap[c.contractor].contracts.push({ id: c.contract_id, contract_number: c.contract_number, contract_type: c.contract_type, total_amount: 0 });
      const ec = contractorMap[c.contractor].contracts.find(x => x.id === c.contract_id);
      if (ec) ec.total_amount += Number(c.total_price || 0);
    }
  }
  const contractors = Object.values(contractorMap);
  const totalContractorsAmount = contractors.reduce((s, c) => s + c.amount, 0);

  const { summary } = data || {};
  const items = activeTab === 'works' ? (data?.works || []) : (data?.resources || []);

  return (
    <div>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60, color: '#94a3b8' }}>
          <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /> Загрузка аналитики...
        </div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
          <BarChart2 size={48} style={{ marginBottom: 12, opacity: .3 }} />
          <div style={{ fontSize: 15 }}>Нет данных аналитики</div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'Всего работ', value: summary?.total_works || 0, color: '#3b82f6', icon: Hammer },
              { label: 'Распределено', value: summary?.assigned_works || 0, color: '#059669', icon: CheckCircle },
              { label: 'Не распределено', value: summary?.unassigned_works || 0, color: '#dc2626', icon: AlertTriangle },
              { label: 'Покрытие', value: `${summary?.assigned_percent || 0}%`, color: '#7c3aed', icon: TrendingUp },
            ].map(kpi => {
              const Icon = kpi.icon;
              return (
                <div key={kpi.label} style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: kpi.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={16} color={kpi.color} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{kpi.label}</span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b' }}>{kpi.value}</div>
                </div>
              );
            })}
          </div>

          {/* Overall progress */}
          <div style={{ background: 'linear-gradient(135deg, #1e293b, #334155)', borderRadius: 20, padding: '24px 28px', marginBottom: 24, color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Общее распределение объёма работ</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{summary?.assigned_percent || 0}%</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Назначено / Всего</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{summary?.assigned_works || 0} / {summary?.total_works || 0}</div>
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.15)', borderRadius: 99, height: 10, overflow: 'hidden' }}>
              <div style={{
                width: `${summary?.assigned_percent || 0}%`, height: '100%',
                background: 'linear-gradient(90deg, #34d399, #059669)', borderRadius: 99,
                transition: 'width .6s ease',
              }} />
            </div>
          </div>

          {/* By contractor */}
          {contractors.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: '#1e293b', fontSize: 15 }}>📊 По контрагентам</h4>
              {contractors.sort((a, b) => b.amount - a.amount).map(c => (
                <ContractorRow key={c.name} contractor={c} total={totalContractorsAmount} />
              ))}
            </div>
          )}

          {/* Detailed table */}
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {[
                { val: 'works', label: '🔨 Работы', count: data?.works?.length },
                { val: 'resources', label: '📦 Ресурсы', count: data?.resources?.length },
              ].map(tab => (
                <button
                  key={tab.val}
                  onClick={() => setActiveTab(tab.val)}
                  style={{
                    padding: '8px 20px', borderRadius: 10, fontWeight: 700, fontSize: 13,
                    border: `2px solid ${activeTab === tab.val ? '#3b82f6' : '#e2e8f0'}`,
                    background: activeTab === tab.val ? '#eff6ff' : '#fff',
                    color: activeTab === tab.val ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label} <span style={{ fontSize: 11, opacity: .7 }}>({tab.count || 0})</span>
                </button>
              ))}
            </div>

            {items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Нет данных</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                  <thead>
                    <tr style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                      <th style={{ padding: '0 16px', textAlign: 'left' }}>Наименование</th>
                      <th style={{ padding: '0 12px', textAlign: 'center', width: 50 }}>Ед.</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', width: 90 }}>По смете</th>
                      <th style={{ padding: '0 16px', textAlign: 'left', width: 200 }}>Распределение</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', width: 90 }}>Остаток</th>
                      <th style={{ padding: '0 16px', textAlign: 'left' }}>Договора</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => <WorkRow key={item.id} item={item} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 },
  select: {
    width: '100%', padding: '11px 14px', borderRadius: 12, border: '1.5px solid #e2e8f0',
    fontSize: 14, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
  },
};
