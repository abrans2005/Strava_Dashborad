/* filters.js — 全局时间范围与运动类型筛选（各页面共享） */

// 时间范围选项：与训练负荷后端的 days 语义对齐（30/90/180/365）
const PERIOD_OPTIONS = [
    { value: 'all', label: '全部' },
    { value: 'this-year', label: '本年' },
    { value: '30d', label: '近 30 天' },
    { value: '90d', label: '近 90 天' },
    { value: '180d', label: '近 180 天' },
    { value: '365d', label: '近 365 天' },
    { value: 'custom', label: '自定义' },
];

// 控件同步用的工作副本；唯一数据源是当前路由参数
const globalFilters = { period: 'all', from: '', to: '', sport: '' };

function pad2(n) {
    return String(n).padStart(2, '0');
}

function toDateInput(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 把时间范围解析成 start/end（YYYY-MM-DD，闭区间）；all 返回空串表示不限制
function periodToDateRange(period, from, to) {
    const today = new Date();
    if (period === 'custom') return { start: from || '', end: to || '' };
    if (period === 'this-year') {
        return { start: toDateInput(new Date(today.getFullYear(), 0, 1)), end: toDateInput(today) };
    }
    const days = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 }[period];
    if (!days) return { start: '', end: '' };
    const start = new Date(today.getTime() - (days - 1) * 86400000);
    return { start: toDateInput(start), end: toDateInput(today) };
}

// 面向后端 /chart*、/map/routes 的公共查询参数（start/end + sport_type）
function globalDateQuery() {
    const { start, end } = periodToDateRange(globalFilters.period, globalFilters.from, globalFilters.to);
    const qs = [];
    if (start) qs.push('start=' + encodeURIComponent(start));
    if (end) qs.push('end=' + encodeURIComponent(end));
    if (globalFilters.sport) qs.push('sport_type=' + encodeURIComponent(globalFilters.sport));
    return qs;
}

// 时间范围折算成天数（训练负荷接口用）；全部 → 3650 上限
function periodDays() {
    if (/^\d+d$/.test(globalFilters.period)) return parseInt(globalFilters.period, 10);
    const { start, end } = periodToDateRange(globalFilters.period, globalFilters.from, globalFilters.to);
    if (!start) return 3650;
    const ms = new Date((end || toDateInput(new Date())) + 'T00:00:00') - new Date(start + 'T00:00:00');
    return Math.min(3650, Math.max(1, Math.round(ms / 86400000) + 1));
}

// 活动本地 Date（列表页按天筛选用）
function activityLocalDate(activity) {
    return parseLocalWallClock(activity.start_date_local || activity.start_date);
}

function initGlobalFilterBar() {
    const periodSel = document.getElementById('global-period');
    if (!periodSel) return;
    periodSel.innerHTML = PERIOD_OPTIONS
        .map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    periodSel.addEventListener('change', () => updateGlobalFilters({ period: periodSel.value }));
    document.getElementById('global-from').addEventListener('change', e => updateGlobalFilters({ from: e.target.value }));
    document.getElementById('global-to').addEventListener('change', e => updateGlobalFilters({ to: e.target.value }));
    document.getElementById('global-sport').addEventListener('change', e => updateGlobalFilters({ sport: e.target.value }));
}

function updateGlobalFilters(patch) {
    Object.assign(globalFilters, patch);
    if (globalFilters.period !== 'custom') {
        globalFilters.from = '';
        globalFilters.to = '';
    }
    // 自定义范围要等起止日期都选好再刷新，避免中间态请求；
    // 中间态只更新控件（不能从路由参数回读，路由此时还没变）
    if (globalFilters.period === 'custom' && !(globalFilters.from && globalFilters.to)) {
        applyGlobalFilterControls();
        return;
    }
    if (globalFilters.period === 'custom'
        && globalFilters.from > globalFilters.to) {
        // 起止颠倒：不发起请求，等用户改到合法范围
        applyGlobalFilterControls();
        return;
    }
    const route = currentRoute || { name: 'chart', params: {} };
    navigate(route.name, {
        ...route.params,
        period: globalFilters.period,
        from: globalFilters.from,
        to: globalFilters.to,
        sport: globalFilters.sport,
    }, true);
}

// 把 globalFilters 工作副本刷到控件上（不含运动类型选项，选项由数据填充）
function applyGlobalFilterControls() {
    const periodSel = document.getElementById('global-period');
    if (!periodSel) return;
    periodSel.value = globalFilters.period;
    document.getElementById('global-from').value = globalFilters.from;
    document.getElementById('global-to').value = globalFilters.to;
    document.getElementById('global-custom-range').style.display =
        globalFilters.period === 'custom' ? '' : 'none';
}

// 从当前路由参数恢复全局筛选栏（前进/后退、分享链接都走这里）
function syncGlobalFilterBar() {
    const p = currentRoute ? currentRoute.params : {};
    globalFilters.period = p.period || 'all';
    globalFilters.from = p.from || '';
    globalFilters.to = p.to || '';
    globalFilters.sport = p.sport || '';

    applyGlobalFilterControls();
    const sportSel = document.getElementById('global-sport');
    if (sportSel) sportSel.value = globalFilters.sport;
}

// 运动类型选项依赖活动数据，活动同步完成后调用一次
function populateGlobalSportOptions() {
    const sel = document.getElementById('global-sport');
    if (!sel || !allActivities.length) return;
    const opts = getFilterOptions(allActivities);
    const values = Array.from(new Set([...opts.sportTypes, ...opts.types])).sort();
    sel.innerHTML = '<option value="">全部</option>' + values.map(t =>
        `<option value="${escapeHtml(t)}" ${t === globalFilters.sport ? 'selected' : ''}>${escapeHtml(t)}</option>`
    ).join('');
}
