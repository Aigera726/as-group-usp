import ObjectCreateModal from './objects/ObjectCreateModal';
import ObjectPsdModal from './objects/ObjectPsdModal';
import ObjectDetailsView from './objects/ObjectDetailsView';
import AddressMapModal from './AddressMapModal';
import SchedulingTab from './objects/SchedulingTab';
import React, { useState, useEffect, useRef } from 'react';
import api from '../api';
import DictionariesPage from './DictionariesPage';
import EstimateEditor from './EstimateEditor';
import EstimatesPage from './EstimatesPage';
import CalendarPlanningPage from './CalendarPlanningPage';
import GprPage from './GprPage';
import GpmPage from './GpmPage';
import ContractsPage from './ContractsPage';
import OperFactsPage from './OperFactsPage';



import {
  Edit2,
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
  Bell,
  MapPin,
  Table,
  Truck,
  ClipboardCheck
} from 'lucide-react';

const getCleanFilename = (fullName) => {
  if (!fullName) return '';
  const match = fullName.match(/^\d+-\d+-(.+)$/) || fullName.match(/^\d+-(.+)$/);
  return match ? match[1] : fullName;
};

const getStatusBadgeStyle = (status) => {
  switch (status) {
    case 'inactive':
      return { background: '#fee2e2', color: '#991b1b' };
    case 'prospect':
      return { background: '#eff6ff', color: '#1e40af' };
    case 'under_approval':
      return { background: '#fef3c7', color: '#92400e' };
    case 'approval_rejected':
      return { background: '#fef2f2', color: '#b91c1c' };
    case 'approved':
      return { background: '#d1fae5', color: '#065f46' };
    case 'active':
      return { background: '#ecfdf5', color: '#047857' };
    case 'suspended':
      return { background: '#f5f5f5', color: '#404040' };
    case 'completed':
      return { background: '#faf5ff', color: '#6b21a8' };
    default:
      return { background: '#e2e8f0', color: '#475569' };
  }
};

const getEstimateStatusBadgeStyle = (status) => {
  switch (status) {
    case 'not_started':
      return { background: '#fee2e2', color: '#991b1b' };
    case 'draft':
      return { background: '#e2e8f0', color: '#475569' };
    case 'approved':
      return { background: '#d1fae5', color: '#065f46' };
    default:
      return { background: '#e2e8f0', color: '#475569' };
  }
};

function ProjectsPage({ userRole, lang, setLang, t, onOpenEstimate }) {

  const [activeTab, setActiveTab] = useState('estimates'); // 'estimates' | 'dictionaries'
  const [scheduleTarget, setScheduleTarget] = useState(null); // { projectId, objectId, estimateId } — preselect for "Календарное планирование"
  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  
  useEffect(() => {
    if (userRole === 'pricer') {
      setActiveTab('dictionaries');
    } else if (userRole === 'financial_director') {
      setActiveTab('all_estimates');
    }
  }, [userRole]);

  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, prospect: 0 });
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // Project-Objects (Estimates tab) state
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectObjects, setProjectObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [showCreateObjectModal, setShowCreateObjectModal] = useState(false);
  const [objectForm, setObjectForm] = useState({ name: '', description: '', address: '', latitude: '', longitude: '' });
  const [leafletLoaded, setLeafletLoaded] = useState(!!window.L);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingObjectId, setEditingObjectId] = useState(null);
  const [objectResponsibleId, setObjectResponsibleId] = useState('');
  const [objectResponsibleSearch, setObjectResponsibleSearch] = useState('');
  const [showObjectResponsibleDropdown, setShowObjectResponsibleDropdown] = useState(false);

  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersGroupRef = useRef(null);

  // Dictionaries state
  const [dictionaries, setDictionaries] = useState({
    regions: [],
    managers: [],
    object_types: [],
    customers: [],
    statuses: [],
    next_code: ''
  });

  // Form states (Create)
  const [code, setCode] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [projectAddress, setProjectAddress] = useState('');
  const [isProjectCreateMapOpen, setIsProjectCreateMapOpen] = useState(false);
  const [isProjectEditMapOpen, setIsProjectEditMapOpen] = useState(false);
  const [isObjectEditMapOpen, setIsObjectEditMapOpen] = useState(false);
  const [name, setName] = useState('');
  const [objectType, setObjectType] = useState('');
  const [customer, setCustomer] = useState('');
  const [selectedCountryId, setSelectedCountryId] = useState('');
  const [editCountryId, setEditCountryId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [managerId, setManagerId] = useState('');
  const [managerSearch, setManagerSearch] = useState('');
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const [documentInput, setDocumentInput] = useState('');
  const [documents, setDocuments] = useState([]);

  // Form states (Edit / Detail)
  const [editingProject, setEditingProject] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLatitude, setEditLatitude] = useState('');
  const [editLongitude, setEditLongitude] = useState('');
  const [editProjectAddress, setEditProjectAddress] = useState('');
  const [editObjectType, setEditObjectType] = useState('');
  const [editCustomer, setEditCustomer] = useState('');
  const [editRegionId, setEditRegionId] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editManagerId, setEditManagerId] = useState('');
  const [editManagerSearch, setEditManagerSearch] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editDocuments, setEditDocuments] = useState([]);
  const [editShowManagerDropdown, setEditShowManagerDropdown] = useState(false);
  const [editFormErrors, setEditFormErrors] = useState({});
  const [editErrorMessage, setEditErrorMessage] = useState('');

  // Validation
  const [formErrors, setFormErrors] = useState({});
  const [errorMessage, setErrorMessage] = useState('');

  // Stage 7 States
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvingProjectId, setApprovingProjectId] = useState(null);
  const [selectedDirectorId, setSelectedDirectorId] = useState('');
  const [directorsList, setDirectorsList] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);

  // Stage 8 States
  const [showApproveConfirmModal, setShowApproveConfirmModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [highlightedProjectId, setHighlightedProjectId] = useState(null);
  const [highlightedEstimateId, setHighlightedEstimateId] = useState(null);

  // Object Card detailed view states
  const [selectedObject, setSelectedObject] = useState(null);
  const [objectActiveTab, setObjectActiveTab] = useState('info');
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [schedulingData, setSchedulingData] = useState(null);
  const [loadingScheduling, setLoadingScheduling] = useState(false);

  // PSD Document states
  const [psdDocs, setPsdDocs] = useState([]);
  const [loadingPsdDocs, setLoadingPsdDocs] = useState(false);
  const [showPsdModal, setShowPsdModal] = useState(false);
  const [psdEditingDoc, setPsdEditingDoc] = useState(null);
  const [psdFormName, setPsdFormName] = useState('');
  const [psdFormTypeId, setPsdFormTypeId] = useState('');
  const [psdFormVersion, setPsdFormVersion] = useState('1.0');
  const [psdFormNotes, setPsdFormNotes] = useState('');
  const [psdFormUrl, setPsdFormUrl] = useState('');
  const [psdFormFile, setPsdFormFile] = useState(null);
  const [psdFormFileName, setPsdFormFileName] = useState('');
  const [psdFormErrors, setPsdFormErrors] = useState({});
  const [psdErrorMessage, setPsdErrorMessage] = useState('');

  // PSD Document states

  // States for object info edit form
  const [editObjectName, setEditObjectName] = useState('');
  const [editObjectDescription, setEditObjectDescription] = useState('');
  const [editObjectResponsibleId, setEditObjectResponsibleId] = useState('');
  const [editObjectResponsibleSearch, setEditObjectResponsibleSearch] = useState('');
  const [editObjectAddress, setEditObjectAddress] = useState('');
  const [editObjectLatitude, setEditObjectLatitude] = useState('');
  const [editObjectLongitude, setEditObjectLongitude] = useState('');
  const [showEditObjectResponsibleDropdown, setShowEditObjectResponsibleDropdown] = useState(false);
  const [objectFormErrors, setObjectFormErrors] = useState({});
  const [editObjectErrorMessage, setEditObjectErrorMessage] = useState('');

  // Object Card detailed view states

  // States for object info edit form

  const handleApproveProject = async () => {
    setIsSaving(true);
    try {
      await api.post(`/estimates/projects/${editingProject.id}/approve`);
      alert(t.PROJECT_APPROVED_SUCCESS || 'Проект успешно утвержден.');
      setShowApproveConfirmModal(false);
      setEditingProject(null);
      setActiveTab('dictionaries');
      fetchProjects();
      fetchNotifications();
    } catch (err) {
      alert("Ошибка при утверждении проекта: " + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRejectProject = async (e) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      alert(t.validationRejectionReasonRequired || 'Укажите причину отклонения проекта!');
      return;
    }
    setIsSaving(true);
    try {
      await api.post(`/estimates/projects/${editingProject.id}/reject`, {
        comment: rejectionReason
      });
      alert(t.PROJECT_REJECTED_SUCCESS || 'Проект успешно отклонен.');
      setShowRejectModal(false);
      setRejectionReason('');
      setEditingProject(null);
      setActiveTab('dictionaries');
      fetchProjects();
      fetchNotifications();
    } catch (err) {
      alert("Ошибка при отклонении проекта: " + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = (nextCodeValue = '') => {
    setCode(nextCodeValue);
    setName('');
    setObjectType('');
    setCustomer('');
    setSelectedCountryId('');
    setRegionId('');
    setStartDate('');
    setEndDate('');
    setManagerId('');
    setManagerSearch('');
    setShowManagerDropdown(false);
    setDocuments([]);
    setDocumentInput('');
    setFormErrors({});
    setErrorMessage('');
  };

  const handleOpenCreateModal = () => {
    resetForm(dictionaries.next_code || '');
    setShowCreateModal(true);
  };

  useEffect(() => {
    fetchProjects();
    fetchDictionaries();
    fetchNotifications();
    fetchDirectorsList();

    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [lang, showInactive]);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/estimates/notifications');
      setNotifications(res.data && Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (err.message === 'Network Error') {
        console.warn("[Notifications] Сервер недоступен (Network Error). Проверьте запуск бэкенда на порту 8004.");
      } else {
        console.error("Ошибка при загрузке уведомлений:", err);
      }
      setNotifications([]);
    }
  };

  const fetchDirectorsList = async () => {
    try {
      const res = await api.get('/estimates/directors');
      setDirectorsList(res.data && Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Ошибка при получении списка директоров:", err);
      setDirectorsList([]);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/estimates/projects/stats');
      if (res.data) {
        setStats(res.data);
      }
    } catch (err) {
      console.error("Ошибка при загрузке статистики проектов:", err);
    }
  };

  // Dynamic Leaflet loader
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      document.body.appendChild(script);
    }
  }, []);

  // Leaflet loading detector
  useEffect(() => {
    if (window.L) {
      setLeafletLoaded(true);
      return;
    }
    const checkInterval = setInterval(() => {
      if (window.L) {
        setLeafletLoaded(true);
        clearInterval(checkInterval);
      }
    }, 100);
    return () => clearInterval(checkInterval);
  }, []);

  // Close notifications dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      const bellButton = document.getElementById('notifications-bell-btn');
      const dropdown = document.getElementById('notifications-dropdown-content');
      if (bellButton && dropdown && !bellButton.contains(e.target) && !dropdown.contains(e.target)) {
        setShowNotificationsDropdown(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // Fetch project objects helper
  const fetchProjectObjects = async (projId) => {
    if (!projId) return;
    setLoadingObjects(true);
    try {
      const res = await api.get(`/estimates/projects/${projId}/objects`);
      setProjectObjects(res.data || []);
    } catch (err) {
      console.error("Error fetching project objects:", err);
    } finally {
      setLoadingObjects(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'estimates' && selectedProjectId) {
      fetchProjectObjects(selectedProjectId);
    }
  }, [selectedProjectId, activeTab]);

  // Select first approved project by default in Estimates tab
  useEffect(() => {
    if (activeTab === 'estimates' && projects.length > 0 && !selectedProjectId) {
      const approvedList = projects.filter(p => p.status === 'approved' || p.status === 'active' || p.status === 'suspended' || p.status === 'completed');
      if (approvedList.length > 0) {
        setSelectedProjectId(approvedList[0].id);
      }
    }
  }, [activeTab, projects, selectedProjectId]);

  // Sync Leaflet map with objects (CartoDB Premium style)
  useEffect(() => {
    if (selectedObject || !mapRef.current) {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markersGroupRef.current = null;
      }
      return;
    }

    if (!leafletLoaded || !window.L) return;

    if (!leafletMapRef.current) {
      // Add pulsing marker CSS keyframe
      if (!document.getElementById('leaflet-custom-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'leaflet-custom-pulse-style';
        style.innerHTML = `
          @keyframes mapPulse {
            0% { transform: scale(0.6); opacity: 1; }
            100% { transform: scale(1.4); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }

      leafletMapRef.current = window.L.map(mapRef.current, { attributionControl: false }).setView([40.4093, 49.8671], 12);
      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
      }).addTo(leafletMapRef.current);
      markersGroupRef.current = window.L.featureGroup().addTo(leafletMapRef.current);
    }

    if (markersGroupRef.current) {
      markersGroupRef.current.clearLayers();
    }

    const objectsWithCoords = projectObjects.filter(obj => obj.latitude !== null && obj.latitude !== undefined && obj.latitude !== '' && obj.longitude !== null && obj.longitude !== undefined && obj.longitude !== '');
    const selectedProject = projects.find(p => p.id === selectedProjectId);

    // Define premium custom div icons
    const projectIcon = window.L.divIcon({
      html: `
        <div style="position: relative; width: 36px; height: 36px;">
          <div style="position: absolute; top: 0; left: 0; width: 36px; height: 36px; background: rgba(59, 130, 246, 0.25); border-radius: 50%; animation: mapPulse 2s infinite;"></div>
          <div style="position: absolute; top: 8px; left: 8px; width: 20px; height: 20px; background: #2563eb; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="color: white;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </div>
        </div>
      `,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });

    const objectIcon = window.L.divIcon({
      html: `
        <div style="position: relative; width: 24px; height: 24px;">
          <div style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; background: #ef4444; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 3px 8px rgba(0,0,0,0.15);"></div>
        </div>
      `,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12]
    });

    // Sync project marker if it has coordinates
    if (selectedProject && selectedProject.latitude !== null && selectedProject.latitude !== undefined && selectedProject.latitude !== '' && selectedProject.longitude !== null && selectedProject.longitude !== undefined && selectedProject.longitude !== '') {
      window.L.marker([parseFloat(selectedProject.latitude), parseFloat(selectedProject.longitude)], { icon: projectIcon })
        .bindPopup(`<b>Проект: ${selectedProject.name}</b>${selectedProject.address ? `<br/>📍 ${selectedProject.address}` : ''}<br/>Код: ${selectedProject.code}`)
        .addTo(markersGroupRef.current);
    }

    objectsWithCoords.forEach(obj => {
      window.L.marker([parseFloat(obj.latitude), parseFloat(obj.longitude)], { icon: objectIcon })
        .bindPopup(`<b>${obj.name}</b><br/>${obj.address || ''}<br/>${obj.description || ''}`)
        .addTo(markersGroupRef.current);
    });

    const hasMarkers = objectsWithCoords.length > 0 || (selectedProject && selectedProject.latitude && selectedProject.longitude);
    if (hasMarkers && leafletMapRef.current && markersGroupRef.current) {
      try {
        leafletMapRef.current.fitBounds(markersGroupRef.current.getBounds(), { padding: [30, 30] });
      } catch (err) {
        console.error(err);
      }
    }
  }, [projectObjects, leafletLoaded, activeTab, selectedProjectId, projects, selectedObject]);

  const handleCreateObject = async (e) => {
    e.preventDefault();
    if (!objectForm.name) {
      alert("Название объекта обязательно для заполнения");
      return;
    }
    setIsSaving(true);
    try {
      let lat = objectForm.latitude;
      let lng = objectForm.longitude;

      if (editingObjectId) {
        // Edit mode
        await api.put(`/estimates/projects/${selectedProjectId}/objects/${editingObjectId}`, {
          name: objectForm.name,
          description: objectForm.description,
          address: objectForm.address,
          latitude: lat ? parseFloat(lat) : null,
          longitude: lng ? parseFloat(lng) : null,
          responsible_id: objectResponsibleId || null,
          custom_responsible_name: objectResponsibleId ? null : objectResponsibleSearch
        });
      } else {
        // Create mode
        await api.post(`/estimates/projects/${selectedProjectId}/objects`, {
          name: objectForm.name,
          description: objectForm.description,
          address: objectForm.address,
          latitude: lat ? parseFloat(lat) : null,
          longitude: lng ? parseFloat(lng) : null,
          responsible_id: objectResponsibleId || null,
          custom_responsible_name: objectResponsibleId ? null : objectResponsibleSearch
        });
      }
      await fetchProjectObjects(selectedProjectId);
      setShowCreateObjectModal(false);
      setEditingObjectId(null);
      setObjectForm({ name: '', description: '', address: '', latitude: '', longitude: '' });
    } catch (err) {
      alert(err.response?.data?.error || "Ошибка при сохранении объекта");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteObject = async (objectId) => {
    if (!window.confirm("Вы уверены, что хотите удалить этот объект? Все сметы, привязанные к этому объекту, потеряют привязку к нему.")) return;
    try {
      await api.delete(`/estimates/projects/${selectedProjectId}/objects/${objectId}`);
      await fetchProjectObjects(selectedProjectId);
    } catch (err) {
      alert("Ошибка при удалении объекта: " + (err.response?.data?.error || err.message));
    }
  };

  const handleOpenEditObject = (obj) => {
    setEditingObjectId(obj.id);
    setObjectForm({
      name: obj.name,
      description: obj.description || '',
      address: obj.address || '',
      latitude: obj.latitude || '',
      longitude: obj.longitude || ''
    });
    setObjectResponsibleId(obj.responsible_id || '');
    setObjectResponsibleSearch(obj.responsible_name || '');
    setShowCreateObjectModal(true);
  };

  const handleOpenCreateObject = () => {
    setEditingObjectId(null);
    setObjectForm({ name: '', description: '', address: '', latitude: '', longitude: '' });
    
    // Default to selected project manager
    const selectedProject = projects.find(p => p.id === selectedProjectId);
    if (selectedProject) {
      setObjectResponsibleId(selectedProject.manager_id || '');
      setObjectResponsibleSearch(selectedProject.manager_name || selectedProject.custom_manager_name || '');
    } else {
      setObjectResponsibleId('');
      setObjectResponsibleSearch('');
    }
    
    setShowCreateObjectModal(true);
  };

  const fetchProjects = async () => {
    try {
      const res = await api.get(`/estimates/projects?lang=${lang}&show_inactive=${showInactive}`);
      setProjects(res.data && Array.isArray(res.data) ? res.data : []);
      setLoading(false);
      fetchStats();
    } catch (err) {
      console.error("Ошибка при загрузке проектов:", err);
      setProjects([]);
      setLoading(false);
    }
  };

  const fetchDictionaries = async () => {
    try {
      const res = await api.get(`/estimates/projects/dictionaries?lang=${lang}`);
      setDictionaries(res.data || { regions: [], managers: [], object_types: [], customers: [], next_code: '' });
    } catch (err) {
      console.error("Ошибка при загрузке справочников:", err);
    }
  };

  const handleOpenEstimate = async (project) => {
    try {
      const res = await api.get(`/estimates/projects/${project.id}/estimate`);
      if (res.data && res.data.id) {
        onOpenEstimate(res.data.id);
      } else {
        alert("Смета не найдена. Пожалуйста, создайте смету.");
      }
    } catch (err) {
      console.error("Ошибка при получении сметы:", err);
    }
  };

  const getProjectCurrencyId = (projectId) => {
    const proj = (projects || []).find(p => p.id === projectId);
    if (!proj || !proj.region_id) return null;
    const reg = (dictionaries.regions || []).find(r => r.id === proj.region_id);
    if (!reg || !reg.country_id) return null;
    const country = (dictionaries.countries || []).find(c => c.id === reg.country_id);
    return country ? country.currency_id : null;
  };

  const handleCreateEstimate = async (projectId, objectId = null) => {
    if (!window.confirm("Создать смету для этого проекта? Статус сметы изменится на Черновик.")) return;
    try {
      const res = await api.post(`/estimates/projects/${projectId}/create-estimate`, {
        organization_id: '741be209-ad6f-4483-92ee-298a36899bcf', // default organization
        lang: lang,
        objectId: objectId
      });

      // Автоматически сохраняем валюту проекта в только что созданную смету
      const currencyId = getProjectCurrencyId(projectId);
      if (currencyId && res.data?.id) {
        try {
          await api.post(`/estimates/${res.data.id}/save`, {
            currency_id: currencyId,
            wbs: [],
            works: [],
            resources: [],
            coefficients: []
          });
        } catch (saveErr) {
          console.error("Ошибка при сохранении валюты в новую смету:", saveErr);
        }
      }

      await fetchProjects();
      if (projectId === selectedProjectId) {
        await fetchProjectObjects(projectId);
      }
      // If creating estimate inside an object view, switch to Object's "Смета" tab
      if (objectId || selectedObjectId) {
        setObjectActiveTab('estimate');
      } else if (onOpenEstimate) {
        onOpenEstimate(res.data.id);
      }
    } catch (err) {
      alert("Ошибка при создании сметы: " + err.message);
    }
  };

  const handleOpenDocument = async (docName) => {
    try {
      const fileUrl = `http://${window.location.hostname}:8004/api/estimates/uploads/${docName}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('File download failed');
      const blob = await response.blob();
      const cleanName = getCleanFilename(docName);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = cleanName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const fileUrl = `http://${window.location.hostname}:8004/api/estimates/uploads/${docName}`;
      window.open(fileUrl, '_blank');
    }
  };

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const newDocs = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          const res = await api.post('/estimates/projects/upload', formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          });
          if (res.data && res.data.filename) {
            newDocs.push(res.data.filename);
          }
        } catch (err) {
          alert('Ошибка при загрузке файла: ' + (err.response?.data?.error || err.message));
        }
      }
      setDocuments([...documents, ...newDocs]);
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  };

  const handleRemoveDocument = (idx) => {
    setDocuments(documents.filter((_, i) => i !== idx));
  };

  const handleOpenEdit = (project) => {
    setHighlightedProjectId(null);
    setEditingProject(project);
    setEditName(project.name);
    setEditObjectType(project.object_type);
    setEditCustomer(project.customer);
    setEditRegionId(project.region_id);
    const matchedReg = (dictionaries.regions || []).find(r => r.id === project.region_id);
    setEditCountryId(matchedReg ? matchedReg.country_id : '');
    
    const sDate = project.start_date ? new Date(project.start_date).toISOString().substring(0, 10) : '';
    const eDate = project.end_date ? new Date(project.end_date).toISOString().substring(0, 10) : '';
    setEditStartDate(sDate);
    setEditEndDate(eDate);
    
    setEditManagerId(project.manager_id || '');
    setEditManagerSearch(project.manager_name || '');
    setEditStatus(project.status || 'prospect');
    setEditDocuments(project.documents || []);
    setEditLatitude(project.latitude || '');
    setEditLongitude(project.longitude || '');
    setEditProjectAddress(project.address || '');
    setEditShowManagerDropdown(false);
    setEditFormErrors({});
    setEditErrorMessage('');
  };

  const handleUpdateProject = async (e) => {
    e.preventDefault();
    setEditErrorMessage('');

    const errors = {};
    if (!editName.trim()) errors.name = true;
    if (!editObjectType) errors.objectType = true;
    if (!editCustomer) errors.customer = true;
    if (!editRegionId) errors.regionId = true;
    if (!editStartDate) errors.startDate = true;
    if (!editManagerSearch.trim()) errors.managerSearch = true;

    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors);
      setEditErrorMessage(t.validationError);
      return;
    }

    if (editEndDate && editEndDate <= editStartDate) {
      errors.endDate = true;
      setEditFormErrors(errors);
      setEditErrorMessage(t.errEndDateBeforeStartDate || 'Дата окончания проекта не может быть меньше или равна дате начала');
      return;
    }

    setEditFormErrors({});
    setIsSaving(true);

    let finalManagerId = editManagerId;
    let finalCustomName = null;

    const matchedManager = dictionaries.managers.find(
      m => `${m.first_name} ${m.last_name}`.toLowerCase() === editManagerSearch.trim().toLowerCase()
    );

    if (matchedManager) {
      finalManagerId = matchedManager.id;
    } else if (editManagerSearch.trim()) {
      finalManagerId = null;
      finalCustomName = editManagerSearch.trim();
    }

    try {
      let lat = editLatitude;
      let lng = editLongitude;
      if (editProjectAddress && (!lat || !lng)) {
        const coords = await geocodeAddress(editProjectAddress);
        if (coords) {
          lat = coords.latitude;
          lng = coords.longitude;
        }
      }

      await api.put(`/estimates/projects/${editingProject.id}`, {
        name: editName,
        object_type: editObjectType,
        customer: editCustomer,
        region_id: editRegionId,
        start_date: editStartDate,
        end_date: editEndDate || null,
        manager_id: finalManagerId,
        custom_manager_name: finalCustomName,
        status: editStatus,
        documents: editDocuments,
        latitude: lat || null,
        longitude: lng || null,
        address: editProjectAddress || null
      });

      const updatedProject = {
        ...editingProject,
        name: editName,
        object_type: editObjectType,
        customer: editCustomer,
        region_id: editRegionId,
        start_date: editStartDate,
        end_date: editEndDate || null,
        manager_id: finalManagerId,
        manager_name: editManagerSearch,
        status: editStatus,
        documents: editDocuments,
        latitude: editLatitude ? parseFloat(editLatitude) : null,
        longitude: editLongitude ? parseFloat(editLongitude) : null,
        address: editProjectAddress || null
      };
      setEditingProject(null);
      setActiveTab('dictionaries');
      alert(t.projectUpdatedSuccess || "Проект успешно обновлен!");
      fetchProjects();
      fetchDictionaries();
    } catch (err) {
      const errText = err.response?.data?.error || err.message;
      setEditErrorMessage(errText);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const newDocs = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          const res = await api.post('/estimates/projects/upload', formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          });
          if (res.data && res.data.filename) {
            newDocs.push(res.data.filename);
          }
        } catch (err) {
          alert('Ошибка при загрузке файла: ' + (err.response?.data?.error || err.message));
        }
      }
      setEditDocuments([...editDocuments, ...newDocs]);
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  };

  const handleRemoveEditDocument = (idx) => {
    setEditDocuments(editDocuments.filter((_, i) => i !== idx));
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    
    const errors = {};
    if (!code.trim()) errors.code = true;
    if (!name.trim()) errors.name = true;
    if (!objectType) errors.objectType = true;
    if (!customer) errors.customer = true;
    if (!regionId) errors.regionId = true;
    if (!startDate) errors.startDate = true;
    if (!managerSearch.trim()) errors.managerSearch = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setErrorMessage(t.validationError);
      return;
    }

    // Date checks without timezone shifts
    const todayStr = new Date().toLocaleDateString('en-CA');
    if (startDate < todayStr) {
      errors.startDate = true;
      setFormErrors(errors);
      setErrorMessage(t.errStartDateBeforeToday || 'Дата начала не может быть меньше текущей даты');
      return;
    }

    if (endDate && endDate <= startDate) {
      errors.endDate = true;
      setFormErrors(errors);
      setErrorMessage(t.errEndDateBeforeStartDate || 'Дата окончания проекта не может быть меньше или равна дате начала');
      return;
    }

    setFormErrors({});
    setIsSaving(true);

    let finalManagerId = managerId;
    let finalCustomName = null;

    const matchedManager = dictionaries.managers.find(
      m => `${m.first_name} ${m.last_name}`.toLowerCase() === managerSearch.trim().toLowerCase()
    );

    if (matchedManager) {
      finalManagerId = matchedManager.id;
    } else if (managerSearch.trim()) {
      finalManagerId = null;
      finalCustomName = managerSearch.trim();
    }

    try {
      let lat = latitude;
      let lng = longitude;
      if (projectAddress && (!lat || !lng)) {
        const coords = await geocodeAddress(projectAddress);
        if (coords) {
          lat = coords.latitude;
          lng = coords.longitude;
        }
      }

      await api.post('/estimates/projects', {
        code,
        name,
        object_type: objectType,
        customer,
        region_id: regionId,
        start_date: startDate,
        end_date: endDate || null,
        manager_id: finalManagerId,
        custom_manager_name: finalCustomName,
        documents,
        organization_id: '741be209-ad6f-4483-92ee-298a36899bcf',
        latitude: lat || null,
        longitude: lng || null,
        address: projectAddress || null
      });

      resetForm();
      setShowCreateModal(false);
      fetchProjects();
      fetchDictionaries();
    } catch (err) {
      const errText = err.response?.data?.error || err.message;
      setErrorMessage(errText);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProject = async (projectId) => {
    const confirmMsg = userRole === 'manager' ? t.confirmDeactivate : t.confirmDelete;
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.delete(`/estimates/projects/${projectId}`);
      fetchProjects();
    } catch (err) {
      alert("Ошибка при удалении проекта: " + err.message);
    }
  };

  const handleActivateProject = async (projectId) => {
    if (!window.confirm(t.confirmActivate)) return;
    try {
      await api.post(`/estimates/projects/${projectId}/activate`);
      fetchProjects();
    } catch (err) {
      alert("Ошибка при активации проекта: " + err.message);
    }
  };

  const handleOpenApprovalModal = (projectId) => {
    setApprovingProjectId(projectId);
    setSelectedDirectorId('');
    setShowApprovalModal(true);
  };

  const handleSendForApproval = async () => {
    if (!selectedDirectorId) {
      alert(t.selectApproverPlaceholder || 'Пожалуйста, выберите утверждающего директора');
      return;
    }
    try {
      await api.post(`/estimates/projects/${approvingProjectId}/send-for-approval`, {
        approval_user_id: selectedDirectorId
      });
      alert(t.PROJECT_SENT_FOR_APPROVAL || 'Проект успешно отправлен на утверждение');
      setShowApprovalModal(false);
      setEditingProject(null);
      setActiveTab('dictionaries');
      fetchProjects();
      fetchNotifications();
    } catch (err) {
      const errCode = err.response?.data?.error;
      if (errCode === 'PROJECT_STATUS_INVALID') {
        alert(t.PROJECT_STATUS_INVALID || 'Отправка на утверждение доступна только для проектов со статусом "Перспективный"');
      } else {
        alert("Ошибка при отправке на утверждение: " + (err.response?.data?.error || err.message));
      }
    }
  };

  const handleReadNotification = async (notificationId) => {
    try {
      await api.patch(`/estimates/notifications/${notificationId}/read`);
      fetchNotifications();
    } catch (err) {
      console.error("Ошибка при чтении уведомления:", err);
    }
  };

  const handleNotificationClick = async (n) => {
    if (!n.is_read) {
      await handleReadNotification(n.id);
    }

    const isEstimateCode = n.message_code === 'ESTIMATE_APPROVAL_NOTIFICATION' || n.message_code === 'ESTIMATE_DECISION_NOTIFICATION';

    if (isEstimateCode) {
      // Отправка/решение по плановой версии сметы: открыть реестр смет и подсветить нужную строку
      setHighlightedEstimateId(n.estimate_doc_id || null);
      setEditingProject(null);
      setActiveTab('all_estimates');
      setShowNotificationsDropdown(false);
      return;
    }

    setHighlightedProjectId(n.project_id);
    setEditingProject(null); // Close edit sidebar to show the list

    const isApprovedCode = n.message_code === 'PROJECT_APPROVED_MANAGER_NOTIFICATION' || n.message_code === 'PROJECT_APPROVED_NOTIFICATION';

    if (isApprovedCode) {
      // Approved project: select in Estimates and open Estimates tab
      setSelectedProjectId(n.project_id);
      setActiveTab('estimates');
    } else {
      // Rejection or approval request: open Dictionaries (Projects tab)
      setActiveTab('dictionaries');
    }

    setShowNotificationsDropdown(false);
  };

  const handleReadAllNotifications = async () => {
    try {
      await api.post('/estimates/notifications/read-all');
      fetchNotifications();
    } catch (err) {
      console.error("Ошибка при чтении всех уведомлений:", err);
    }
  };

  function renderApproveModal() {
    if (!showApproveConfirmModal) return null;
    return (
      <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
        <div className="modal-content" style={{ maxWidth: '440px', width: '100%', borderRadius: '20px', padding: '24px', background: 'white' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>
            {t.btnApprove || 'Утвердить проект'}
          </h3>
          <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5', margin: '0 0 24px 0', fontWeight: '500' }}>
            {t.PROJECT_APPROVAL_CONFIRM || 'Вы действительно хотите утвердить проект?'}
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => setShowApproveConfirmModal(false)}
              style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
              disabled={isSaving}
            >
              {t.btnCancel}
            </button>
            <button
              type="button"
              onClick={handleApproveProject}
              className="btn-primary"
              style={{ flex: 1, justifyContent: 'center', background: '#10b981', borderRadius: '12px', fontWeight: '700', color: 'white', border: 'none', padding: '12px', cursor: 'pointer' }}
              disabled={isSaving}
            >
              {isSaving ? 'Сохранение...' : (t.btnYesSend ? 'Да' : 'Да')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderApprovalModal() {
    if (!showApprovalModal) return null;
    return (
      <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
        <div className="modal-content" style={{ maxWidth: '460px', width: '100%', borderRadius: '20px', padding: '24px', background: 'white' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>
            {t.sendForApproval || 'Отправить на утверждение'}
          </h3>
          <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5', margin: '0 0 20px 0', fontWeight: '500' }}>
            {t.selectApproverPlaceholder || 'Выберите утверждающего директора'}
          </p>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '8px' }}>
              {t.director || 'Директор'}
            </label>
            <select
              value={selectedDirectorId}
              onChange={(e) => setSelectedDirectorId(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '2px solid #e2e8f0', fontSize: '14px', fontWeight: '600', outline: 'none' }}
            >
              <option value="">{t.selectDirector || 'Выберите директора'}</option>
              {directorsList.map(director => (
                <option key={director.id} value={director.id}>
                  {director.first_name} {director.last_name}
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => setShowApprovalModal(false)}
              style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
            >
              {t.btnCancel || 'Отмена'}
            </button>
            <button
              type="button"
              onClick={handleSendForApproval}
              className="btn-primary"
              style={{ flex: 1, justifyContent: 'center', background: '#3b82f6', borderRadius: '12px', fontWeight: '700', color: 'white', border: 'none', padding: '12px', cursor: 'pointer' }}
            >
              {t.btnSend || 'Отправить'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderRejectModal() {
    if (!showRejectModal) return null;
    return (
      <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
        <form onSubmit={handleRejectProject} className="modal-content" style={{ maxWidth: '460px', width: '100%', borderRadius: '20px', padding: '24px', background: 'white' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>
            {t.btnReject || 'Отклонить утверждение'}
          </h3>
          <p style={{ color: '#64748b', fontSize: '13px', lineHeight: '1.4', margin: '0 0 20px 0', fontWeight: '500' }}>
            {t.PROJECT_REJECT_CONFIRM || 'Для отклонения проекта необходимо указать причину.'}
          </p>
          
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>
              {t.rejectionReasonLabel || 'Причина отклонения'} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              required
              autoFocus
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t.rejectionReasonPlaceholder || 'Введите причину отклонения...'}
              rows={4}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '12px',
                border: '2px solid #e2e8f0',
                boxSizing: 'border-box',
                outline: 'none',
                fontSize: '13px',
                fontWeight: '600',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => { setShowRejectModal(false); setRejectionReason(''); }}
              style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
              disabled={isSaving}
            >
              {t.btnCancel}
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: 1, justifyContent: 'center', background: '#ef4444', borderRadius: '12px', fontWeight: '700', color: 'white', border: 'none', padding: '12px', cursor: 'pointer' }}
              disabled={isSaving}
            >
              {isSaving ? 'Сохранение...' : (t.btnReject || 'Отклонить')}
            </button>
          </div>
        </form>
      </div>
    );
  }



  useEffect(() => {
    if (selectedObject && objectActiveTab === 'psd') {
      fetchPsdDocs(selectedObject.id);
    }
  }, [selectedObject, objectActiveTab]);

  useEffect(() => {
    if (objectActiveTab === 'scheduling' && selectedObject?.estimate?.id) {
      fetchSchedulingData(selectedObject.estimate.id);
    }
  }, [objectActiveTab, selectedObject]);

  useEffect(() => {
    if (objectActiveTab === 'scheduling' && selectedObject?.estimate?.id) {
      fetchSchedulingData(selectedObject.estimate.id);
    }
  }, [objectActiveTab, selectedObject]);

  if (editingProject) {
    const canEdit = userRole === 'admin' || userRole === 'manager';
    const isEditableStatus = userRole === 'admin' || editingProject.status === 'prospect' || editingProject.status === 'approval_rejected';
    const isFormDisabled = !canEdit || !isEditableStatus;

    return (
      <div className="animate-fade-in" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
        {/* Back Button, Title & Language Selector */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button 
              onClick={() => { setEditingProject(null); setActiveTab('dictionaries'); }}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                background: '#f1f5f9', 
                border: 'none', 
                padding: '10px 16px', 
                borderRadius: '12px', 
                fontWeight: '700', 
                color: '#475569', 
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
              className="btn-back"
            >
              <ChevronLeft size={18} /> {t.btnBack}
            </button>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#1e293b' }}>
              {t.detailTitle}: {editingProject.code}
            </h1>
          </div>

          {/* Language Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', padding: '6px 12px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>{lang === 'ru' ? 'ЯЗЫК:' : lang === 'ka' ? 'ენა:' : lang === 'az' ? 'DİL:' : 'LANG:'}</span>
            <select
              style={{ border: 'none', background: 'none', fontWeight: '800', fontSize: '12px', cursor: 'pointer', outline: 'none' }}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              <option value="ru">RU</option>
              <option value="en">EN</option>
              <option value="ka">KA</option>
              <option value="az">AZ</option>
            </select>
          </div>
        </div>

        {/* Edit Form Card */}
        <div className="premium-card" style={{ background: 'white', border: '1px solid #cbd5e1' }}>
          <form onSubmit={handleUpdateProject}>
            
            {/* Warning Banners */}
            {!canEdit && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: '12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', marginBottom: '20px' }}>
                ℹ️ {t.readOnlyViewWarning}
              </div>
            )}
            {canEdit && !isEditableStatus && (
              <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', color: '#c2410c', padding: '12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', marginBottom: '20px' }}>
                ⚠️ {t.editRestrictionWarning}
              </div>
            )}

            {/* Error Message */}
            {editErrorMessage && (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', marginBottom: '20px' }}>
                ⚠️ {editErrorMessage}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Row 1: Code (disabled) & Name */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ width: '150px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldCode}
                  </label>
                  <input
                    type="text"
                    value={editingProject.code}
                    disabled
                    style={{ 
                      width: '100%', 
                      padding: '10px 14px', 
                      borderRadius: '10px', 
                      border: '2px solid #e2e8f0', 
                      boxSizing: 'border-box', 
                      background: '#f1f5f9', 
                      color: '#64748b',
                      fontSize: '13px', 
                      fontWeight: '700' 
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '250px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldName} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); setEditFormErrors({ ...editFormErrors, name: false }); }}
                    placeholder={t.placeholderName}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: editFormErrors.name ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* Row 2: Object Type & Customer */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldType} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={editObjectType}
                    onChange={(e) => { setEditObjectType(e.target.value); setEditFormErrors({ ...editFormErrors, objectType: false }); }}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: editFormErrors.objectType ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderSelect}</option>
                    {dictionaries.object_types.map(o => (
                      <option key={o.id} value={o.code}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldCustomer} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={editCustomer}
                    onChange={(e) => { setEditCustomer(e.target.value); setEditFormErrors({ ...editFormErrors, customer: false }); }}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: editFormErrors.customer ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderSelect}</option>
                    {dictionaries.customers.map(c => (
                      <option key={c.id} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: Country, Region & Manager */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.lblCountry || 'Страна'} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={editCountryId}
                    onChange={(e) => {
                      const cId = e.target.value;
                      setEditCountryId(cId);
                      const availableRegs = (dictionaries.regions || []).filter(r => !cId || r.country_id === cId);
                      if (!availableRegs.some(r => r.id === editRegionId)) {
                        setEditRegionId('');
                      }
                    }}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderSelectCountry || 'Выберите страну...'}</option>
                    {(dictionaries.countries || []).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldRegion} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={editRegionId}
                    onChange={(e) => { setEditRegionId(e.target.value); setEditFormErrors({ ...editFormErrors, regionId: false }); }}
                    disabled={isFormDisabled || (!editCountryId && (dictionaries.countries || []).length > 0)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: editFormErrors.regionId ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{editCountryId ? (t.placeholderSelect || 'Выберите регион...') : 'Сначала выберите страну...'}</option>
                    {(dictionaries.regions || [])
                      .filter(r => !editCountryId || r.country_id === editCountryId)
                      .map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))
                    }
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldManager} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={editManagerId}
                    onChange={(e) => {
                      const mId = e.target.value;
                      setEditManagerId(mId);
                      const mObj = (dictionaries.managers || []).find(m => m.id === mId);
                      setEditManagerSearch(mObj ? `${mObj.first_name} ${mObj.last_name}` : '');
                      setEditFormErrors({ ...editFormErrors, managerSearch: false });
                    }}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: editFormErrors.managerSearch ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderManager || 'Выберите сметчика...'}</option>
                    {(dictionaries.managers || [])
                      .filter(m => {
                        if (!editRegionId) return true;
                        return m.profile_regions?.some(pr => pr.region_id === editRegionId);
                      })
                      .map(m => (
                        <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              {/* Row 4: Dates */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldStartDate} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => { setEditStartDate(e.target.value); setEditFormErrors({ ...editFormErrors, startDate: false }); }}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: editFormErrors.startDate ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldEndDate}
                  </label>
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    disabled={isFormDisabled}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* Address Row */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.lblAddress || 'Адрес'}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder={t.placeholderObjectAddress || "Улица, город..."}
                    value={editProjectAddress}
                    disabled={isFormDisabled}
                    onChange={(e) => setEditProjectAddress(e.target.value)}
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                  <button
                    type="button"
                    onClick={() => setIsProjectEditMapOpen(true)}
                    disabled={isFormDisabled}
                    title="Выбрать на карте"
                    style={{
                      padding: '10px 14px',
                      background: isFormDisabled ? '#f1f5f9' : '#eff6ff',
                      border: `2px solid ${isFormDisabled ? '#cbd5e1' : '#3b82f6'}`,
                      borderRadius: '10px',
                      color: isFormDisabled ? '#94a3b8' : '#3b82f6',
                      cursor: isFormDisabled ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => {
                      if (!isFormDisabled) {
                        e.currentTarget.style.background = '#3b82f6';
                        e.currentTarget.style.color = '#fff';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isFormDisabled) {
                        e.currentTarget.style.background = '#eff6ff';
                        e.currentTarget.style.color = '#3b82f6';
                      }
                    }}
                  >
                    <MapPin size={18} />
                  </button>
                </div>
              </div>

              {/* Coordinates Row */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.lblLatitude || 'Широта (Lat)'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="40.4093"
                    value={editLatitude}
                    disabled={isFormDisabled}
                    onChange={(e) => setEditLatitude(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.lblLongitude || 'Долгота (Lng)'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="49.8671"
                    value={editLongitude}
                    disabled={isFormDisabled}
                    onChange={(e) => setEditLongitude(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* Row 5: Status */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.fieldStatus} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  disabled={isFormDisabled || userRole !== 'admin'}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                >
                  {dictionaries.statuses?.map(s => (
                    <option key={s.id} value={s.code}>{s.name}</option>
                  )) || (
                    <>
                      <option value="prospect">Перспективный</option>
                      <option value="active">Активный</option>
                      <option value="suspended">Приостановлен</option>
                      <option value="completed">Завершен</option>
                      <option value="inactive">Неактивный</option>
                      <option value="under_approval">На утверждении</option>
                      <option value="approved">Утвержден</option>
                    </>
                  )}
                </select>
              </div>

              {/* Row 6: Documents */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.fieldDocs}
                </label>
                {!isFormDisabled && (
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                    <input
                      type="file"
                      multiple
                      id="edit-project-files-upload"
                      style={{ display: 'none' }}
                      onChange={handleEditFileChange}
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById('edit-project-files-upload').click()}
                      style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', background: '#f1f5f9', border: '2px dashed #cbd5e1', padding: '12px', borderRadius: '10px', fontWeight: '800', color: '#334155', cursor: 'pointer', fontSize: '12px' }}
                    >
                      <Upload size={16} /> {t.addDoc}
                    </button>
                  </div>
                )}
                {/* Documents List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {editDocuments.map((doc, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 12px', borderRadius: '8px' }}>
                      <span 
                        onClick={() => handleOpenDocument(doc)}
                        style={{ fontSize: '12px', fontWeight: '700', color: '#2563eb', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'underline' }}
                        title="Скачать документ"
                      >
                        📄 {getCleanFilename(doc)}
                      </span>
                      {!isFormDisabled && (
                        <button
                          type="button"
                          onClick={() => handleRemoveEditDocument(idx)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {editDocuments.length === 0 && (
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                      {t.noDocuments || 'Документы отсутствуют'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Form Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '30px' }}>
              {editingProject.status === 'under_approval' && (userRole === 'director' || userRole === 'admin') ? (
                <>
                  <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                    <button
                      type="button"
                      onClick={() => setShowApproveConfirmModal(true)}
                      style={{ flex: 1, background: '#ecfdf5', border: '1px solid #d1fae5', padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', color: '#047857', fontSize: '13px' }}
                      disabled={isSaving}
                    >
                      {t.btnApprove || 'Утвердить'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRejectModal(true)}
                      style={{ flex: 1, background: '#fef2f2', border: '1px solid #fee2e2', padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', color: '#b91c1c', fontSize: '13px' }}
                      disabled={isSaving}
                    >
                      {t.btnReject || 'Отклонить'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingProject(null)}
                    style={{ width: '100%', background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b', fontSize: '13px' }}
                    disabled={isSaving}
                  >
                    {t.btnBack}
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                  <button
                    type="button"
                    onClick={() => setEditingProject(null)}
                    style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
                    disabled={isSaving}
                  >
                    {isFormDisabled ? t.btnBack : t.btnCancel}
                  </button>
                  {!isFormDisabled && (
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ flex: 1, justifyContent: 'center', background: isSaving ? '#94a3b8' : '#3b82f6', borderRadius: '12px' }}
                      disabled={isSaving}
                    >
                      {isSaving ? 'Сохранение...' : t.btnSave}
                    </button>
                  )}
                </div>
              )}
            </div>
          </form>
        </div>
        {renderApproveModal()}
        {renderRejectModal()}
      </div>
    );
  }



  const renderProjectsTable = (isDictionariesTab) => {
    const displayProjects = isDictionariesTab
      ? projects
      : projects.filter(p => p.status === 'approved' || p.status === 'active' || p.status === 'suspended' || p.status === 'completed');

    const sortedProjects = [...displayProjects].sort((a, b) => {
      if (a.id === highlightedProjectId) return -1;
      if (b.id === highlightedProjectId) return 1;
      return 0;
    });

    return (
      <>
        {/* STATS OVERVIEW */}
        {isDictionariesTab && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '40px' }}>
            <div className="premium-card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '12px', color: '#3b82f6' }}>
                <Briefcase size={24} />
              </div>
              <div>
                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{t.totalProjects}</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#1e293b' }}>{stats.total}</div>
              </div>
            </div>
            <div className="premium-card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ background: '#ecfdf5', padding: '12px', borderRadius: '12px', color: '#10b981' }}>
                <ShieldCheck size={24} />
              </div>
              <div>
                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{t.activeProjects}</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#047857' }}>{stats.active}</div>
              </div>
            </div>
            <div className="premium-card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ background: '#fff7ed', padding: '12px', borderRadius: '12px', color: '#f59e0b' }}>
                <Clock size={24} />
              </div>
              <div>
                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{t.prospectProjects}</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#d97706' }}>{stats.prospect}</div>
              </div>
            </div>
          </div>
        )}

        {/* PROJECTS REGISTRY TABLE */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1e293b', margin: 0 }}>
            {isDictionariesTab ? t.listTitle : (t.displayProjectsListTitle || 'Утвержденные сметы')}
          </h2>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Show Inactive Projects Toggle — рядом с добавлением проекта */}
            {isDictionariesTab && (userRole === 'admin' || userRole === 'manager') && (stats.has_inactive || showInactive) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', color: '#475569' }}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                {t.showInactive}
              </label>
            )}

            {isDictionariesTab && (userRole === 'admin' || userRole === 'manager') && (
              <button className="btn-primary" onClick={handleOpenCreateModal} style={{ padding: '8px 16px', fontSize: '13px' }}>
                <Plus size={16} /> {t.addProject}
              </button>
            )}
          </div>
        </div>

        <div className="premium-card animate-fade-in" style={{ padding: '0', overflowX: 'auto', border: '1px solid #cbd5e1' }}>
          <table className="estimate-table" style={{ minWidth: '1000px' }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr>
                <th style={{ paddingLeft: '24px' }}>{t.colCode}</th>
                <th>{t.colName}</th>
                <th>{t.colType}</th>
                <th>{t.colCustomer}</th>
                <th>{t.colRegion}</th>
                <th>{t.colProjStatus}</th>
                <th>{t.colEstStatus}</th>
                <th>{t.colManager}</th>
                <th>{t.colDates}</th>
                <th style={{ textAlign: 'right', paddingRight: '24px' }}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map(p => (
                <tr 
                  key={p.id} 
                  onClick={() => {
                    if (highlightedProjectId === p.id) {
                      setHighlightedProjectId(null);
                    }
                  }}
                  style={{ 
                    transition: 'background 0.3s ease', 
                    background: !p.is_active ? '#fff5f5' : (p.id === highlightedProjectId ? '#fef9c3' : 'transparent'),
                    boxShadow: !p.is_active ? 'inset 0 0 0 1px #fca5a5' : (p.id === highlightedProjectId ? 'inset 0 0 0 2px #eab308' : 'none'),
                    cursor: p.id === highlightedProjectId ? 'pointer' : 'default'
                  }}
                >
                  <td 
                    onClick={() => handleOpenEdit(p)} 
                    style={{ 
                      paddingLeft: '24px', 
                      fontWeight: '800', 
                      color: '#2563eb', 
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                    title={t.detailTitle || 'Редактировать'}
                  >
                    {p.code}
                  </td>
                  <td>
                    <div style={{ fontWeight: '700', color: '#1e293b' }}>{p.name}</div>
                  </td>
                  <td style={{ fontWeight: '500', color: '#475569' }}>{p.object_type_name}</td>
                  <td style={{ fontWeight: '500', color: '#475569' }}>{p.customer_name}</td>
                  <td style={{ fontWeight: '600', color: '#0f172a' }}>{p.region_name}</td>
                  <td>
                    <span className="badge" style={getStatusBadgeStyle(p.status)}>
                      {p.status_name}
                    </span>
                  </td>
                  <td>
                    {p.estimate_status === 'not_started' ? (
                      <span className="badge" style={getEstimateStatusBadgeStyle(p.estimate_status)}>
                        {p.estimate_status_name}
                      </span>
                    ) : (
                      <span 
                        onClick={() => handleOpenEstimate(p)}
                        className="badge" 
                        style={{ ...getEstimateStatusBadgeStyle(p.estimate_status), cursor: 'pointer', textDecoration: 'underline' }}
                        title="Открыть редактор сметы"
                      >
                        {p.estimate_status_name}
                      </span>
                    )}
                  </td>
                  <td style={{ fontWeight: '600', color: '#334155' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <User size={14} color="#64748b" /> {p.manager_name}
                    </div>
                  </td>
                  <td style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span>{t.start}: {new Date(p.start_date).toLocaleDateString()}</span>
                      {p.end_date && <span>{t.end}: {new Date(p.end_date).toLocaleDateString()}</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '24px' }}>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center' }}>
                      {isDictionariesTab && p.is_active && p.status === 'under_approval' && (userRole === 'director' || userRole === 'admin') && (
                        <span style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', fontWeight: '600', maxWidth: '240px', display: 'inline-block', textAlign: 'right' }}>
                          {t.reviewDetailsToApprove}
                        </span>
                      )}
                      {!isDictionariesTab && p.is_active && (p.status === 'approved' || p.status === 'active' || p.status === 'completed' || p.status === 'suspended') && (
                        p.estimate_status !== 'not_started' && (
                          (userRole === 'estimator' || userRole === 'admin' || userRole === 'manager' || userRole === 'director') && (
                            <button
                              onClick={() => handleOpenEstimate(p)}
                              className="btn-primary"
                              style={{ padding: '6px 12px', fontSize: '12px', background: '#10b981', color: 'white', boxShadow: 'none' }}
                            >
                              {t.openEstimate || 'Открыть WBS'}
                            </button>
                          )
                        )
                      )}
                      
                      {isDictionariesTab && (
                        <>
                          {!p.is_active ? (
                            (userRole === 'admin' || userRole === 'manager') && (
                              <button
                                onClick={() => handleActivateProject(p.id)}
                                className="btn-primary"
                                style={{ padding: '6px 12px', fontSize: '12px', background: '#6366f1', boxShadow: 'none' }}
                              >
                                {t.btnActivate}
                              </button>
                            )
                          ) : (
                            (p.status === 'prospect' || p.status === 'approval_rejected') && (userRole === 'admin' || userRole === 'manager') && (
                              <button
                                onClick={() => handleOpenApprovalModal(p.id)}
                                className="btn-primary"
                                style={{ padding: '6px 12px', fontSize: '12px', background: '#eab308', color: 'white', boxShadow: 'none' }}
                              >
                                {t.btnSendForApproval}
                              </button>
                            )
                          )}
                          {(userRole === 'admin' || (userRole === 'manager' && p.is_active && (p.status === 'prospect' || p.status === 'approval_rejected'))) && (
                            <button
                              onClick={() => handleDeleteProject(p.id)}
                              style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px' }}
                              title={t.deleteProject}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {displayProjects.length === 0 && !loading && (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
                    <Layers size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                    <div>{t.noProjects}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const geocodeAddress = async (address) => {
    if (!address || !address.trim()) return null;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        return {
          latitude: parseFloat(data[0].lat),
          longitude: parseFloat(data[0].lon)
        };
      }
    } catch (err) {
      console.warn("Geocoding failed:", err.message);
    }
    return null;
  };

  const fetchPsdDocs = async (objectId) => {
    setLoadingPsdDocs(true);
    try {
      const res = await api.get(`/estimates/projects/${selectedProjectId}/objects/${objectId}/documents`);
      setPsdDocs(res.data || []);
    } catch (err) {
      console.error("Error loading PSD documents:", err);
    } finally {
      setLoadingPsdDocs(false);
    }
  };



  const handleDeletePsd = async (docId) => {
    if (!window.confirm(t.confirmDeleteDoc || "Вы уверены, что хотите удалить документ?")) return;
    try {
      await api.delete(`/estimates/projects/${selectedProjectId}/objects/${selectedObject.id}/documents/${docId}`);
      alert("Документ успешно удален!");
      fetchPsdDocs(selectedObject.id);
    } catch (err) {
      alert("Ошибка удаления: " + err.message);
    }
  };

  const handleOpenAddPsd = () => {
    setPsdEditingDoc(null);
    setPsdFormName('');
    setPsdFormTypeId(dictionaries.document_types?.[0]?.id || 'drawing');
    setPsdFormVersion('1.0');
    setPsdFormNotes('');
    setPsdFormUrl('');
    setPsdFormFile(null);
    setPsdFormFileName('');
    setPsdFormErrors({});
    setPsdErrorMessage('');
    setShowPsdModal(true);
  };

  const handleOpenEditPsd = (doc) => {
    setPsdEditingDoc(doc);
    setPsdFormName(doc.name);
    setPsdFormTypeId(doc.type_code || doc.type_id);
    setPsdFormVersion(doc.version || '1.0');
    setPsdFormNotes(doc.notes || '');
    setPsdFormUrl(doc.doc_url || '');
    setPsdFormFile(null);
    setPsdFormFileName(doc.file_path || '');
    setPsdFormErrors({});
    setPsdErrorMessage('');
    setShowPsdModal(true);
  };

  const handleSavePsd = async (e) => {
    e.preventDefault();
    setPsdErrorMessage('');
    const errors = {};
    if (!psdFormName.trim()) errors.name = true;
    if (!psdFormTypeId) errors.type = true;
    if (!psdFormFile && !psdFormUrl.trim() && !psdFormFileName) {
      errors.source = true;
    }

    if (psdFormUrl.trim()) {
      try {
        new URL(psdFormUrl.trim());
      } catch (err) {
        errors.url = true;
      }
    }

    if (Object.keys(errors).length > 0) {
      setPsdFormErrors(errors);
      if (errors.name) setPsdErrorMessage(t.errRequiredField || "Обязательное поле");
      else if (errors.type) setPsdErrorMessage(t.errRequiredField || "Обязательное поле");
      else if (errors.source) setPsdErrorMessage(t.errSourceRequired || "Загрузите файл или укажите ссылку на документ");
      else if (errors.url) setPsdErrorMessage(t.errInvalidUrl || "Укажите корректную ссылку");
      return;
    }

    setIsSaving(true);
    try {
      let finalFilePath = psdFormFileName;

      if (psdFormFile) {
        if (psdFormFile.size > 100 * 1024 * 1024) {
          alert("Размер файла превышает допустимый лимит 100 МБ");
          setIsSaving(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', psdFormFile);
        const uploadRes = await api.post('/estimates/projects/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        finalFilePath = uploadRes.data.filename;
      }

      const payload = {
        name: psdFormName.trim(),
        type_id: psdFormTypeId,
        version: psdFormVersion || '1.0',
        file_path: finalFilePath || null,
        doc_url: psdFormUrl.trim() || null,
        notes: psdFormNotes.trim() || null
      };

      if (psdEditingDoc) {
        await api.put(`/estimates/projects/${selectedProjectId}/objects/${selectedObject.id}/documents/${psdEditingDoc.id}`, payload);
        alert("Документ успешно обновлен!");
      } else {
        await api.post(`/estimates/projects/${selectedProjectId}/objects/${selectedObject.id}/documents`, payload);
        alert("Документ успешно добавлен!");
      }

      setShowPsdModal(false);
      fetchPsdDocs(selectedObject.id);
    } catch (err) {
      alert("Ошибка при сохранении: " + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const fetchSchedulingData = async (docId) => {
    setLoadingScheduling(true);
    try {
      const res = await api.get(`/estimates/${docId}`);
      setSchedulingData(res.data);
    } catch (err) {
      console.error("Error loading scheduling WBS tree:", err);
    } finally {
      setLoadingScheduling(false);
    }
  };



  const handleSaveInfo = async (e) => {
    if (e) e.preventDefault();
    if (!selectedObject) return;
    if (!editObjectName.trim()) {
      alert(t.errObjectNameRequired || "Название объекта является обязательным полем");
      return;
    }
    setIsSaving(true);
    try {
      let lat = editObjectLatitude;
      let lng = editObjectLongitude;

      const res = await api.put(`/estimates/projects/${selectedProjectId}/objects/${selectedObject.id}`, {
        name: editObjectName.trim(),
        description: editObjectDescription || null,
        responsible_id: editObjectResponsibleId || null,
        custom_responsible_name: editObjectResponsibleSearch && !editObjectResponsibleId ? editObjectResponsibleSearch.trim() : null,
        address: editObjectAddress || null,
        latitude: lat ? parseFloat(lat) : null,
        longitude: lng ? parseFloat(lng) : null,
        documents: selectedObject.documents || []
      });
      setIsEditingInfo(false);
      fetchProjectObjects(selectedProjectId);
      setSelectedObject(res.data);
      alert(t.objectInfoUpdatedSuccess || "Информация об объекте успешно обновлена!");
    } catch (err) {
      alert("Ошибка при сохранении: " + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const renderObjectInfoTab = (currentObj, isEditable) => {
    if (isEditingInfo) {
      return (
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!editObjectName.trim()) {
            alert("Название объекта является обязательным полем");
            return;
          }
          setIsSaving(true);
          try {
            let lat = editObjectLatitude;
            let lng = editObjectLongitude;

            const res = await api.put(`/estimates/projects/${selectedProjectId}/objects/${currentObj.id}`, {
              name: editObjectName.trim(),
              description: editObjectDescription || null,
              responsible_id: editObjectResponsibleId || null,
              custom_responsible_name: editObjectResponsibleSearch && !editObjectResponsibleId ? editObjectResponsibleSearch.trim() : null,
              address: editObjectAddress || null,
              latitude: lat ? parseFloat(lat) : null,
              longitude: lng ? parseFloat(lng) : null,
              documents: currentObj.documents || []
            });
            setIsEditingInfo(false);
            fetchProjectObjects(selectedProjectId);
            setSelectedObject(res.data);
            alert("Информация об объекте успешно обновлена!");
          } catch (err) {
            alert("Ошибка при сохранении: " + (err.response?.data?.error || err.message));
          } finally {
            setIsSaving(false);
          }
        }} style={{ display: 'flex', flexDirection: 'column', gap: '15px', background: 'white', padding: '20px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              Название объекта <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={editObjectName}
              onChange={(e) => setEditObjectName(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>Описание объекта</label>
            <textarea
              rows={3}
              value={editObjectDescription}
              onChange={(e) => setEditObjectDescription(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>Ответственный</label>
            <input
              type="text"
              value={editObjectResponsibleSearch}
              onChange={(e) => {
                setEditObjectResponsibleSearch(e.target.value);
                setShowEditObjectResponsibleDropdown(true);
                const match = dictionaries.managers.find(m => `${m.first_name} ${m.last_name}` === e.target.value);
                setEditObjectResponsibleId(match ? match.id : '');
              }}
              onFocus={() => setShowEditObjectResponsibleDropdown(true)}
              onBlur={() => setTimeout(() => setShowEditObjectResponsibleDropdown(false), 250)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
            />
            {showEditObjectResponsibleDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: '160px', overflowY: 'auto', marginTop: '4px' }}>
                {dictionaries.managers
                  .filter(m => `${m.first_name} ${m.last_name}`.toLowerCase().includes(editObjectResponsibleSearch.toLowerCase()))
                  .map(m => (
                    <div
                      key={m.id}
                      onMouseDown={() => {
                        setEditObjectResponsibleId(m.id);
                        setEditObjectResponsibleSearch(`${m.first_name} ${m.last_name}`);
                        setShowEditObjectResponsibleDropdown(false);
                      }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                      className="manager-option"
                    >
                      {m.first_name} {m.last_name}
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>Адрес</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={editObjectAddress}
                onChange={(e) => setEditObjectAddress(e.target.value)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
              />
              <button
                type="button"
                onClick={() => setIsObjectEditMapOpen(true)}
                title="Выбрать на карте"
                style={{
                  padding: '10px 14px',
                  background: '#eff6ff',
                  border: '2px solid #3b82f6',
                  borderRadius: '10px',
                  color: '#3b82f6',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#3b82f6'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#3b82f6'; }}
              >
                <MapPin size={18} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>Широта (Lat)</label>
              <input
                type="number"
                step="any"
                value={editObjectLatitude}
                onChange={(e) => setEditObjectLatitude(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>Долгота (Lng)</label>
              <input
                type="number"
                step="any"
                value={editObjectLongitude}
                onChange={(e) => setEditObjectLongitude(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '15px' }}>
            <button
              type="button"
              onClick={() => setIsEditingInfo(false)}
              style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
              disabled={isSaving}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: 1, padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}
              disabled={isSaving}
            >
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      );
    }

    return (
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'white', padding: '28px', borderRadius: '20px', border: '1px solid #cbd5e1', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)' }}>
        
        {/* Edit Button in Top Right */}
        {isEditable && (
          <button
            onClick={() => {
              setEditObjectName(currentObj.name);
              setEditObjectDescription(currentObj.description || '');
              setEditObjectResponsibleId(currentObj.responsible_id || '');
              setEditObjectResponsibleSearch(currentObj.responsible_name || '');
              setEditObjectAddress(currentObj.address || '');
              setEditObjectLatitude(currentObj.latitude || '');
              setEditObjectLongitude(currentObj.longitude || '');
              setIsEditingInfo(true);
            }}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: '#f1f5f9',
              border: 'none',
              color: '#475569',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
            }}
            title="Редактировать объект"
          >
            <Edit2 size={16} />
          </button>
        )}

        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Название объекта</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#1e293b', marginTop: '6px' }}>{currentObj.name}</div>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Описание</div>
          <div style={{ fontSize: '13px', fontWeight: '500', color: '#475569', marginTop: '6px', lineHeight: '1.5' }}>{currentObj.description || 'Описание отсутствует'}</div>
        </div>

        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ответственный</div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>👤 {currentObj.responsible_name || 'Не назначен'}</div>
        </div>

        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Адрес</div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>📍 {currentObj.address || 'Не указан'}</div>
        </div>

        {currentObj.latitude && currentObj.longitude && (
          <div style={{ gridColumn: 'span 2', display: 'flex', gap: '40px', background: '#f8fafc', padding: '16px 20px', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Широта (Lat)</div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#475569', marginTop: '4px' }}>{currentObj.latitude}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Долгота (Lng)</div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#475569', marginTop: '4px' }}>{currentObj.longitude}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const getDocTypeName = (doc) => {
    if (!doc) return '—';
    // Try to find type in dictionaries using type_id (UUID) or type_code (string)
    if (dictionaries.document_types && dictionaries.document_types.length > 0) {
      const found = dictionaries.document_types.find(dt =>
        dt.id === doc.type_id || dt.code === doc.type_code
      );
      if (found) {
        return found[`name_${lang}`] || found.name || found.name_ru || found.code || '?';
      }
    }
    // Comprehensive multilingual fallback by type_code
    const codeKey = doc.type_code;
    const fallbackTranslations = {
      working_doc:    { ru: 'Рабочая документация',    en: 'Working Documentation',        ka: 'სამუშაო დოკუმენტაცია',        az: 'İş sənədləri' },
      estimate_doc:   { ru: 'Сметная документация',    en: 'Estimate Documentation',        ka: 'საპროექტო-სახარჯთაღრიცხვა',   az: 'Smeta sənədləri' },
      project_doc:    { ru: 'Проектная документация',    en: 'Project Documentation',        ka: 'საპროექტო დოკუმენტაცია',       az: 'Layihə sənədləri' },
      contract:       { ru: 'Договор',                      en: 'Contract',                      ka: 'ხელშეკრულება',                   az: 'Müqavilə' },
      executive_doc:  { ru: 'Исполнительная документация', en: 'As-built Documentation', ka: 'სააღსრულებლო დოკუმენტაცია', az: 'İcra sənədləri' },
      notes_doc:      { ru: 'Прочее',                      en: 'Other',                         ka: 'სხვა',                           az: 'Digər' },
      drawing:        { ru: 'Чертеж',                      en: 'Drawing',                       ka: 'ნახაზი',                          az: 'Cizgi' },
      act:            { ru: 'Акт',                         en: 'Act',                           ka: 'აქტი',                            az: 'Akt' },
      permit:         { ru: 'Разрешение',                  en: 'Permit',                        ka: 'ნებართვი',                         az: 'İcazə' },
      specification:  { ru: 'Спецификация',              en: 'Specification',                 ka: 'სპეციფიკაცია',               az: 'Spesifikasiya' }
    };
    if (codeKey && fallbackTranslations[codeKey]) {
      return fallbackTranslations[codeKey][lang] || fallbackTranslations[codeKey].ru;
    }
    return codeKey || t.docTypeOther || 'Не указан';
  };

  const getDocTypesList = () => {
    if (dictionaries.document_types && dictionaries.document_types.length > 0) {
      return dictionaries.document_types;
    }
    return [
      { id: 'drawing', name: t.docTypeDrawing || 'Чертеж' },
      { id: 'estimate', name: t.docTypeEstimate || 'Смета' },
      { id: 'act', name: t.docTypeAct || 'Акт' },
      { id: 'permit', name: t.docTypePermit || 'Разрешение' },
      { id: 'contract', name: t.docTypeContract || 'Договор' },
      { id: 'specification', name: t.docTypeSpec || 'Спецификация' },
      { id: 'other', name: t.docTypeOther || 'Другое' }
    ];
  };

  const renderObjectPsdTab = (currentObj) => {
    const isPsdEditable = (userRole === 'admin' || userRole === 'estimator') && currentObj.id !== 'legacy' && (!currentObj.estimate || currentObj.estimate.status === 'draft');

    return (
      <div style={{ background: 'white', padding: '28px', borderRadius: '20px', border: '1px solid #cbd5e1', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#1e293b' }}>
            {t.psdFullTitle || 'Проектно-сметная документация'} ({psdDocs.length})
          </h4>
          {isPsdEditable && (
            <button
              onClick={handleOpenAddPsd}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '13px' }}
            >
              <Plus size={16} /> Добавить документ
            </button>
          )}
        </div>

        <div className="table-container" style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColName || 'Название'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColType || 'Тип'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569', textAlign: 'center' }}>{t.psdColVersion || 'Версия'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColSource || 'Источник'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColCreatedBy || 'Добавил'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColDate || 'Дата'}</th>
                <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569' }}>{t.psdColNotes || 'Примечания'}</th>
                {isPsdEditable && <th style={{ padding: '12px 16px', fontWeight: '800', color: '#475569', textAlign: 'center' }}>{t.psdColActions || 'Действия'}</th>}
              </tr>
            </thead>
            <tbody>
              {psdDocs.map((doc) => {
                const typeName = getDocTypeName(doc);
                const creator = doc.created_by_profile ? `${doc.created_by_profile.first_name} ${doc.created_by_profile.last_name}` : 'Сметчик';
                const formattedDate = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
                const fileUrl = doc.file_path ? `http://${window.location.hostname}:8004/api/estimates/uploads/${doc.file_path}` : null;

                return (
                  <tr key={doc.id} style={{ borderBottom: '1px solid #f1f5f9', hover: { background: '#f8fafc' } }} className="psd-row">
                    <td style={{ padding: '14px 16px', fontWeight: '700', color: '#1e293b' }}>{doc.name}</td>
                    <td style={{ padding: '14px 16px', fontWeight: '600', color: '#475569' }}>
                      <span style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', color: '#475569', fontWeight: '700' }}>
                        {typeName}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '800', color: '#64748b' }}>
                      {doc.version || '1.0'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {fileUrl ? (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={getCleanFilename(doc.file_path)}
                          style={{ textDecoration: 'none', color: '#2563eb', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          📄 {t.docSourceDefault || 'Документ'}
                        </a>
                      ) : doc.doc_url ? (
                        <a
                          href={doc.doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none', color: '#10b981', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          🔗 {t.docSourceDefault || 'Документ'}
                        </a>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Нет источника</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: '600', color: '#475569' }}>{creator}</td>
                    <td style={{ padding: '14px 16px', color: '#64748b', fontSize: '12px', fontWeight: '500' }}>{formattedDate}</td>
                    <td style={{ padding: '14px 16px', color: '#64748b', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.notes}>
                      {doc.notes || '-'}
                    </td>
                    {isPsdEditable && (
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            onClick={() => handleOpenEditPsd(doc)}
                            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: '4px' }}
                            title="Редактировать"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeletePsd(doc.id)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                            title="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}

              {psdDocs.length === 0 && (
                <tr>
                  <td colSpan={isPsdEditable ? 8 : 7} style={{ textAlign: 'center', padding: '60px', color: '#94a3b8', fontWeight: '600' }}>
                    <Layers size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
                    <div>{t.noPsdDocs || 'Нет загруженных документов ПСД.'}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderObjectEstimateTab = (currentObj) => {
    if (currentObj.estimate) {
      return (
        <div style={{ background: '#f8fafc', padding: '0px', borderRadius: '16px', border: 'none' }}>
          <EstimateEditor
            docId={currentObj.estimate.id}
            userRole={userRole}
            resourceLanguage={lang}
            setResourceLanguage={setLang}
            onBack={() => {
              setIsEditingInfo(false); setEditingProject(null); setIsEditingInfo(false); setSelectedObject(null);
            }}
          />
        </div>
      );
    }

    return (
      <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
        <Layers size={48} style={{ opacity: 0.3, marginBottom: '16px', color: '#64748b' }} />
        <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '800', color: '#334155' }}>
          Смета для объекта не создана
        </h4>
        <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: '#64748b', maxWidth: '380px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.5' }}>
          Смета инициализирует иерархическую структуру WBS объекта. Сметчик сможет добавлять конструктивы, подконструктивы и работы.
        </p>
        {(userRole === 'admin' || userRole === 'estimator') && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (!window.confirm("Создать новую смету для этого объекта?")) return;
              try {
                const res = await api.post(`/estimates/projects/${selectedProjectId}/create-estimate`, {
                  objectId: currentObj.id,
                  organization_id: '741be209-ad6f-4483-92ee-298a36899bcf'
                });

                // Автоматически сохраняем валюту проекта в только что созданную смету
                const currencyId = getProjectCurrencyId(selectedProjectId);
                if (currencyId && res.data?.id) {
                  try {
                    await api.post(`/estimates/${res.data.id}/save`, {
                      currency_id: currencyId,
                      wbs: [],
                      works: [],
                      resources: [],
                      coefficients: []
                    });
                  } catch (saveErr) {
                    console.error("Ошибка при сохранении валюты в новую смету:", saveErr);
                  }
                }

                alert("Смета успешно создана!");
                // Reload objects list
                const resObj = await api.get(`/estimates/projects/${selectedProjectId}/objects`);
                setProjectObjects(resObj.data || []);
                const updatedObj = (resObj.data || []).find(o => o.id === currentObj.id);
                if (updatedObj) {
                  setSelectedObject(updatedObj);
                }
              } catch (err) {
                alert("Ошибка создания сметы: " + err.message);
              }
            }}
            className="btn-primary"
            style={{ padding: '10px 20px', fontSize: '13px' }}
          >
            Создать смету
          </button>
        )}
      </div>
    );
  };

  const renderObjectSchedulingTab = (currentObj) => {
    if (!currentObj.estimate) {
      return (
        <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: '16px', border: '1px solid #cbd5e1', color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
          Смета не создана. Календарное планирование недоступно.
        </div>
      );
    }

    if (loadingScheduling) {
      return (
        <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '16px', border: '1px solid #cbd5e1', color: '#64748b', fontWeight: '600' }}>
          Загрузка структуры календарного планирования WBS...
        </div>
      );
    }

    if (!schedulingData || !schedulingData.wbs || schedulingData.wbs.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '16px', border: '1px solid #cbd5e1', color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
          Нет разделов в смете. Добавьте разделы и работы во вкладке «Смета».
        </div>
      );
    }

    const wbsList = schedulingData.wbs;
    const worksList = schedulingData.works || [];

    const getChildrenWbs = (parentId) => wbsList.filter(node => node.parent_id === parentId);
    const getWorksForWbs = (wbsId) => worksList.filter(work => work.wbs_id === wbsId);

    const renderNode = (node, depth = 0) => {
      const childrenWbs = getChildrenWbs(node.id);
      const works = getWorksForWbs(node.id);

      return (
        <div key={node.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Section row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            background: depth === 0 ? '#f1f5f9' : '#f8fafc',
            borderLeft: depth === 0 ? '4px solid #3b82f6' : '3px solid #cbd5e1',
            borderRadius: '10px',
            marginLeft: `${depth * 24}px`,
            fontWeight: '700',
            fontSize: depth === 0 ? '14px' : '13px',
            color: '#334155'
          }}>
            <span>{depth === 0 ? '📁' : '📂'}</span>
            <span>{node.name}</span>
          </div>

          {/* Render children sub-sections */}
          {childrenWbs.map(child => renderNode(child, depth + 1))}

          {/* Render works inside this section */}
          {works.map(work => (
            <div key={work.id} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              marginLeft: `${(depth + 1) * 24}px`,
              fontSize: '13px',
              color: '#475569',
              fontWeight: '500'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981' }}>🛠️</span>
                <span>{work.name || work.jobs?.name}</span>
                <span style={{ fontSize: '10px', color: '#94a3b8', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                  {work.jobs?.code}
                </span>
              </div>
              <div style={{ fontWeight: '700', color: '#1e293b' }}>
                {work.volume} {work.measure_name || work.jobs?.dic_measures?.code}
              </div>
            </div>
          ))}
        </div>
      );
    };

    const rootNodes = wbsList.filter(node => !node.parent_id);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'white', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
        {rootNodes.map(node => renderNode(node, 0))}
      </div>
    );
  };

  const renderObjectDetailsView = () => {
    if (!selectedObject) return null;

    const currentObj = projectObjects.find(o => o.id === selectedObject.id) || selectedObject;

    const isEstimatesTab = objectActiveTab === 'estimate';
    const isPsdTab = objectActiveTab === 'psd';
    const isInfoTab = objectActiveTab === 'info';
    const isSchedulingTab = objectActiveTab === 'scheduling';

    const estimateStatus = currentObj.estimate ? currentObj.estimate.status : 'not_started';
    const isEditable = (userRole === 'admin' || userRole === 'estimator') && currentObj.id !== 'legacy' && (estimateStatus === 'not_started' || estimateStatus === 'draft');

    return (
      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
        {/* Header Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setSelectedObject(null)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px', background: '#f1f5f9', border: 'none', borderRadius: '10px', cursor: 'pointer', color: '#475569', fontWeight: '700' }}
            >
              ← Назад
            </button>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
              Объект: {currentObj.name}
            </h3>
          </div>
        </div>

        {/* Tab Switcher (macOS/iOS Segmented Pill Style) */}
        <div style={{ 
          display: 'flex', 
          background: '#f1f5f9', 
          padding: '4px', 
          borderRadius: '14px', 
          gap: '2px',
          alignSelf: 'flex-start',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
        }}>
          {[
            { id: 'info', label: t.tabInfo || 'Информация' },
            { id: 'psd', label: t.tabPsd || 'ПСД' },
            { id: 'estimate', label: 'Структура WBS' },
            { id: 'scheduling', label: t.tabScheduling || 'Календарное планирование' }
          ].map(tab => {
            const isActive = objectActiveTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setObjectActiveTab(tab.id)}
                style={{
                  padding: '8px 16px',
                  background: isActive ? '#ffffff' : 'transparent',
                  border: 'none',
                  borderRadius: '10px',
                  color: isActive ? '#2563eb' : '#64748b',
                  fontWeight: '700',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: isActive ? '0 4px 10px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.02)' : 'none'
                }}
                className="segment-tab"
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, minHeight: '400px' }}>
          {isInfoTab && renderObjectInfoTab(currentObj, isEditable)}
          {isPsdTab && renderObjectPsdTab(currentObj)}
          {isEstimatesTab && renderObjectEstimateTab(currentObj)}
          {isSchedulingTab && renderObjectSchedulingTab(currentObj)}
        </div>

        {/* Add/Edit PSD Document Modal */}
      {showPsdModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContext: 'center',
          justifyContent: 'center', zIndex: 1000, padding: '20px'
        }}>
          <div className="animate-scale-in" style={{
            background: 'white', padding: '32px', borderRadius: '24px',
            width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '20px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #cbd5e1'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
                {psdEditingDoc ? (t.psdModalEditTitle || 'Редактировать документ ПСД') : (t.psdModalAddTitle || 'Добавить документ ПСД')}
              </h3>
              <button
                onClick={() => setShowPsdModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSavePsd} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {psdErrorMessage && (
                <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700' }}>
                  ⚠️ {psdErrorMessage}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.psdLabelName || 'Название документа'} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={psdFormName}
                  onChange={(e) => setPsdFormName(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.name ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                  placeholder={t.psdPlaceholderName || "Введите название..."}
                />
              </div>

              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.psdLabelType || 'Тип документа'} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={psdFormTypeId}
                    onChange={(e) => setPsdFormTypeId(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.type ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', background: 'white' }}
                  >
                    <option value="">{t.psdPlaceholderSelectType || 'Выберите тип...'}</option>
                    {getDocTypesList().map(dt => (
                      <option key={dt.id} value={dt.id}>{dt.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.psdLabelVersion || 'Версия'}
                  </label>
                  <input
                    type="text"
                    value={psdFormVersion}
                    onChange={(e) => setPsdFormVersion(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.psdLabelSource || 'Источник документа'} <span style={{ color: '#ef4444' }}>*</span> {t.psdLabelSourceHint || '(загрузите файл ИЛИ укажите ссылку)'}
                </label>
                
                {/* File Upload Trigger */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                  <input
                    type="file"
                    id="psd-modal-upload-input"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0];
                        setPsdFormFile(file);
                        setPsdFormFileName(file.name);
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => document.getElementById('psd-modal-upload-input').click()}
                      style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '8px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Upload size={14} /> {t.psdBtnChooseFile || 'Выбрать файл'}
                    </button>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {psdFormFileName ? `📁 ${getCleanFilename(psdFormFileName)}` : (t.psdNoFileSelected || 'Файл не выбран')}
                    </span>
                    {psdFormFileName && (
                      <button
                        type="button"
                        onClick={() => { setPsdFormFile(null); setPsdFormFileName(''); }}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* URL Input */}
                <input
                  type="text"
                  value={psdFormUrl}
                  onChange={(e) => setPsdFormUrl(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.url ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                  placeholder={t.psdPlaceholderUrl || "Или укажите ссылку на документ (https://...)"}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.psdLabelNotes || 'Примечания'}
                </label>
                <textarea
                  rows={2}
                  value={psdFormNotes}
                  onChange={(e) => setPsdFormNotes(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  placeholder={t.psdPlaceholderNotes || "Дополнительные примечания..."}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowPsdModal(false)}
                  style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
                  disabled={isSaving}
                >
                  {t.btnCancel || 'Отмена'}
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1, padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        {/* Add/Edit PSD Document Modal */}
      {showPsdModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContext: 'center',
          justifyContent: 'center', zIndex: 1000, padding: '20px'
        }}>
          <div className="animate-scale-in" style={{
            background: 'white', padding: '32px', borderRadius: '24px',
            width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '20px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #cbd5e1'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
                {psdEditingDoc ? (t.psdModalEditTitle || 'Редактировать документ ПСД') : (t.psdModalAddTitle || 'Добавить документ ПСД')}
              </h3>
              <button
                onClick={() => setShowPsdModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSavePsd} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {psdErrorMessage && (
                <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700' }}>
                  ⚠️ {psdErrorMessage}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.psdLabelName || 'Название документа'} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={psdFormName}
                  onChange={(e) => setPsdFormName(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.name ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                  placeholder="Введите название..."
                />
              </div>

              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.psdLabelType || 'Тип документа'} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={psdFormTypeId}
                    onChange={(e) => setPsdFormTypeId(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.type ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', background: 'white' }}
                  >
                    <option value="">Выберите тип...</option>
                    {getDocTypesList().map(dt => (
                      <option key={dt.id} value={dt.id}>{dt.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    Версия
                  </label>
                  <input
                    type="text"
                    value={psdFormVersion}
                    onChange={(e) => setPsdFormVersion(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.psdLabelSource || 'Источник документа'} <span style={{ color: '#ef4444' }}>*</span> {t.psdLabelSourceHint || '(загрузите файл ИЛИ укажите ссылку)'}
                </label>
                
                {/* File Upload Trigger */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                  <input
                    type="file"
                    id="psd-modal-upload-input"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0];
                        setPsdFormFile(file);
                        setPsdFormFileName(file.name);
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => document.getElementById('psd-modal-upload-input').click()}
                      style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '8px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Upload size={14} /> Выбрать файл
                    </button>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {psdFormFileName ? `📁 ${getCleanFilename(psdFormFileName)}` : 'Файл не выбран'}
                    </span>
                    {psdFormFileName && (
                      <button
                        type="button"
                        onClick={() => { setPsdFormFile(null); setPsdFormFileName(''); }}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* URL Input */}
                <input
                  type="text"
                  value={psdFormUrl}
                  onChange={(e) => setPsdFormUrl(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.url ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
                  placeholder="Или укажите ссылку на документ (https://...)"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  Примечания
                </label>
                <textarea
                  rows={2}
                  value={psdFormNotes}
                  onChange={(e) => setPsdFormNotes(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  placeholder="Дополнительные примечания..."
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowPsdModal(false)}
                  style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
                  disabled={isSaving}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1, padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    );
  };









  const renderEstimatesDashboard = () => {
    const displayProjectsList = projects.filter(p => p.status === 'approved' || p.status === 'active' || p.status === 'suspended' || p.status === 'completed');

    const selectedProject = displayProjectsList.find(p => p.id === selectedProjectId) || null;

    // Filter projects based on search query
    const filteredRegistry = displayProjectsList.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.code.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Sort selected project to the top of the list
    const sortedRegistry = [...filteredRegistry];
    if (selectedProjectId) {
      const idx = sortedRegistry.findIndex(p => p.id === selectedProjectId);
      if (idx !== -1) {
        const [selectedProj] = sortedRegistry.splice(idx, 1);
        sortedRegistry.unshift(selectedProj);
      }
    }

    return (
      <div className="animate-fade-in" style={{ display: 'flex', gap: '24px', minHeight: '600px', width: '100%', alignItems: 'stretch' }}>
        {/* LEFT PANEL: РЕЕСТР ПРОЕКТОВ */}
        <div className="premium-card" style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '20px', gap: '16px', border: '1px solid #cbd5e1', borderRadius: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#1e293b' }}>
              {t.registryTitle} ({displayProjectsList.length})
            </h3>
          </div>

          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '2px solid #e2e8f0',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              fontWeight: '600'
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1, maxHeight: '550px' }}>
            {sortedRegistry.map(p => {
              const isSelected = p.id === selectedProjectId;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  style={{
                    padding: '14px 18px',
                    borderRadius: '14px',
                    border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    background: isSelected ? '#eff6ff' : 'white',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: isSelected ? '0 4px 12px rgba(59, 130, 246, 0.1)' : 'none'
                  }}
                  className="project-item"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '800', color: isSelected ? '#3b82f6' : '#64748b' }}>
                      {p.code}
                    </span>
                    <span className="badge" style={{ ...getStatusBadgeStyle(p.status), fontSize: '10px', padding: '2px 8px' }}>
                      {p.status_name}
                    </span>
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '4px', lineHeight: '1.3' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>
                    {p.customer_name}
                  </div>
                </div>
              );
            })}
            {sortedRegistry.length === 0 && (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 10px', fontSize: '13px' }}>
                Проекты не найдены
              </div>
            )}
          </div>
        </div>

        {/* CENTER & RIGHT CONTENT */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {selectedProject ? (
            <>
              {/* TOP ROW: MAP + DETAILS */}
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {/* MAP CARD (flex: 1, height: 200px) */}
                <div className="premium-card" style={{ flex: 1, minWidth: '320px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid #cbd5e1', borderRadius: '20px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t.mapTitle}
                  </h4>
                  <div 
                    ref={mapRef} 
                    style={{ 
                      height: '200px', 
                      width: '100%', 
                      borderRadius: '12px', 
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {projectObjects.filter(obj => obj.latitude && obj.longitude).length === 0 && !(selectedProject && selectedProject.latitude && selectedProject.longitude) && (
                      <div style={{ 
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center', 
                        color: '#94a3b8', 
                        padding: '20px', 
                        zIndex: 10 
                      }}>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginBottom: '6px', color: '#64748b' }}>📍 {t.coordinatesNotSpecified}</div>
                        <div style={{ fontSize: '11px', maxWidth: '280px', lineHeight: '1.4', fontWeight: '600' }}>
                          {t.mapHint}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* DETAILS CARD (flex: 1, full list of sidebar fields) */}
                <div className="premium-card" style={{ flex: 1.3, minWidth: '350px', padding: '20px', display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e1', borderRadius: '20px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {t.projectDetailsTitle}
                      </h4>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                      <div>
                        <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.fieldType || 'Тип объекта'}</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{selectedProject.object_type_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.fieldCustomer || 'Заказчик'}</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{selectedProject.customer_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.fieldRegion || 'Регион цен'}</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{selectedProject.region_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.fieldManager || 'Руководитель проекта'}</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{selectedProject.manager_name}</div>
                      </div>
                      {selectedProject.address && (
                        <div style={{ gridColumn: 'span 2' }}>
                          <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.lblAddress || 'Адрес'}</div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>📍 {selectedProject.address}</div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.fieldStartDate || 'Дата начала проекта'}</div>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginTop: '2px' }}>
                          {new Date(selectedProject.start_date).toLocaleDateString()}
                        </div>
                      </div>
                      {selectedProject.end_date && (
                        <div>
                          <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase' }}>{t.fieldEndDate || 'Дата окончания проекта'}</div>
                          <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginTop: '2px' }}>
                            {new Date(selectedProject.end_date).toLocaleDateString()}
                          </div>
                        </div>
                      )}

                      {/* Documents List */}
                      {selectedProject.documents && selectedProject.documents.length > 0 && (
                        <div style={{ gridColumn: 'span 2', marginTop: '8px' }}>
                          <div style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '800', textTransform: 'uppercase', marginBottom: '6px' }}>
                            {t.lblDocuments || 'Документы проекта'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {selectedProject.documents.map((doc, idx) => (
                              <div 
                                key={idx} 
                                onClick={() => handleOpenDocument(doc)}
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '8px', 
                                  background: '#f8fafc', 
                                  border: '1px solid #e2e8f0', 
                                  padding: '8px 12px', 
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  color: '#2563eb',
                                  cursor: 'pointer',
                                  textDecoration: 'underline'
                                }}
                                title="Скачать документ"
                              >
                                📄 {getCleanFilename(doc)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* BOTTOM ROW: OBJECTS (STAGES) */}
              <div className="premium-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid #cbd5e1', borderRadius: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
                    {t.objectsStagesTitle}
                  </h3>
                  {(userRole === 'admin' || userRole === 'estimator') && (
                    <button 
                      className="btn-primary" 
                      onClick={handleOpenCreateObject}
                      style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Plus size={16} /> {t.btnAddObject}
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {loadingObjects ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: '20px', fontWeight: '700' }}>
                      {t.loadingObjects}
                    </div>
                  ) : projectObjects.map(obj => (
                    <div 
                      key={obj.id} 
                      onClick={() => {
                        setSelectedObject(obj);
                        setObjectActiveTab('info');
                      }}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '16px 20px', 
                        background: '#f8fafc', 
                        borderRadius: '16px',
                        border: '1px solid #e2e8f0',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer'
                      }}
                      className="object-row"
                    >
                      <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <div style={{ background: '#eff6ff', padding: '10px', borderRadius: '10px', color: '#3b82f6', display: 'flex', alignItems: 'center' }}>
                          <Layers size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: '800', color: '#1e293b' }}>{obj.name}</div>
                          {obj.description && (
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', fontWeight: '500' }}>
                              {obj.description}
                            </div>
                          )}
                          {obj.address && (
                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', fontWeight: '600' }}>
                              📍 {obj.address}
                            </div>
                          )}
                          {obj.responsible_name && (
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontWeight: '600' }}>
                              👤 {t.lblResponsible || 'Ответственный'}: {obj.responsible_name}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        {/* Delete Object Button */}
                        {(userRole === 'admin' || userRole === 'estimator') && obj.id !== 'legacy' && (!obj.estimate || obj.estimate.status === 'draft') && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteObject(obj.id); }}
                              style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                              title="Удалить объект"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}

                        {obj.estimate ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedObject(obj); setObjectActiveTab('estimate'); }}
                            className="btn-primary"
                            style={{ padding: '6px 14px', fontSize: '12px', background: '#10b981', color: 'white', boxShadow: 'none' }}
                          >
                            {t.openEstimate || 'Открыть WBS'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {projectObjects.length === 0 && !loadingObjects && (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                      <Layers size={36} style={{ opacity: 0.3, marginBottom: '10px' }} />
                      <div style={{ fontSize: '13px', fontWeight: '700' }}>{t.noObjects}</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="premium-card" style={{ padding: '60px', textAlign: 'center', color: '#94a3b8', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '20px' }}>
              <Layers size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
              <div style={{ fontWeight: '700' }}>{t.selectProjectHint}</div>
            </div>
          )}
        </div>
      </div>
    );
  };;
;


  if (selectedObject) {
    const currentObj = projectObjects.find(o => o.id === selectedObject.id) || selectedObject;
    const isObjectEditable = (userRole === 'admin' || userRole === 'estimator') &&
      currentObj.id !== 'legacy' &&
      (!currentObj.estimate || currentObj.estimate.status === 'draft' || currentObj.estimate.status === 'not_started');

    const isEstOpen = objectActiveTab === 'estimate' || objectActiveTab === 'estimates';
    return (
      <div className="animate-fade-in" style={{ padding: isEstOpen ? '0px' : '24px 40px 40px', maxWidth: isEstOpen ? '100%' : '1350px', margin: '0 auto' }}>
        <ObjectDetailsView
          currentObj={currentObj}
          onBack={() => { setIsEditingInfo(false); setSelectedObject(null); }}
          objectActiveTab={objectActiveTab}
          setObjectActiveTab={setObjectActiveTab}
          isEditable={isObjectEditable}
          isEditingInfo={isEditingInfo}
          setIsEditingInfo={setIsEditingInfo}
          editObjectName={editObjectName}
          setEditObjectName={setEditObjectName}
          editObjectDescription={editObjectDescription}
          setEditObjectDescription={setEditObjectDescription}
          editObjectAddress={editObjectAddress}
          setEditObjectAddress={setEditObjectAddress}
          editObjectLatitude={editObjectLatitude}
          setEditObjectLatitude={setEditObjectLatitude}
          editObjectLongitude={editObjectLongitude}
          setEditObjectLongitude={setEditObjectLongitude}
          editObjectResponsibleId={editObjectResponsibleId}
          setEditObjectResponsibleId={setEditObjectResponsibleId}
          editObjectResponsibleSearch={editObjectResponsibleSearch}
          setEditObjectResponsibleSearch={setEditObjectResponsibleSearch}
          showEditObjectResponsibleDropdown={showEditObjectResponsibleDropdown}
          setShowEditObjectResponsibleDropdown={setShowEditObjectResponsibleDropdown}
          handleSaveInfo={handleSaveInfo}
          psdDocs={psdDocs}
          loadingPsdDocs={loadingPsdDocs}
          handleOpenAddPsd={handleOpenAddPsd}
          handleEditPsd={handleOpenEditPsd}
          handleDeletePsd={handleDeletePsd}
          getDocTypeName={getDocTypeName}
          getCleanFilename={getCleanFilename}
          userRole={userRole}
          lang={lang}
          setLang={setLang}
          t={t}
          getEstimateStatusBadgeStyle={getEstimateStatusBadgeStyle}
          api={api}
          selectedProjectId={selectedProjectId}
          setProjectObjects={setProjectObjects}
          setSelectedObject={setSelectedObject}
          schedulingData={schedulingData}
          loadingScheduling={loadingScheduling}
          managers={dictionaries.managers || []}
          estimateStatuses={dictionaries.statuses || []}
        />

        <ObjectPsdModal
          isOpen={showPsdModal}
          onClose={() => setShowPsdModal(false)}
          onSave={handleSavePsd}
          psdEditingDoc={psdEditingDoc}
          psdFormName={psdFormName}
          setPsdFormName={setPsdFormName}
          psdFormTypeId={psdFormTypeId}
          setPsdFormTypeId={setPsdFormTypeId}
          psdFormVersion={psdFormVersion}
          setPsdFormVersion={setPsdFormVersion}
          psdFormUrl={psdFormUrl}
          setPsdFormUrl={setPsdFormUrl}
          psdFormNotes={psdFormNotes}
          setPsdFormNotes={setPsdFormNotes}
          psdFormFileName={psdFormFileName}
          setPsdFormFile={setPsdFormFile}
          setPsdFormFileName={setPsdFormFileName}
          psdErrorMessage={psdErrorMessage}
          psdFormErrors={psdFormErrors}
          isSaving={isSaving}
          t={t}
          getDocTypesList={getDocTypesList}
          getCleanFilename={getCleanFilename}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: isEstimateOpen ? '0px' : '24px 40px 40px', maxWidth: isEstimateOpen ? '100%' : '1350px', margin: '0 auto' }}>
      {!isEstimateOpen && (
        <>
          {/* HEADER */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '20px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '32px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Calculator size={32} color="#3b82f6" />
                {t.title}
              </h1>
              <p style={{ color: '#64748b', marginTop: '8px', fontSize: '14px', fontWeight: '500' }}>{t.subtitle}</p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* Notifications Bell Popover */}
              <div className="notifications-bell-container" style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowNotificationsDropdown(!showNotificationsDropdown)}
                  style={{
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    width: '38px',
                    height: '38px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748b',
                    position: 'relative',
                    transition: 'all 0.2s ease'
                  }}
                  title={t.notificationsTitle}
                >
                  <Bell size={18} />
                  {Array.isArray(notifications) && notifications.filter(n => !n.is_read).length > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      background: '#ef4444',
                      color: 'white',
                      fontSize: '9px',
                      fontWeight: '800',
                      borderRadius: '50%',
                      width: '18px',
                      height: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid white'
                    }}>
                      {notifications.filter(n => !n.is_read).length}
                    </span>
                  )}
                </button>

                {showNotificationsDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: '48px',
                    right: 0,
                    width: '320px',
                    background: 'white',
                    borderRadius: '16px',
                    border: '1px solid #cbd5e1',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    zIndex: 1000,
                    padding: '16px',
                    maxHeight: '360px',
                    overflowY: 'auto'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ fontWeight: '800', fontSize: '14px', color: '#1e293b' }}>{t.notificationsTitle}</span>
                      {Array.isArray(notifications) && notifications.filter(n => !n.is_read).length > 0 && (
                        <button
                          onClick={handleReadAllNotifications}
                          style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '11px', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                        >
                          {t.markAllAsRead}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {!Array.isArray(notifications) || notifications.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: '12px', fontWeight: '500' }}>
                          {t.noNotifications}
                        </div>
                      ) : (
                        notifications.map(n => {
                          let text = n.message_text;
                          if (n.message_code === 'PROJECT_APPROVAL_NOTIFICATION') {
                            text = t.projectApprovalNotification
                              ? t.projectApprovalNotification.replace('{project_code}', n.projects?.code || '')
                              : n.message_text;
                          } else if (n.message_code === 'PROJECT_APPROVED_MANAGER_NOTIFICATION') {
                            text = t.projectApprovedManagerNotification
                              ? t.projectApprovedManagerNotification.replace('{project_code}', n.projects?.code || '').replace('{project_name}', n.projects?.name || '')
                              : n.message_text;
                          } else if (n.message_code === 'PROJECT_APPROVED_NOTIFICATION') {
                            text = t.projectApprovedNotification
                              ? t.projectApprovedNotification.replace('{project_code}', n.projects?.code || '').replace('{project_name}', n.projects?.name || '')
                              : n.message_text;
                          } else if (n.message_code === 'PROJECT_REJECTED_NOTIFICATION') {
                            let comment = '';
                            const marker = 'Причина отклонения: ';
                            const idx = n.message_text.indexOf(marker);
                            if (idx !== -1) {
                              comment = n.message_text.substring(idx + marker.length);
                            } else {
                              comment = n.message_text;
                            }
                            text = t.projectRejectedNotification
                              ? t.projectRejectedNotification.replace('{project_code}', n.projects?.code || '').replace('{project_name}', n.projects?.name || '').replace('{reason}', comment)
                              : n.message_text;
                          }

                          return (
                            <div
                              key={n.id}
                              onClick={() => handleNotificationClick(n)}
                              style={{
                                padding: '10px 12px',
                                borderRadius: '12px',
                                background: n.is_read ? '#f8fafc' : '#eff6ff',
                                border: n.is_read ? '1px solid #f1f5f9' : '1px solid #bfdbfe',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative'
                              }}
                            >
                              {!n.is_read && (
                                <span style={{
                                  position: 'absolute',
                                  top: '12px',
                                  right: '12px',
                                  width: '6px',
                                  height: '6px',
                                  background: '#3b82f6',
                                  borderRadius: '50%'
                                }} />
                              )}
                              <p style={{ margin: 0, fontSize: '12px', color: '#334155', lineHeight: '1.4', fontWeight: n.is_read ? '500' : '600', paddingRight: '12px' }}>
                                {text}
                              </p>
                              <span style={{ fontSize: '9px', color: '#94a3b8', marginTop: '6px', display: 'block', fontWeight: '600' }}>
                                {new Date(n.created_at).toLocaleString()}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Language Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', padding: '6px 12px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>{lang === 'ru' ? 'ЯЗЫК:' : lang === 'ka' ? 'ენა:' : lang === 'az' ? 'DİL:' : 'LANG:'}</span>
                <select
                  style={{ border: 'none', background: 'none', fontWeight: '800', fontSize: '12px', cursor: 'pointer', outline: 'none' }}
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                >
                  <option value="ru">RU</option>
                  <option value="en">EN</option>
                  <option value="ka">KA</option>
                  <option value="az">AZ</option>
                </select>
              </div>
            </div>
          </div>

          {/* TABS */}
          <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
            {[
              { id: 'dictionaries', label: t.tabDictionaries, icon: <Layers size={16} />, visible: userRole !== 'financial_director' },
              { id: 'estimates', label: t.tabEstimates, icon: <Calculator size={16} />, visible: userRole !== 'pricer' && userRole !== 'financial_director' },
              { id: 'all_estimates', label: t.tabAllEstimates || 'Сметы', icon: <FileText size={16} />, visible: userRole !== 'pricer' },
              { id: 'gpr', label: t.tabGpr || 'ГПР', icon: <Table size={16} />, visible: userRole !== 'pricer' && userRole !== 'financial_director' },
              { id: 'gpm', label: t.gpmTitle || 'ГПМ', icon: <Truck size={16} />, visible: userRole !== 'pricer' && userRole !== 'financial_director' },
              { id: 'contracts', label: t.tabContracts || 'Договора', icon: <Briefcase size={16} />, visible: userRole !== 'pricer' && userRole !== 'financial_director' },
              { id: 'operfacts', label: t.tabOperFacts || 'Оперфакт', icon: <ClipboardCheck size={16} />, visible: userRole !== 'pricer' && userRole !== 'financial_director' },
            ]
            .filter(tab => tab.visible)
            .map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 18px', fontSize: '14px', fontWeight: '700',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: activeTab === tab.id ? '#3b82f6' : '#64748b',
                  borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                  marginBottom: '-1px'
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </>
      )}

      {activeTab === 'dictionaries' && (
        <DictionariesPage 
          lang={lang} 
          userRole={userRole} 
          t={t} 
          renderProjectsRegistry={() => renderProjectsTable(true)}
          handleOpenCreateModal={handleOpenCreateModal}
        />
      )}

      {activeTab === 'all_estimates' && (
        <EstimatesPage
          api={api}
          lang={lang}
          setLang={setLang}
          t={t}
          onOpenEstimate={onOpenEstimate}
          userRole={userRole}
          highlightEstimateId={highlightedEstimateId}
          onHighlightConsumed={() => setHighlightedEstimateId(null)}
          onOpenScheduling={(target) => {
            setScheduleTarget(target);
            setActiveTab('gpr');
          }}
          onEstimateOpenChange={setIsEstimateOpen}
        />
      )}

      {activeTab === 'gpr' && (
        <GprPage
          api={api}
          lang={lang}
          t={t}
          userRole={userRole}
          initialTarget={scheduleTarget}
          onInitialTargetConsumed={() => setScheduleTarget(null)}
        />
      )}

      {activeTab === 'gpm' && (
        <GpmPage
          api={api}
          lang={lang}
          t={t}
          userRole={userRole}
        />
      )}

      {activeTab === 'estimates' && renderEstimatesDashboard()}

      {activeTab === 'contracts' && (
        <ContractsPage
          api={api}
          lang={lang}
          t={t}
          userRole={userRole}
        />
      )}

      {activeTab === 'operfacts' && (
        <OperFactsPage
          api={api}
          userRole={userRole}
          t={t}
          lang={lang}
        />
      )}

      {/* CREATE OBJECT MODAL */}
      <ObjectCreateModal
        isOpen={showCreateObjectModal}
        onClose={() => setShowCreateObjectModal(false)}
        onSave={handleCreateObject}
        objectForm={objectForm}
        setObjectForm={setObjectForm}
        t={t}
        lang={lang}
        isSaving={isSaving}
        managers={dictionaries.managers || []}
          estimateStatuses={dictionaries.statuses || []}
        objectResponsibleSearch={objectResponsibleSearch}
        setObjectResponsibleSearch={setObjectResponsibleSearch}
        showObjectResponsibleDropdown={showObjectResponsibleDropdown}
        setShowObjectResponsibleDropdown={setShowObjectResponsibleDropdown}
        setObjectResponsibleId={setObjectResponsibleId}
      />

{showCreateModal && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleCreateProject}>
            <h3 style={{ margin: '0 0 25px 0', fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>{t.modalTitle}</h3>

            {/* Error Message */}
            {errorMessage && (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', marginBottom: '20px' }}>
                ⚠️ {errorMessage}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {/* Code & Name Row */}
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ width: '130px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldCode} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={code}
                    disabled
                    readOnly
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '700', background: '#e2e8f0', color: '#475569', cursor: 'not-allowed' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldName} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setFormErrors({ ...formErrors, name: false }); }}
                    placeholder={t.placeholderName}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: formErrors.name ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* Object Type & Customer Row */}
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldType} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={objectType}
                    onChange={(e) => { setObjectType(e.target.value); setFormErrors({ ...formErrors, objectType: false }); }}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: formErrors.objectType ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderSelect}</option>
                    {dictionaries.object_types.map(t => (
                      <option key={t.id} value={t.code}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldCustomer} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={customer}
                    onChange={(e) => { setCustomer(e.target.value); setFormErrors({ ...formErrors, customer: false }); }}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: formErrors.customer ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderSelect}</option>
                    {dictionaries.customers.map(c => (
                      <option key={c.id} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Country, Region & Manager Row */}
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.lblCountry || 'Страна'} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={selectedCountryId}
                    onChange={(e) => {
                      const cId = e.target.value;
                      setSelectedCountryId(cId);
                      const availableRegs = (dictionaries.regions || []).filter(r => !cId || r.country_id === cId);
                      if (!availableRegs.some(r => r.id === regionId)) {
                        setRegionId('');
                      }
                    }}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderSelectCountry || 'Выберите страну...'}</option>
                    {(dictionaries.countries || []).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldRegion} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={regionId}
                    onChange={(e) => { setRegionId(e.target.value); setFormErrors({ ...formErrors, regionId: false }); }}
                    disabled={!selectedCountryId && (dictionaries.countries || []).length > 0}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: formErrors.regionId ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{selectedCountryId ? (t.placeholderSelect || 'Выберите регион...') : 'Сначала выберите страну...'}</option>
                    {(dictionaries.regions || [])
                      .filter(r => !selectedCountryId || r.country_id === selectedCountryId)
                      .map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))
                    }
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldManager} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={managerId}
                    onChange={(e) => {
                      const mId = e.target.value;
                      setManagerId(mId);
                      const mObj = (dictionaries.managers || []).find(m => m.id === mId);
                      setManagerSearch(mObj ? `${mObj.first_name} ${mObj.last_name}` : '');
                      setFormErrors({ ...formErrors, managerSearch: false });
                    }}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: formErrors.managerSearch ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', background: 'white', fontSize: '13px', fontWeight: '600' }}
                  >
                    <option value="">{t.placeholderManager || 'Выберите сметчика...'}</option>
                    {(dictionaries.managers || [])
                      .filter(m => {
                        if (!regionId) return true;
                        return m.profile_regions?.some(pr => pr.region_id === regionId);
                      })
                      .map(m => (
                        <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              {/* Dates Row */}
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldStartDate} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setFormErrors({ ...formErrors, startDate: false }); }}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: formErrors.startDate ? '2px solid #ef4444' : '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.fieldEndDate}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* Address Row */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.lblAddress || 'Адрес'}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Улица, город..."
                    value={projectAddress}
                    onChange={(e) => setProjectAddress(e.target.value)}
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                  <button
                    type="button"
                    onClick={() => setIsProjectCreateMapOpen(true)}
                    title="Выбрать на карте"
                    style={{
                      padding: '10px 14px',
                      background: '#eff6ff',
                      border: '2px solid #3b82f6',
                      borderRadius: '10px',
                      color: '#3b82f6',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#3b82f6'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#3b82f6'; }}
                  >
                    <MapPin size={18} />
                  </button>
                </div>
              </div>

              {/* Coordinates Row */}
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.lblLatitude || 'Широта (Lat)'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="40.4093"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                    {t.lblLongitude || 'Долгота (Lng)'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="49.8671"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', boxSizing: 'border-box', outline: 'none', fontSize: '13px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* Documents File Input */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                  {t.fieldDocs}
                </label>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="file"
                    multiple
                    id="project-files-upload"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('project-files-upload').click()}
                    style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', background: '#f1f5f9', border: '2px dashed #cbd5e1', padding: '12px', borderRadius: '10px', fontWeight: '800', color: '#334155', cursor: 'pointer', fontSize: '12px' }}
                  >
                    <Upload size={16} /> {t.addDoc}
                  </button>
                </div>
                {/* Documents List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {documents.map((doc, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 12px', borderRadius: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: '#334155' }}>📄 {getCleanFilename(doc)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDocument(idx)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Buttons */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '30px' }}>
              <button
                type="button"
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                style={{ flex: 1, background: '#f1f5f9', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
                disabled={isSaving}
              >
                {t.btnCancel}
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', background: isSaving ? '#94a3b8' : '#3b82f6', borderRadius: '12px' }}
                disabled={isSaving}
              >
                {isSaving ? 'Сохранение...' : t.btnSave}
              </button>
            </div>
          </form>
        </div>
      )}

      {renderApprovalModal()}
      {renderApproveModal()}
      {renderRejectModal()}

      {/* Модальное окно Яндекс.Карт для создания проекта */}
      <AddressMapModal
        isOpen={isProjectCreateMapOpen}
        onClose={() => setIsProjectCreateMapOpen(false)}
        onSelect={(coords) => {
          setProjectAddress(coords.address);
          setLatitude(coords.latitude);
          setLongitude(coords.longitude);
        }}
        initialAddress={projectAddress}
        initialLatitude={latitude}
        initialLongitude={longitude}
        lang={lang}
      />

      {/* Модальное окно Яндекс.Карт для редактирования проекта */}
      <AddressMapModal
        isOpen={isProjectEditMapOpen}
        onClose={() => setIsProjectEditMapOpen(false)}
        onSelect={(coords) => {
          setEditProjectAddress(coords.address);
          setEditLatitude(coords.latitude);
          setEditLongitude(coords.longitude);
        }}
        initialAddress={editProjectAddress}
        initialLatitude={editLatitude}
        initialLongitude={editLongitude}
        lang={lang}
      />

      {/* Модальное окно Яндекс.Карт для редактирования объекта */}
      <AddressMapModal
        isOpen={isObjectEditMapOpen}
        onClose={() => setIsObjectEditMapOpen(false)}
        onSelect={(coords) => {
          setEditObjectAddress(coords.address);
          setEditObjectLatitude(coords.latitude);
          setEditObjectLongitude(coords.longitude);
        }}
        initialAddress={editObjectAddress}
        initialLatitude={editObjectLatitude}
        initialLongitude={editObjectLongitude}
        lang={lang}
      />
    </div>
  );
}


export default ProjectsPage;
