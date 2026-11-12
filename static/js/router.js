/* router.js — hash 路由：页面状态进 URL，支持前进/后退与分享 */

// 当前路由：{ name, segments, params }；例：#/activities?period=this-year&sport=Run
let currentRoute = null;

// 离开活动列表前最后一份参数，「返回列表」时用它恢复
const lastListParams = { activities: {} };

const MENU_ROUTES = ['chart', 'activities', 'training', 'map', 'records', 'gear', 'compare'];
const LIST_CHILD_ROUTES = ['activity', 'segments', 'segment-history', 'segment-effort'];

function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    if (!raw) return { name: 'chart', segments: [], params: {} };
    const [path, query = ''] = raw.split('?');
    const segments = path.split('/').filter(Boolean);
    const params = {};
    if (query) new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    return { name: segments[0] || 'chart', segments: segments.slice(1), params };
}

function buildHash(name, segments = [], params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) qs.set(k, v);
    });
    const query = qs.toString();
    const path = [name, ...segments].join('/');
    return `#/${path}${query ? '?' + query : ''}`;
}

// 跳转到目标路由；replace=true 时只替换当前历史记录（筛选/分页操作用）
function navigate(name, params = {}, replace = false, segments = []) {
    const target = buildHash(name, segments, params);
    if (location.hash === target) {
        dispatchRoute();
        return;
    }
    if (replace) {
        history.replaceState(null, '', target);
        dispatchRoute();
    } else {
        location.hash = target;   // 触发 hashchange → dispatchRoute
    }
}

// 只改 URL 参数不触发页面重载（本地状态变化：分页、关键字等）
function replaceParams(patch) {
    if (!currentRoute) return;
    currentRoute.params = { ...currentRoute.params, ...patch };
    history.replaceState(null, '', buildHash(currentRoute.name, currentRoute.segments, currentRoute.params));
}

function setActiveRoute(name) {
    const menuName = MENU_ROUTES.includes(name) ? name
        : (LIST_CHILD_ROUTES.includes(name) ? 'activities' : 'chart');
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    const btn = document.querySelector(`.menu-item[data-route="${menuName}"]`);
    if (btn) btn.classList.add('active');
    return btn;
}

// 全局筛选参数：菜单切页时随行，保证各页共享同一时间范围与运动类型
const GLOBAL_PARAM_KEYS = ['period', 'from', 'to', 'sport'];

function navigateMenu(name) {
    const params = {};
    if (currentRoute) {
        GLOBAL_PARAM_KEYS.forEach(k => {
            if (currentRoute.params[k]) params[k] = currentRoute.params[k];
        });
    }
    navigate(name, params);
}

function dispatchRoute() {
    const route = parseHash();
    currentRoute = route;
    syncGlobalFilterBar();

    const btn = setActiveRoute(route.name);
    currentPageReload = () => dispatchRoute();

    switch (route.name) {
        case 'activities':
            lastListParams.activities = { ...route.params };
            loadActivities(btn, true);
            break;
        case 'training':
            loadTrainingDashboard(btn);
            break;
        case 'map':
            loadRouteMap(btn);
            break;
        case 'records':
            loadRecords(btn);
            break;
        case 'gear':
            loadGear(btn);
            break;
        case 'compare':
            loadCompare(btn);
            break;
        case 'activity':
            analyzeActivity(route.segments[0]);
            break;
        case 'segments':
            analyzeSegments(route.segments[0], route.params.name || '');
            break;
        case 'segment-history':
            loadSegmentHistory(route.segments[0], route.params.name || '');
            break;
        case 'segment-effort':
            analyzeSegmentEffort(route.segments[0], route.params.name || '', route.params.segment || '');
            break;
        case 'chart':
        default:
            loadChart(btn);
            break;
    }
}

window.addEventListener('hashchange', dispatchRoute);
