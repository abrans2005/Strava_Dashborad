/* compare.js — 周期对比页：本月 vs 上月、今年 vs 去年同期 + 五维雷达图 */

const COMPARE_METRICS = [
    { key: 'count', label: '运动次数', unit: '次' },
    { key: 'distance_km', label: '距离', unit: 'km' },
    { key: 'moving_time_hours', label: '时长', unit: 'h' },
    { key: 'elevation_gain_m', label: '爬升', unit: 'm' },
    { key: 'suffer_score', label: '强度分', unit: '' },
];

// offset=0 本月（截至今日），offset=1 上个自然月
function monthRange(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const end = offset === 0
        ? now
        : new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
    return { start: toDateInput(start), end: toDateInput(end) };
}

// 年度对比：今年 1/1 至今 vs 去年 1/1 至去年同日
function yearRange(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear() - offset, 0, 1);
    const end = offset === 0
        ? now
        : new Date(now.getFullYear() - offset, now.getMonth(), now.getDate());
    return { start: toDateInput(start), end: toDateInput(end) };
}

function buildComparePage() {
    return `
        <div class="filter-bar">
            <div class="filter-group">
                <label>统计口径</label>
                <span style="font-size:13px;color:#5a636e;padding:8px 0;">
                    对比区间为固定周期；运动类型跟随顶部全局筛选，时间范围不适用
                </span>
            </div>
        </div>
        <div class="compare-grid">
            <div class="chart-card" id="compare-month-card"></div>
            <div class="chart-card" id="compare-year-card"></div>
        </div>
    `;
}

function deltaHtml(current, previous) {
    if (previous === 0 && current === 0) return '<span class="delta-flat">—</span>';
    if (previous === 0) return '<span class="delta-up">▲ 新增</span>';
    const pct = ((current - previous) / previous) * 100;
    if (Math.abs(pct) < 0.05) return '<span class="delta-flat">— 持平</span>';
    const arrow = pct > 0 ? '▲' : '▼';
    const cls = pct > 0 ? 'delta-up' : 'delta-down';
    return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function comparisonCard(el, title, data, chartKey) {
    const r1 = data.range1, r2 = data.range2;
    const s1 = r1.summary, s2 = r2.summary;

    const rows = COMPARE_METRICS.map(m => `
        <tr>
            <td>${m.label}</td>
            <td class="num">${Number(s1[m.key] || 0).toLocaleString()}${m.unit ? ' ' + m.unit : ''}</td>
            <td>${deltaHtml(Number(s1[m.key] || 0), Number(s2[m.key] || 0))}</td>
            <td class="num">${Number(s2[m.key] || 0).toLocaleString()}${m.unit ? ' ' + m.unit : ''}</td>
        </tr>
    `).join('');

    // 按期分组取值，再逐指标归一化（每维除以两期中的较大值）
    const values1 = COMPARE_METRICS.map(m => Number(s1[m.key] || 0));
    const values2 = COMPARE_METRICS.map(m => Number(s2[m.key] || 0));
    const normalize = (values, other) => values.map((v, i) => {
        const maxV = Math.max(v, other[i], 0.0001);
        return Math.round((v / maxV) * 100) / 100;
    });
    const norm1 = normalize(values1, values2);
    const norm2 = normalize(values2, values1);

    el.innerHTML = `
        <div class="chart-title">${escapeHtml(title)}</div>
        <div class="compare-table-wrap">
            <table class="compare-table">
                <thead>
                    <tr><th>指标</th><th>${r1.start} ~ ${r1.end}</th><th>变化</th><th>${r2.start} ~ ${r2.end}</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div class="radar-box"><canvas id="${chartKey}"></canvas></div>
    `;

    createChart(chartKey, document.getElementById(chartKey).getContext('2d'), {
        type: 'radar',
        data: {
            labels: COMPARE_METRICS.map(m => m.label),
            datasets: [
                {
                    label: '近一期',
                    data: norm1,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.15)',
                    borderWidth: 2,
                    pointRadius: 3,
                },
                {
                    label: '上一期',
                    data: norm2,
                    borderColor: '#fc4c02',
                    backgroundColor: 'rgba(252, 76, 2, 0.12)',
                    borderWidth: 2,
                    pointRadius: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { align: 'start' } },
            scales: {
                r: {
                    suggestedMin: 0,
                    suggestedMax: 1,
                    ticks: { display: false },
                    pointLabels: { font: { size: 12 } },
                },
            },
        },
    });
}

async function fetchAndRenderCompare() {
    try {
        const month = monthRange(0), prevMonth = monthRange(1);
        const year = yearRange(0), lastYear = yearRange(1);
        const sportQs = globalFilters.sport
            ? ['sport_type=' + encodeURIComponent(globalFilters.sport)] : [];
        const qs = (r1, r2) => [
            'start1=' + r1.start, 'end1=' + r1.end,
            'start2=' + r2.start, 'end2=' + r2.end,
            ...sportQs,
        ].join('&');

        const [monthRes, yearRes] = await Promise.all([
            fetch('/compare?' + qs(month, prevMonth)),
            fetch('/compare?' + qs(year, lastYear)),
        ]);
        const monthData = await monthRes.json();
        const yearData = await yearRes.json();

        if (!monthRes.ok || !yearRes.ok) {
            setError('周期对比', '获取失败: ' + (monthData.error || yearData.error || '未知错误'));
            return;
        }

        const monthCard = document.getElementById('compare-month-card');
        const yearCard = document.getElementById('compare-year-card');
        if (!monthCard || !yearCard) return;

        comparisonCard(monthCard, '本月 vs 上月', monthData, 'compare:month');
        comparisonCard(yearCard, `今年 vs 去年同期`, yearData, 'compare:year');
    } catch (err) {
        setError('周期对比', '请求出错: ' + err.message);
    }
}

async function loadCompare(btn) {
    if (btn) setActiveMenu(btn);
    setLoading('周期对比');

    try {
        await ensureActivitiesSynced();
    } catch (err) {
        setError('周期对比', '活动同步失败: ' + err.message);
        return;
    }

    populateGlobalSportOptions();
    setHtml('周期对比', buildComparePage());
    await fetchAndRenderCompare();
}
