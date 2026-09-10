import axios from 'axios';

const AUTH_API_URL = `http://${window.location.hostname}:9000/api`; // Главный сервер (логин/сессии)

const api = axios.create({
  baseURL: `http://${window.location.hostname}:9002/api`, // Наш бэкенд сметы динамически
});

// Перехватчик для добавления токена из URL или localStorage
api.interceptors.request.use((config) => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || localStorage.getItem('token');

  if (token && token !== 'null' && token !== 'undefined' && token.trim() !== '') {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Автообновление access_token по refresh_token при 401, чтобы не разлогинивать
// пользователя каждый раз, когда истекает срок жизни токена (~1 час у Supabase).
let refreshPromise = null;

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = axios.post(`${AUTH_API_URL}/auth/refresh`, { refresh_token: refreshToken })
      .then((res) => {
        const { access_token, refresh_token } = res.data.session;
        localStorage.setItem('token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        return access_token;
      })
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }

  return refreshPromise;
}

// Перехватчик для обработки ошибок (например, 401)
let sessionExpiredAlertShown = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 401 && originalRequest && !originalRequest._retriedAfterRefresh) {
      originalRequest._retriedAfterRefresh = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }
      if (!sessionExpiredAlertShown) {
        sessionExpiredAlertShown = true;
        alert('Сессия истекла. Пожалуйста, обновите страницу и войдите заново.');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
