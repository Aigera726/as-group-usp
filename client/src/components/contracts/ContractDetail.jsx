import React, { useState } from 'react';
import {
  FileText, CheckCircle, Clock, XCircle, ArrowRight, ChevronDown,
  ChevronUp, Package, Hammer, Users, Calendar, AlertCircle, Send, Loader
} from 'lucide-react';

function getStatusLabels(t) {
  return {
    DRAFT:            { label: t.contrStatusDraft || 'Черновик',        color: '#64748b', bg: '#f1f5f9', icon: FileText },
    PENDING_APPROVAL: { label: t.contrStatusPendingApproval || 'На согласовании', color: '#d97706', bg: '#fef3c7', icon: Clock },
    APPROVED:         { label: t.contrStatusApproved || 'Согласован',       color: '#059669', bg: '#d1fae5', icon: CheckCircle },
    REVISION:         { label: t.contrStatusRevision || 'На доработке',     color: '#dc2626', bg: '#fee2e2', icon: XCircle },
    ACTIVE:           { label: t.contrStatusActive || 'Активный',         color: '#2563eb', bg: '#dbeafe', icon: ArrowRight },
    CLOSED:           { label: t.contrStatusClosed || 'Закрыт',           color: '#7c3aed', bg: '#ede9fe', icon: CheckCircle },
  };
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function StatusBadge({ status, t }) {
  const STATUS_LABELS = getStatusLabels(t);
  const s = STATUS_LABELS[status] || STATUS_LABELS.DRAFT;
  const Icon = s.icon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, background: s.bg, color: s.color, fontWeight: 700, fontSize: 12 }}>
      <Icon size={12} /> {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT DETAIL PANEL
// ─────────────────────────────────────────────────────────────────────────────

export default function ContractDetail({ contract, api, onClose, onUpdate, userRole, t = {} }) {
  const [expanded, setExpanded] = useState(true);
  const [assignments, setAssignments] = useState(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [approvals, setApprovals] = useState(contract.approvals || []);
  const [actioning, setActioning] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const isDirector = ['director', 'admin'].includes(userRole);
  const canApprove = isDirector && contract.status === 'PENDING_APPROVAL';
  const canSubmit = ['manager', 'admin'].includes(userRole) && ['DRAFT', 'REVISION'].includes(contract.status);

  const loadAssignments = async () => {
    if (assignments !== null) { setExpanded(e => !e); return; }
    setLoadingAssignments(true);
    try {
      const res = await api.get(`/contracts/${contract.id}/assignments`);
      setAssignments(res.data || []);
      setExpanded(true);
    } catch {
      setAssignments([]);
    } finally {
      setLoadingAssignments(false);
    }
  };

  const handleSubmit = async () => {
    setActioning(true);
    try {
      await api.post(`/contracts/${contract.id}/submit`);
      onUpdate?.({ ...contract, status: 'PENDING_APPROVAL' });
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setActioning(false);
    }
  };

  const handleApprove = async () => {
    setActioning(true);
    try {
      await api.post(`/contracts/${contract.id}/approve`);
      onUpdate?.({ ...contract, status: 'APPROVED' });
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActioning(true);
    try {
      await api.post(`/contracts/${contract.id}/reject`, { comment: rejectReason });
      onUpdate?.({ ...contract, status: 'REVISION' });
      setShowRejectForm(false);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setActioning(false);
    }
  };

  const works = (assignments || []).filter(a => a.assignment_type === 'WORK');
  const resources = (assignments || []).filter(a => a.assignment_type === 'RESOURCE');
  const totalAssigned = (assignments || []).reduce((s, a) => s + Number(a.total_price || 0), 0);

  return (
    <div style={{ background: '#fff', borderRadius: 24, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.08)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <StatusBadge status={contract.status} t={t} />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{contract.contract_type === 'SUPPLY' ? (t.contrTypeSupply || '📦 Поставка') : (t.contrTypeSubcontract || '🔨 Подряд')}</span>
          </div>
          <h3 style={{ margin: '0 0 4px', fontWeight: 800, fontSize: 18, color: '#1e293b' }}>
            №{contract.contract_number || '—'} {contract.contract_name ? `— ${contract.contract_name}` : ''}
          </h3>
          <div style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Users size={13} /> {contract.contractors?.company_name || '—'}
            </span>
            {contract.projects && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <FileText size={13} /> {contract.projects.name}
              </span>
            )}
            {contract.project_objects && (
              <span>📍 {contract.project_objects.name}</span>
            )}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 8 }}>✕</button>
      </div>

      {/* Meta grid */}
      <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
        {[
          { label: t.contrDetailDateStart || 'Дата начала', value: formatDate(contract.date_start) },
          { label: t.contrDetailDateEnd || 'Дата окончания', value: formatDate(contract.date_end) },
          { label: t.contrDetailAmount || 'Сумма договора', value: `${formatNum(contract.total_amount)} ${contract.dic_currencies?.symbol || contract.dic_currencies?.code || '₸'}` },
          { label: t.contrDetailMode || 'Режим', value: contract.contract_mode === 'OPEN' ? (t.contrModeOpen || 'Открытый') : (t.contrModeStandard || 'Стандартный') },
          { label: t.contrDetailCreated || 'Создан', value: formatDate(contract.created_at) },
          { label: t.contrDetailBin || 'БИН/ИИН', value: contract.contractors?.bin_iin || '—' },
        ].map(f => (
          <div key={f.label} style={{ background: '#f8fafc', borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>{f.label}</div>
            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 13 }}>{f.value}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ padding: '0 24px 16px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {canSubmit && (
          <button
            onClick={handleSubmit} disabled={actioning}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12, background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            {actioning ? <Loader size={14} /> : <Send size={14} />} {t.contrSubmitForApproval || 'Отправить на согласование'}
          </button>
        )}
        {canApprove && !showRejectForm && (
          <>
            <button
              onClick={handleApprove} disabled={actioning}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12, background: '#059669', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {actioning ? <Loader size={14} /> : <CheckCircle size={14} />} {t.contrApprove || 'Согласовать'}
            </button>
            <button
              onClick={() => setShowRejectForm(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12, background: '#fee2e2', color: '#dc2626', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              <XCircle size={14} /> {t.contrReject || 'Отклонить'}
            </button>
          </>
        )}
        {showRejectForm && (
          <div style={{ width: '100%', background: '#fee2e2', borderRadius: 14, padding: '16px 20px' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>{t.contrRejectReasonLabel || 'Причина отклонения *'}</label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder={t.contrRejectReasonPlaceholder || 'Укажите причину...'}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #fca5a5', fontSize: 14, resize: 'vertical', height: 80, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button onClick={() => setShowRejectForm(false)} style={{ padding: '8px 16px', borderRadius: 10, background: '#fff', border: '1.5px solid #e2e8f0', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>{t.contrCancel || 'Отмена'}</button>
              <button onClick={handleReject} disabled={actioning || !rejectReason.trim()} style={{ padding: '8px 16px', borderRadius: 10, background: '#dc2626', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                {actioning ? (t.contrRejecting || 'Отклонение...') : (t.contrConfirm || 'Подтвердить')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Assignments section */}
      <div style={{ borderTop: '1px solid #f1f5f9' }}>
        <button
          onClick={loadAssignments}
          style={{ width: '100%', padding: '14px 24px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700, fontSize: 14, color: '#1e293b' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hammer size={16} color="#64748b" /> {t.contrAssignmentsHeading || 'Назначения'}
            {assignments !== null && (
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>({assignments.length})</span>
            )}
          </span>
          {loadingAssignments ? <Loader size={16} color="#94a3b8" /> : expanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
        </button>

        {expanded && assignments !== null && (
          <div style={{ padding: '0 24px 20px' }}>
            {assignments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 14 }}>{t.contrNoAssignments || 'Назначений нет'}</div>
            ) : (
              <>
                {/* Works */}
                {works.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>{t.contrSectionWorks || '🔨 Работы'}</div>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                      <thead>
                        <tr style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>
                          <th style={{ padding: '0 12px', textAlign: 'left', fontWeight: 700 }}>{t.contrColName || 'Наименование'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'center', width: 50, fontWeight: 700 }}>{t.contrColUnit || 'Ед.'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'right', width: 90, fontWeight: 700 }}>{t.contrColQuantity || 'Кол-во'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'right', width: 100, fontWeight: 700 }}>{t.contrColUnitPrice || 'Цена/ед.'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'right', width: 100, fontWeight: 700 }}>{t.contrColSum || 'Сумма'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {works.map(a => (
                          <tr key={a.id} style={{ background: '#f8fafc' }}>
                            <td style={{ padding: '9px 12px', fontSize: 13, color: '#1e293b', borderRadius: '10px 0 0 10px' }}>
                              {a.work_name || '—'}
                              {a.with_materials && <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#d97706', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>{t.contrWithMaterialsBadge || 'С материалами'}</span>}
                            </td>
                            <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: 12, color: '#64748b' }}>{a.work_unit}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{formatNum(a.assigned_quantity)}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, color: '#64748b' }}>{formatNum(a.unit_price)}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1e293b', borderRadius: '0 10px 10px 0' }}>{formatNum(a.total_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Resources */}
                {resources.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>{t.contrSectionResources || '📦 Ресурсы'}</div>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                      <thead>
                        <tr style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>
                          <th style={{ padding: '0 12px', textAlign: 'left', fontWeight: 700 }}>{t.contrColName || 'Наименование'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'center', width: 50, fontWeight: 700 }}>{t.contrColUnit || 'Ед.'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'right', width: 90, fontWeight: 700 }}>{t.contrColQuantity || 'Кол-во'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'right', width: 100, fontWeight: 700 }}>{t.contrColUnitPrice || 'Цена/ед.'}</th>
                          <th style={{ padding: '0 10px', textAlign: 'right', width: 100, fontWeight: 700 }}>{t.contrColSum || 'Сумма'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resources.map(a => (
                          <tr key={a.id} style={{ background: '#f8fafc' }}>
                            <td style={{ padding: '9px 12px', fontSize: 13, color: '#1e293b', borderRadius: '10px 0 0 10px' }}>
                              {a.resource_name || '—'}
                              {a.resource_spec && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{a.resource_spec}</div>}
                            </td>
                            <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: 12, color: '#64748b' }}>{a.resource_unit}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{formatNum(a.assigned_quantity)}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, color: '#64748b' }}>{formatNum(a.unit_price)}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1e293b', borderRadius: '0 10px 10px 0' }}>{formatNum(a.total_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', borderTop: '1px solid #e2e8f0', fontWeight: 800, fontSize: 15 }}>
                  {t.contrTotalAssigned || 'Итого назначено:'} {formatNum(totalAssigned)} ₸
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Approval history */}
      {approvals.length > 0 && (
        <div style={{ borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12 }}>{t.contrApprovalHistoryHeading || 'История согласования'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvals.map((a, i) => {
              const icons = { SUBMITTED: '📤', APPROVED: '✅', REJECTED: '❌', REVISION: '🔁' };
              return (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderBottom: i < approvals.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                  <span style={{ fontSize: 18 }}>{icons[a.action] || '•'}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{a.action}</div>
                    {a.comment && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{a.comment}</div>}
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{formatDate(a.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
