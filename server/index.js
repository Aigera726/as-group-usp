const express = require('express');
const cors = require('cors');
require('dotenv').config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 8004;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Фильтрация и логгер запросов
app.use((req, res, next) => {
    // Отсекаем и не логируем автоматическое сканирование ботов (запросы вне /api)
    if (!req.url.startsWith('/api')) {
        return res.status(404).send('Not Found');
    }
    // Глушим частый фоновый поллинг уведомлений, чтобы не засорять консоль
    if (req.url.endsWith('/notifications') || req.url.includes('/notifications?')) {
        return next();
    }
    console.log(`[Estimates Module] ${req.method} ${req.url}`);
    next();
});

// Базовый маршрут
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', module: 'Estimates (Смета)', method: 'Manual Input' });
});

const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/api/estimates/uploads', express.static(uploadsDir));
app.use('/estimates/uploads', express.static(uploadsDir));
app.use('/uploads', express.static(uploadsDir));

// Общий журнал действий: одна точка на весь модуль. Событие отправляется в
// res.on('finish'), то есть уже после ответа клиенту - ни обработчик, ни
// пользователь журнал не ждут.
const { journalMiddleware } = require('./middleware/journal');
app.use(journalMiddleware);

// Нажатия из браузера. Пара к client/public/journal-ui.js: серверу видны только
// запросы, и на вопрос «куда человек нажал» отвечает лишь браузер.
//
// Ставится после authMiddleware, чтобы личность бралась из проверенного
// пропуска (req.user), а не из тела запроса: иначе любой мог бы прислать
// «Иванов нажал Удалить».
//
// Путь ровно один и объявлен до маршрутов модуля: journalMiddleware выше его не
// тронет - в его карте маршрутов коллекции journal нет.
const { authMiddleware } = require('./middleware/auth');
const { createUiRoute } = require('./journal/express-ui');
app.post('/api/estimates/journal/ui', authMiddleware, createUiRoute());

// Подключение маршрутов
const dictionariesRoutes = require('./routes/dictionaries');
const estimatesRoutes = require('./routes/estimates');
const projectsRoutes = require('./routes/projects');
const contractsRoutes = require('./routes/contracts');
const actualEstimatesRoutes = require('./routes/actual-estimates');
const gpmRoutes = require('./routes/gpm');
const operFactsRoutes = require('./routes/oper-facts');

app.use('/api/dictionaries', dictionariesRoutes);
// oper-facts должен быть подключён раньше estimatesRoutes/projectsRoutes — у них есть
// параметризованные роуты вида GET /:docId, которые иначе перехватят /oper-facts как ID.
app.use('/api/estimates', operFactsRoutes);
app.use('/api/estimates', projectsRoutes);
app.use('/api/estimates', estimatesRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/estimates', actualEstimatesRoutes);
app.use('/api/gpm', gpmRoutes);


// 404 для неизвестных API-маршрутов (удобнее отлаживать)
app.use('/api', (req, res) => {
    res.status(404).json({ error: `Маршрут не найден: ${req.method} ${req.originalUrl}` });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер модуля "Смета" запущен на порту ${PORT}`);
    console.log(`   Цены: GET /api/dictionaries/prices?resource_id=<uuid>`);
});
