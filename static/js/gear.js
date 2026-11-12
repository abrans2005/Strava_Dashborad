/* gear.js — 装备里程页：按 gear_id 聚合 + 保养/更换周期提醒 */

const GEAR_THRESHOLD_STORAGE_KEY = 'gearThresholds';

// 保养/更换周期（km），存在浏览器本地，可改
function getGearThresholds() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(GEAR_THRESHOLD_STORAGE_KEY) || '{}');
    } catch (e) { /* 忽略损坏的本地数据 */ }
    return {
        bike: Number(saved.bike) > 0 ? Number(saved.bike) : 3000,
        shoe: Number(saved.shoe) > 0 ? Number(saved.shoe) : 600,
    };
}

function saveGearThresholds(bikeKm, shoeKm) {
    localStorage.setItem(GEAR_THRESHOLD_STORAGE_KEY, JSON.stringify({
        bike: bikeKm, shoe: shoeKm,
    }));
}

function buildGearPage() {
    const th = getGearThresholds();
    return `
        <div class="filter-bar">
            <div class="filter-group">
                <label for="gear-th-bike">自行车保养周期 (km)</label>
                <input type="text" id="gear-th-bike" inputmode="decimal" value="${th.bike}">
            </div>
            <div class="filter-group">
                <label for="gear-th-shoe">跑鞋更换周期 (km)</label>
                <input type="text" id="gear-th-shoe" inputmode="decimal" value="${th.shoe}">
            </div>
            <button class="btn-primary" onclick="applyGearThresholds()">保存周期</button>
            <div class="filter-group">
                <label>统计口径</label>
                <span style="font-size:13px;color:#5a636e;padding:8px 0;">范围内里程跟随全局筛选</span>
            </div>
        </div>
        <div id="gear-grid" class="gear-grid"></div>
    `;
}

function gearProgressTone(percent) {
    if (percent >= 100) return 'alert';
    if (percent >= 70) return 'warn';
    return '';
}

function gearCard(item) {
    const th = getGearThresholds();
    const isBike = item.type_label === '自行车';
    const periodKm = isBike ? th.bike : th.shoe;
    const action = isBike ? '保养' : '更换';

    // 周期进度基于 Strava 全期里程对周期取余
    let progressHtml = '';
    let progressText = '';
    if (item.strava_total_km > 0 && periodKm > 0) {
        const within = item.strava_total_km % periodKm;
        const percent = Math.min(100, Math.round((within / periodKm) * 100));
        const remaining = Math.max(0, Math.ceil(periodKm - within));
        const tone = gearProgressTone(percent);
        progressHtml = `
            <div class="gear-progress">
                <div class="gear-progress-fill ${tone}" style="width:${percent}%"></div>
            </div>`;
        progressText = percent >= 100
            ? `已达 ${action}周期（${periodKm} km），建议尽快${action}`
            : `距下次${action}约 ${remaining} km（周期 ${periodKm} km）`;
    } else {
        progressText = 'Strava 全期里程未知，重新授权同步运动员信息后可用';
    }

    const lastUsed = item.last_used ? item.last_used.slice(0, 10) : '—';
    return `
        <div class="gear-card">
            <div class="gear-head">
                <span class="gear-type-badge ${isBike ? '' : 'shoe'}">${escapeHtml(item.type_label)}</span>
                <span class="gear-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
            </div>
            ${progressHtml}
            <div class="gear-progress-text">${escapeHtml(progressText)}</div>
            <div class="gear-stats-row">
                范围内 <b>${item.distance_km.toFixed(1)} km</b> · ${item.count} 次 · 爬升 ${Math.round(item.elevation_m)} m
            </div>
            <div class="gear-stats-row">最近使用：${lastUsed}</div>
            <div class="gear-total">Strava 全期 ${item.strava_total_km.toFixed(1)} km</div>
        </div>
    `;
}

let lastGearData = null;

function renderGearStats(data) {
    const grid = document.getElementById('gear-grid');
    if (!grid) return;
    const items = (data && data.items) || [];
    if (!items.length) {
        grid.innerHTML = buildStateBlock({
            icon: '🚴',
            title: '没有找到关联装备的活动',
            desc: '旧缓存可能缺少 gear_id 字段，已在下次同步时自动补齐；也可以调整顶部筛选范围',
        });
        return;
    }
    grid.innerHTML = items.map(gearCard).join('');
}

function applyGearThresholds() {
    const bikeKm = Math.max(1, parseFloat(document.getElementById('gear-th-bike').value) || 3000);
    const shoeKm = Math.max(1, parseFloat(document.getElementById('gear-th-shoe').value) || 600);
    saveGearThresholds(bikeKm, shoeKm);
    if (lastGearData) renderGearStats(lastGearData);
}

async function fetchAndRenderGear() {
    try {
        const res = await fetch('/gear/stats?' + globalDateQuery().join('&'));
        const data = await res.json();
        if (!res.ok) {
            setError('装备里程', '获取失败: ' + (data.error || '未知错误'));
            return;
        }
        lastGearData = data;
        renderGearStats(data);
    } catch (err) {
        setError('装备里程', '请求出错: ' + err.message);
    }
}

async function loadGear(btn) {
    if (btn) setActiveMenu(btn);
    setLoading('装备里程');

    try {
        await ensureActivitiesSynced();
    } catch (err) {
        setError('装备里程', '活动同步失败: ' + err.message);
        return;
    }

    populateGlobalSportOptions();
    setHtml('装备里程', buildGearPage());
    await fetchAndRenderGear();
}
