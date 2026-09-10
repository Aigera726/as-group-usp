import React, { useState, useEffect } from 'react';
import api from './api';
import EstimateEditor from './components/EstimateEditor';
import ProjectsPage from './components/ProjectsPage';
import { 
  Plus, 
  FileText, 
  ChevronRight, 
  ChevronLeft,
  Calculator, 
  Layers, 
  Calendar,
  ShieldCheck,
  Clock,
  Trash2,
  FolderPlus,
  Upload,
  X,
  User,
  Briefcase,
  Bell
} from 'lucide-react';
import ru from './lang/ru';
import en from './lang/en';
import ka from './lang/ka';
import az from './lang/az';

const UI_TRANSLATIONS = { ru, en, ka, az };

const VALID_LANGS = ['ru', 'en', 'ka', 'az'];

// Язык, с которым открыли УСП из главной ERP-страницы (?lang=... в ссылке/iframe —
// ERP-ядро и УСП это разные сайты на разных портах, общего localStorage нет).
// Если ссылка пришла без lang (прямой заход), используем то, что выбирали в самой
// УСП в прошлый раз, и только потом дефолт 'ru'.
function getInitialLang() {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (VALID_LANGS.includes(fromUrl)) return fromUrl;
  const stored = localStorage.getItem('uspLang');
  if (VALID_LANGS.includes(stored)) return stored;
  return 'ru';
}

function App() {
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [lang, setLangState] = useState(getInitialLang);
  const setLang = (newLang) => {
    localStorage.setItem('uspLang', newLang);
    setLangState(newLang);
  };
  const [userRole, setUserRole] = useState('employee');

  // ── Estimator (сметчик) state ──────────────────────────────────────────
  const [estimates, setEstimates] = useState([]);
  const [showEstimateCreateModal, setShowEstimateCreateModal] = useState(false);
  const [newEstimateName, setNewEstimateName] = useState('');
  const [isCreatingEstimate, setIsCreatingEstimate] = useState(false);
  // ────────────────────────────────────────────────────────────────────────

  const t = UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.ru;

  useEffect(() => {
    fetchUserProfile();
  }, [lang]);

  // Загружаем список смет когда роль — сметчик
  useEffect(() => {
    if (userRole === 'estimator') {
      fetchEstimates();
    }
  }, [userRole]);

  const fetchUserProfile = async () => {
    try {
      const res = await api.get('/estimates/profile');
      setUserRole(res.data && res.data.role ? res.data.role : 'employee');
    } catch (err) {
      console.error("Ошибка при получении профиля пользователя:", err);
      setUserRole('employee');
    }
  };

  // ── Estimator functions (из старого модуля ДО проекта) ─────────────────
  const fetchEstimates = async () => {
    try {
      const res = await api.get('/estimates/all-test');
      setEstimates(res.data || []);
    } catch (err) {
      console.error('Ошибка при загрузке смет:', err);
    }
  };

  const handleCreateEstimateOld = async (e) => {
    e.preventDefault();
    setIsCreatingEstimate(true);
    try {
      const res = await api.post('/estimates/create', {
        project_id: newEstimateName,
        organization_id: '00000000-0000-0000-0000-000000000000'
      });
      setEstimates(prev => [res.data, ...prev]);
      setShowEstimateCreateModal(false);
      setNewEstimateName('');
      setSelectedDocId(res.data.id); // сразу открываем созданную
    } catch (err) {
      alert('Ошибка создания: ' + err.message);
    } finally {
      setIsCreatingEstimate(false);
    }
  };
  // ────────────────────────────────────────────────────────────────────────

  if (selectedDocId) {
    return (
      <div style={{ padding: '0px', maxWidth: '100%', margin: '0 auto' }}>
        <EstimateEditor 
          docId={selectedDocId} 
          userRole={userRole} 
          resourceLanguage={lang}
          setResourceLanguage={setLang}
          onBack={() => {
            setSelectedDocId(null);
            if (userRole === 'estimator') {
              fetchEstimates();
            }
          }} 
        />
      </div>
    );
  }



  return (
    <ProjectsPage 
      userRole={userRole} 
      lang={lang} 
      setLang={setLang}
      t={t} 
      onOpenEstimate={setSelectedDocId} 
    />
  );
}

export default App;