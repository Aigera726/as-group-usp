import React, { useState, useEffect } from 'react';
import { Plus, List, BarChart2, Briefcase } from 'lucide-react';
import ContractWizard from './contracts/ContractWizard';
import ContractsList from './contracts/ContractsList';
import DistributionAnalytics from './contracts/DistributionAnalytics';

function getTabs(t) {
  return [
    { id: 'list',      label: t.contrTabRegistry || 'Реестр договоров', icon: List },
    { id: 'analytics', label: t.contrTabAnalytics || 'Аналитика распределения', icon: BarChart2 },
  ];
}

export default function ContractsPage({ api, lang, t = {}, userRole }) {
  const TABS = getTabs(t);
  const [activeTab, setActiveTab] = useState('list');
  const [showWizard, setShowWizard] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Top level project & object filters
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [objects, setObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);

  useEffect(() => {
    api.get('/estimates/projects', { params: { lang: lang || 'ru' } })
      .then(r => setProjects(r.data || []))
      .catch(() => {})
      .finally(() => setLoadingProjects(false));
  }, [lang]);

  // Load objects when project is selected
  useEffect(() => {
    if (selectedProjectId) {
      setLoadingObjects(true);
      api.get(`/estimates/projects/${selectedProjectId}/objects`)
        .then(r => setObjects(r.data || []))
        .catch(() => {})
        .finally(() => setLoadingObjects(false));
    } else {
      setObjects([]);
      setSelectedObjectId('');
    }
  }, [selectedProjectId]);

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '850',
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
      gridTemplateColumns: '1fr 1fr auto',
      gap: '16px',
      alignItems: 'end',
      padding: '20px',
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      marginBottom: '24px'
    }}>
      <div>
        <label style={labelStyle}>{t.contrFieldProject || 'Проект'}</label>
        <select
          style={selectStyle}
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setSelectedObjectId('');
          }}
        >
          <option value="">{t.contrSelectProjectPlaceholder || '-- Выберите проект --'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name}</option>)}
        </select>
      </div>

      <div>
        <label style={labelStyle}>{t.contrFieldObjectFilter || 'Объект'}</label>
        <select
          style={selectStyle}
          value={selectedObjectId}
          onChange={(e) => setSelectedObjectId(e.target.value)}
          disabled={!selectedProjectId}
        >
          <option value="">{t.contrSelectAllObjectsPlaceholder || '-- Все объекты / Весь проект --'}</option>
          {objects.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div>
        <button
          onClick={() => setShowWizard(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '11px 24px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: '#ffffff',
            border: 'none',
            fontWeight: '900',
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(37,99,235,0.2)',
            height: '42px',
            boxSizing: 'border-box',
            transition: 'all 0.2s'
          }}
        >
          <Plus size={16} /> {t.contrNewContractBtn || 'Новый договор'}
        </button>
      </div>
    </div>
  );

  // ── Wizard ──────────────────────────────────────────────────────────────────
  if (showWizard) {
    return (
      <div>
        {/* Wizard header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 32, paddingBottom: 20, borderBottom: '1px solid #e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase size={24} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22, color: '#1e293b' }}>{t.contrNewContractBtn || 'Новый договор'}</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>{t.contrWizardSubtitle || 'Пошаговое создание и распределение работ/ресурсов'}</p>
            </div>
          </div>
        </div>

        <ContractWizard
          api={api}
          preselectedProjectId={selectedProjectId}
          preselectedObjectId={selectedObjectId}
          onDone={() => { setShowWizard(false); setActiveTab('list'); }}
          onCancel={() => setShowWizard(false)}
          t={t}
        />
      </div>
    );
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <h2 style={{ margin: '0 0 24px 0', fontWeight: 900, fontSize: 22, color: '#1e293b' }}>{t.contrPageTitle || 'Договора'}</h2>

      {selectorsMarkup}

      {!selectedProjectId ? (
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <Briefcase size={48} color="#94a3b8" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
          <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '800', color: '#1e293b' }}>{t.contrNoProjectSelectedTitle || 'Проект не выбран'}</h3>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{t.contrNoProjectSelectedText || 'Пожалуйста, выберите проект сверху для работы с реестром договоров и аналитикой.'}</p>
        </div>
      ) : (
        <>
          {/* Tab navigation */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e2e8f0', marginBottom: 28 }}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 20px', fontSize: 14, fontWeight: 700,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: active ? '#2563eb' : '#64748b',
                    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
                    marginBottom: -2, transition: 'all .2s',
                  }}
                >
                  <Icon size={16} /> {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTab === 'list' && (
            <ContractsList
              api={api}
              projects={projects}
              userRole={userRole}
              selectedProjectId={selectedProjectId}
              selectedObjectId={selectedObjectId}
              t={t}
            />
          )}
          {activeTab === 'analytics' && (
            <DistributionAnalytics
              api={api}
              projects={projects}
              selectedProjectId={selectedProjectId}
              selectedObjectId={selectedObjectId}
            />
          )}
        </>
      )}
    </div>
  );
}
