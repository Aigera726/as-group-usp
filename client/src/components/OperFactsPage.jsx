import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle, X, Search } from 'lucide-react';

const STATUS_COLORS = {
  pending_approval: { bg: '#fff7ed', color: '#ea580c' },
  approved: { bg: '#ecfdf5', color: '#16a34a' },
  rejected: { bg: '#f1f5f9', color: '#64748b' },
  matching_error: { bg: '#fef2f2', color: '#dc2626' }
};

function StatusBadge({ status, t }) {
  const c = STATUS_COLORS[status] || { bg: '#f1f5f9', color: '#64748b' };
  const labels = {
    pending_approval: t.opfStatusPending,
    approved: t.opfStatusApproved,
    rejected: t.opfStatusRejected,
    matching_error: t.opfStatusError
  };
  return (
    <span style={{ fontSize: '11px', fontWeight: '800', padding: '3px 10px', borderRadius: '20px', background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
      {labels[status] || status}
    </span>
  );
}

function formatNum(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n));
}

function formatDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch (e) { return d; }
}

// «Ранее подтверждено» из US-10-02 (шаг 2 основного сценария) — подтверждённый объём
// по этой работе ДО данного оперфакта. remaining_volume — снимок остатка на момент
// поступления/последнего пересчёта; после подтверждения самого оперфакта в этот остаток
// уже включено его confirmed_volume, поэтому его нужно вычесть обратно.
function prevConfirmedVolume(f) {
  if (f.plan_volume == null || f.remaining_volume == null) return null;
  const ownConfirmed = f.status === 'approved' ? Number(f.confirmed_volume || 0) : 0;
  return Number(f.plan_volume) - Number(f.remaining_volume) - ownConfirmed;
}

export default function OperFactsPage({ api, userRole, t, lang }) {
  const [facts, setFacts] = useState([]);
  const [kpi, setKpi] = useState({ total: 0, pending_approval: 0, approved: 0, matching_error: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedFact, setSelectedFact] = useState(null);
  const [confirmedVolumeInput, setConfirmedVolumeInput] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canConfirm = userRole === 'admin' || userRole === 'manager' || userRole === 'estimator';

  const STATUS_LABELS = {
    pending_approval: t.opfStatusPending,
    approved: t.opfStatusApproved,
    rejected: t.opfStatusRejected,
    matching_error: t.opfStatusError
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = { lang: lang || 'ru' };
    if (statusFilter) params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.get('/estimates/oper-facts', { params })
      .then(r => {
        setFacts(r.data?.data || []);
        setKpi(r.data?.kpi || { total: 0, pending_approval: 0, approved: 0, matching_error: 0 });
      })
      .catch(err => console.error('[OperFacts] load error:', err))
      .finally(() => setLoading(false));
  }, [api, statusFilter, search, lang]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (fact) => {
    setSelectedFact(fact);
    setConfirmedVolumeInput(fact.reported_volume ?? '');
    setShowRejectForm(false);
    setRejectReason('');
  };

  const handleApprove = async () => {
    if (!selectedFact) return;
    setIsSaving(true);
    try {
      await api.post(`/estimates/oper-facts/${selectedFact.id}/approve`, {
        confirmed_volume: confirmedVolumeInput === '' ? undefined : Number(confirmedVolumeInput)
      });
      setSelectedFact(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || t.opfErrApprove);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedFact || !rejectReason.trim()) return;
    setIsSaving(true);
    try {
      await api.post(`/estimates/oper-facts/${selectedFact.id}/reject`, { reason: rejectReason.trim() });
      setSelectedFact(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || t.opfErrReject);
    } finally {
      setIsSaving(false);
    }
  };

  const kpiCards = [
    { label: t.opfKpiTotal, value: kpi.total, color: '#1e293b', bg: '#f8fafc' },
    { label: t.opfKpiPending, value: kpi.pending_approval, color: '#ea580c', bg: '#fff7ed' },
    { label: t.opfKpiApproved, value: kpi.approved, color: '#16a34a', bg: '#ecfdf5' },
    { label: t.opfKpiError, value: kpi.matching_error, color: '#dc2626', bg: '#fef2f2' }
  ];

  const tableHeaders = [
    t.opfColNumber, t.opfColProject, t.opfColObject, t.opfColContract, t.opfColWork,
    t.opfColExecutorType, t.opfColContractorDept, t.opfColExecutor,
    t.opfColPlan, t.opfColFactReported, t.opfColFactConfirmed, t.opfColRemaining, t.opfColUnit, t.opfColAmount,
    t.opfColPlannedDate, t.opfColExecutionDate, t.opfColConfirmedDate, t.opfColStatus, t.opfColDocuments
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ClipboardCheck size={24} color="#3b82f6" /> {t.opfPageTitle}
        </h2>
        <button onClick={load} title={t.opfRefresh} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 800, background: 'white', border: '1.5px solid #64748b', color: '#64748b', borderRadius: 8, cursor: 'pointer' }}>
          <RefreshCw size={14} /> {t.opfRefresh}
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {kpiCards.map(c => (
          <div key={c.label} style={{ background: c.bg, border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 950, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, background: 'white', padding: 14, borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 12px', flex: 1, maxWidth: 320 }}>
          <Search size={14} color="#94a3b8" />
          <input
            placeholder={t.opfSearchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13, flex: 1 }}
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontWeight: 700, fontSize: 13 }}>
          <option value="">{t.opfAllStatuses}</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Table — все поля по ТЗ (US-10-01, раздел 5) */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1900 }}>
            <thead style={{ background: '#f1f5f9' }}>
              <tr>
                {tableHeaders.map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={19} style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>{t.opfLoading}</td></tr>
              ) : facts.length === 0 ? (
                <tr><td colSpan={19} style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>{t.opfEmpty}</td></tr>
              ) : facts.map(f => (
                <tr key={f.id} onClick={() => openDetail(f)} style={{ cursor: 'pointer', borderTop: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 12px', color: '#64748b', fontWeight: 700 }}>{f.external_id || f.id.slice(0, 8)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{f.project_name || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{f.object_name || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{f.contract_number || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{f.work_name || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{f.executor_type === 'counterparty' ? t.opfExecutorTypeCounterparty : t.opfExecutorTypeOrganization}</td>
                  <td style={{ padding: '10px 12px' }}>{f.department_or_contractor || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{f.executor_name || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatNum(f.plan_volume)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#2563eb' }}>{formatNum(f.reported_volume)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{formatNum(f.confirmed_volume)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatNum(f.remaining_volume)}</td>
                  <td style={{ padding: '10px 12px' }}>{f.unit || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatNum(f.amount)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatDate(f.planned_date)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatDate(f.execution_date)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatDate(f.confirmed_at)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={f.status} t={t} /></td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{(f.documents || []).length > 0 ? `📎 ${f.documents.length}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {selectedFact && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, paddingTop: '8vh' }}>
          <div style={{ width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto', background: 'white', padding: 24, borderRadius: 20, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#1e293b' }}>{t.opfDetailTitle} {selectedFact.external_id || selectedFact.id.slice(0, 8)}</h3>
                <div style={{ marginTop: 6 }}><StatusBadge status={selectedFact.status} t={t} /></div>
              </div>
              <button onClick={() => setSelectedFact(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            {selectedFact.status === 'matching_error' && (
              <div style={{ display: 'flex', gap: 8, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 16, fontSize: 13, color: '#991b1b' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>{selectedFact.matching_error_details || t.opfMatchErrorFallback}</div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13, marginBottom: 16 }}>
              <DetailField label={t.opfColProject} value={selectedFact.project_name} />
              <DetailField label={t.opfColObject} value={selectedFact.object_name} />
              <DetailField label={t.opfColContract} value={selectedFact.contract_number} />
              <DetailField label={t.opfColExecutorType} value={selectedFact.executor_type === 'counterparty' ? t.opfExecutorTypeCounterparty : t.opfExecutorTypeOrganization} />
              <DetailField label={t.opfColContractorDept} value={selectedFact.department_or_contractor} />
              <DetailField label={t.opfColExecutor} value={selectedFact.executor_name} />
              <DetailField label={t.opfColWork} value={selectedFact.work_name} span2 />
              <DetailField label={t.opfColPlan} value={formatNum(selectedFact.plan_volume) + ' ' + (selectedFact.unit || '')} />
              <DetailField label={t.opfColPrevConfirmed} value={formatNum(prevConfirmedVolume(selectedFact)) + ' ' + (selectedFact.unit || '')} />
              <DetailField label={t.opfColFactReported} value={formatNum(selectedFact.reported_volume) + ' ' + (selectedFact.unit || '')} />
              <DetailField label={t.opfColRemaining} value={formatNum(selectedFact.remaining_volume) + ' ' + (selectedFact.unit || '')} />
              <DetailField label={t.opfColAmount} value={formatNum(selectedFact.amount)} />
              <DetailField label={t.opfFieldExecutionDate} value={formatDate(selectedFact.execution_date)} />
              <DetailField label={t.opfFieldPlannedDate} value={formatDate(selectedFact.planned_date)} />
              <DetailField label={t.opfFieldFormedDate} value={formatDate(selectedFact.formed_at)} />
              <DetailField label={t.opfFieldConfirmedDate} value={formatDate(selectedFact.confirmed_at)} />
            </div>

            {selectedFact.documents && selectedFact.documents.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>{t.opfDocumentsLabel}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedFact.documents.map((d, i) => (
                    <a key={i} href={d.url || d} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'underline' }}>{t.opfDocumentLinkPrefix} {i + 1}</a>
                  ))}
                </div>
              </div>
            )}

            {selectedFact.status === 'pending_approval' && canConfirm && (
              <>
                {!showRejectForm ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{t.opfConfirmVolumeLabel}</label>
                      <input
                        type="number"
                        value={confirmedVolumeInput}
                        onChange={e => setConfirmedVolumeInput(e.target.value)}
                        style={{ width: '100%', padding: 12, borderRadius: 10, border: '2px solid #e2e8f0', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        disabled={isSaving}
                        onClick={handleApprove}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: isSaving ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', padding: 12, borderRadius: 10, fontWeight: 800, cursor: isSaving ? 'not-allowed' : 'pointer' }}
                      >
                        <CheckCircle2 size={16} /> {t.opfBtnApprove}
                      </button>
                      <button
                        onClick={() => setShowRejectForm(true)}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'white', color: '#dc2626', border: '2px solid #dc2626', padding: 12, borderRadius: 10, fontWeight: 800, cursor: 'pointer' }}
                      >
                        <XCircle size={16} /> {t.opfBtnReject}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{t.opfRejectReasonLabel}</label>
                      <textarea
                        rows={3}
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        style={{ width: '100%', padding: 12, borderRadius: 10, border: '2px solid #e2e8f0', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={() => setShowRejectForm(false)} style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: 12, borderRadius: 10, fontWeight: 700, cursor: 'pointer', color: '#64748b' }}>{t.btnBack}</button>
                      <button
                        disabled={isSaving || !rejectReason.trim()}
                        onClick={handleReject}
                        style={{ flex: 1, background: (!rejectReason.trim() || isSaving) ? '#94a3b8' : '#dc2626', color: 'white', border: 'none', padding: 12, borderRadius: 10, fontWeight: 800, cursor: (!rejectReason.trim() || isSaving) ? 'not-allowed' : 'pointer' }}
                      >
                        {t.opfBtnConfirmReject}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {selectedFact.status === 'rejected' && selectedFact.rejection_reason && (
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 10, fontSize: 13 }}>
                <strong>{t.opfRejectionReasonDisplay}</strong> {selectedFact.rejection_reason}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, span2 }) {
  return (
    <div style={{ gridColumn: span2 ? 'span 2' : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: '#1e293b' }}>{value || '—'}</div>
    </div>
  );
}
