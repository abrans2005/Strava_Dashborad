/* core.js — 通用工具、状态与格式化（由 templates/dashboard.html 拆分） */

const resultEl = document.getElementById('result');
const pageTitleEl = document.getElementById('page-title');

const metricLabels = {
    count: '运动次数',
    distance_km: '距离 (km)',
    moving_time_hours: '移动时长 (h)',
    elevation_gain_m: '爬升 (m)'
};

function setActiveMenu(btn) {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// 空态 / 错误态图标（内联 SVG，避免额外依赖）
const STATE_ICONS = {
    empty: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 3h6l2-3h4"></path><path d="M5.5 6.5h13l2.5 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-6z"></path></svg>',
    error: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5"></path><circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none"></circle></svg>',
    lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path></svg>'
};

function buildStateBlock(options) {
    const opts = options || {};
    const action = opts.actionHtml ? `<div class="state-action">${opts.actionHtml}</div>` : '';
    const desc = opts.desc ? `<div class="state-desc">${escapeHtml(opts.desc)}</div>` : '';
    return `
        <div class="state-block ${opts.variant || ''}">
            <div class="state-icon">${STATE_ICONS[opts.icon] || STATE_ICONS.empty}</div>
            <div class="state-title">${escapeHtml(opts.title || '')}</div>
            ${desc}
            ${action}
        </div>
    `;
}

// 记录当前页面如何重新加载，供错误态的「重试」按钮复用
let currentPageReload = null;

function retryCurrentPage() {
    if (typeof currentPageReload === 'function') currentPageReload();
}

function startPageProgress() {
    const bar = document.getElementById('page-progress');
    if (bar) bar.classList.add('active');
}

function stopPageProgress() {
    const bar = document.getElementById('page-progress');
    if (bar) bar.classList.remove('active');
}

// 加载中：保留旧内容并变淡，顶部显示细进度条，避免白屏闪烁
function setLoading(title) {
    pageTitleEl.textContent = title;
    startPageProgress();
    resultEl.classList.add('loading');
}

function setError(title, message, retryable = true) {
    pageTitleEl.textContent = title;
    stopPageProgress();
    disposeRouteMaps();
    resultEl.classList.remove('loading');
    resultEl.classList.add('empty');
    const action = retryable && typeof currentPageReload === 'function'
        ? '<button class="btn-primary" onclick="retryCurrentPage()">重试</button>'
        : '';
    resultEl.innerHTML = buildStateBlock({
        icon: 'error',
        title: '加载失败',
        desc: message,
        actionHtml: action,
        variant: 'error'
    });
}

function setHtml(title, html) {
    pageTitleEl.textContent = title;
    stopPageProgress();
    disposeRouteMaps();
    resultEl.classList.remove('loading', 'empty');
    resultEl.innerHTML = html;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '-';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('zh-CN');
}

// Strava 的 start_date_local 表示当地墙上时间，但可能带 Z 或时区偏移，
// 直接 new Date() 会按时区换算，这里统一按字符串中的年月日时分秒解析。
function parseLocalWallClock(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) {
        const fallback = new Date(iso);
        return Number.isNaN(fallback.getTime()) ? null : fallback;
    }
    return new Date(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6] || 0)
    );
}

function activityStartDate(activity) {
    if (!activity) return null;
    if (activity.start_date_local) {
        const local = parseLocalWallClock(activity.start_date_local);
        if (local) return local;
    }
    return activity.start_date ? new Date(activity.start_date) : null;
}

function formatActivityDate(activity) {
    const date = activityStartDate(activity);
    return date ? date.toLocaleString('zh-CN') : '-';
}

function formatDistance(meters) {
    if (meters === null || meters === undefined) return '-';
    return (meters / 1000).toFixed(2) + ' km';
}

function formatTime(seconds) {
    if (seconds === null || seconds === undefined) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

function formatTimeSeconds(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatElevation(meters) {
    if (meters === null || meters === undefined) return '-';
    return meters.toFixed(0) + ' m';
}

function formatSpeed(mps) {
    if (mps === null || mps === undefined) return '-';
    return (mps * 3.6).toFixed(1) + ' km/h';
}

function formatCadence(value) {
    if (value === null || value === undefined) return '-';
    return value.toFixed(0) + ' rpm';
}

function formatSufferScore(value) {
    if (value === null || value === undefined) return '-';
    return value.toFixed(0);
}

function formatHeartRate(value) {
    if (value === null || value === undefined) return '-';
    return value.toFixed(0) + ' bpm';
}

function formatWatts(value) {
    if (value === null || value === undefined) return '-';
    return value.toFixed(0) + ' W';
}

const zoneColors = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];

function formatCreatedAt(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('zh-CN');
}

function formatSex(sex) {
    if (sex === 'M') return '男';
    if (sex === 'F') return '女';
    return sex || '-';
}

// 活动列表分页状态
let allActivities = [];
let activitiesLoaded = false;
let activitiesSyncPromise = null;

// 页面实际用到的活动字段（与服务端 ACTIVITY_FIELDS 对应），用于字段投影
const ACTIVITY_REQUEST_FIELDS = [
    'id', 'name', 'type', 'sport_type', 'start_date', 'start_date_local',
    'distance', 'moving_time', 'total_elevation_gain', 'average_speed',
    'max_speed', 'average_cadence', 'average_heartrate', 'max_heartrate',
    'suffer_score', 'average_watts', 'weighted_average_watts', 'max_watts'
].join(',');
let activityPage = 1;
let activityPageSize = 20;
let lastAnalyzedActivityId = null;

// 活动列表筛选条件
let activityFilters = {
    year: '',
    month: '',
    type: '',
    sportType: '',
    keyword: '',
};

// 赛段分析状态
let currentSegmentActivityId = null;
let segmentChartInstances = {};
