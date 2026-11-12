/* records.js — 个人纪录页：活动级纪录 + 流数据纪录 */

// 纪录卡片的紧凑日期显示
function recordDate(activity) {
    const local = activity && activity.start_date_local ? activity.start_date_local : '';
    return local ? local.slice(0, 10) : '';
}

function recordCard(record) {
    const act = record.activity || {};
    const name = escapeHtml(act.name || '未命名活动');
    const date = recordDate(act);
    const sport = escapeHtml(act.sport_type || act.type || '');
    return `
        <div class="record-card">
            <div class="record-label">${escapeHtml(record.label)}</div>
            <div class="record-value">${escapeHtml(record.display)}</div>
            ${record.pace ? `<div class="record-sub">配速 ${escapeHtml(record.pace)}</div>` : ''}
            <div class="record-activity" title="${name}">${name}${date ? ' · ' + date : ''}${sport ? ' · ' + sport : ''}</div>
            <button class="btn-back" onclick="openActivityAnalysis('${act.id}')">查看分析</button>
        </div>
    `;
}

function buildRecordsPage() {
    return `
        <div class="filter-bar">
            <div class="filter-group">
                <label>统计口径</label>
                <span style="font-size:13px;color:#5a636e;padding:8px 0;">跟随顶部全局时间范围与运动类型</span>
            </div>
        </div>
        <div class="section-title">活动纪录</div>
        <div class="record-grid" id="records-grid"></div>
        <div class="section-title">流数据纪录</div>
        <div class="coverage-note" id="stream-coverage-note"></div>
        <div class="record-grid" id="stream-records-grid"></div>
    `;
}

async function fetchAndRenderRecords() {
    try {
        const res = await fetch('/records?' + globalDateQuery().join('&'));
        const data = await res.json();
        if (!res.ok) {
            setError('个人纪录', '获取失败: ' + (data.error || '未知错误'));
            return;
        }

        const grid = document.getElementById('records-grid');
        if (!grid) return;

        if (!(data.records || []).length) {
            grid.innerHTML = buildStateBlock({
                icon: '🏅',
                title: '当前范围内没有可统计的活动',
                desc: '调整顶部时间范围或运动类型后重试',
            });
        } else {
            grid.innerHTML = data.records.map(recordCard).join('');
        }

        const streamGrid = document.getElementById('stream-records-grid');
        const note = document.getElementById('stream-coverage-note');
        if (!streamGrid || !note) return;

        const cov = data.stream_coverage || { checked: 0, total: 0 };
        if (cov.total > 0 && cov.checked < cov.total) {
            note.textContent =
                `已统计 ${cov.checked} / ${cov.total} 条活动的流数据；` +
                '流数据纪录（最快 5K/10K、20 分钟功率）只覆盖「活动分析」打开过的活动，打开更多活动即可逐步解锁。';
        } else if (cov.total > 0) {
            note.textContent = `已统计全部 ${cov.checked} 条活动的流数据。`;
        } else {
            note.textContent = '当前范围内没有活动。';
        }

        if (!(data.stream_records || []).length) {
            streamGrid.innerHTML = `<div class="coverage-note">范围内还没有可用的流数据纪录。</div>`;
        } else {
            streamGrid.innerHTML = data.stream_records.map(recordCard).join('');
        }
    } catch (err) {
        setError('个人纪录', '请求出错: ' + err.message);
    }
}

async function loadRecords(btn) {
    if (btn) setActiveMenu(btn);
    setLoading('个人纪录');

    try {
        await ensureActivitiesSynced();
    } catch (err) {
        setError('个人纪录', '活动同步失败: ' + err.message);
        return;
    }

    populateGlobalSportOptions();
    setHtml('个人纪录', buildRecordsPage());
    await fetchAndRenderRecords();
}
