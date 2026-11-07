/* training.js — 训练负荷看板（由 templates/dashboard.html 拆分） */

// ============== 训练负荷与状态看板 ==============
        let trainingFtp = '';

        function destroyTrainingCharts() {
            ChartRegistry.destroyGroup('training:');
        }

        function formatLoad(value) {
            return value === null || value === undefined ? '-' : Number(value).toFixed(1);
        }

        function trainingStatusColor(key) {
            return {
                fresh: '#16a34a',
                ready: '#2563eb',
                balanced: '#ca8a04',
                fatigued: '#ea580c',
                strained: '#dc2626'
            }[key] || '#666';
        }

        function buildTrainingDashboard(data) {
            const s = data.summary || {};
            const status = s.status || {};
            const sources = s.source_counts || {};
            const change = s.week_change_pct;
            const changeText = change === null || change === undefined
                ? '上周无可比负荷'
                : `较前 7 天 ${change >= 0 ? '+' : ''}${change}%`;
            const statusColor = trainingStatusColor(status.key);
            const ftpHint = s.ftp
                ? `功率活动按 FTP ${s.ftp} W 计算 TSS`
                : '未设置 FTP，功率活动将使用 Strava 强度评分（如有）';

            const activityRows = (data.activities || []).map(a => {
                const methodLabel = a.load_method === 'power_tss'
                    ? '功率 TSS'
                    : (a.load_method === 'suffer_score' ? 'Strava 强度评分' : '无有效数据');
                return `
                    <tr>
                        <td>${formatActivityDate(a)}</td>
                        <td>${escapeHtml(a.name)}</td>
                        <td>${escapeHtml(a.type)}</td>
                        <td class="text-right">${formatTime(a.moving_time)}</td>
                        <td class="text-right">${a.intensity_factor !== null && a.intensity_factor !== undefined ? a.intensity_factor.toFixed(2) : '-'}</td>
                        <td class="text-right"><strong>${formatLoad(a.load)}</strong></td>
                        <td>${methodLabel}</td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="filter-bar">
                    <div class="filter-group">
                        <label>趋势范围</label>
                        <span style="font-size:13px;color:#5a636e;padding:8px 0;">跟随顶部全局时间范围（当前 ${periodDays()} 天）</span>
                    </div>
                    <div class="filter-group">
                        <label for="training-ftp">FTP (W)</label>
                        <input type="text" id="training-ftp" inputmode="decimal" value="${escapeHtml(trainingFtp)}" placeholder="用于计算功率 TSS">
                    </div>
                    <button class="btn-primary" onclick="applyTrainingFilters()">重新计算</button>
                </div>
                <div class="chart-card" style="margin-bottom:20px;border-left:4px solid ${statusColor};">
                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                        <strong style="font-size:20px;color:${statusColor};">${escapeHtml(status.label || '暂无状态')}</strong>
                        <span style="color:#666;">${escapeHtml(status.description || '')}</span>
                    </div>
                    <div style="font-size:12px;color:#888;margin-top:8px;">TSB = CTL − ATL；状态仅作为训练参考，请结合实际身体感受。</div>
                </div>
                <div class="summary-cards">
                    <div class="metric-card"><div class="label">ATL · 7 天疲劳</div><div class="value">${formatLoad(s.atl)}</div></div>
                    <div class="metric-card"><div class="label">CTL · 42 天体能</div><div class="value">${formatLoad(s.ctl)}</div></div>
                    <div class="metric-card"><div class="label">TSB · 训练状态</div><div class="value" style="color:${statusColor};">${formatLoad(s.tsb)}</div></div>
                    <div class="metric-card"><div class="label">近 7 天负荷</div><div class="value">${formatLoad(s.current_week_load)}</div><div style="font-size:12px;color:#888;margin-top:5px;">${changeText}</div></div>
                    <div class="metric-card"><div class="label">范围内总负荷</div><div class="value">${formatLoad(s.total_load)}</div><div style="font-size:12px;color:#888;margin-top:5px;">${s.activity_count || 0} 次活动</div></div>
                </div>
                <div class="chart-card">
                    <div class="chart-title">每日负荷与 ATL / CTL 趋势</div>
                    <div class="chart-wrapper"><canvas id="trainingTrendCanvas"></canvas></div>
                </div>
                <div class="chart-row">
                    <div class="chart-card">
                        <div class="chart-title">TSB 训练状态趋势</div>
                        <div class="chart-wrapper" style="height:280px;"><canvas id="trainingTsbCanvas"></canvas></div>
                    </div>
                    <div class="chart-card">
                        <div class="chart-title">近 12 周负荷</div>
                        <div class="chart-wrapper" style="height:280px;"><canvas id="trainingWeeklyCanvas"></canvas></div>
                    </div>
                </div>
                <div style="margin:18px 0;color:#666;font-size:13px;line-height:1.8;">
                    ${ftpHint}；无功率活动回退到 Strava 强度评分。ATL/CTL 使用全部历史预热，不仅计算当前展示区间。<br>
                    当前范围：功率 TSS ${sources.power_tss || 0} 次，Strava 强度评分 ${sources.suffer_score || 0} 次，无有效负荷 ${sources.unavailable || 0} 次。
                </div>
                <div class="chart-card" style="margin-top:20px;">
                    <div class="chart-title">最近活动负荷</div>
                    ${activityRows ? buildScrollableTable(`
                        <table class="data-table">
                            <thead><tr><th>时间</th><th>活动</th><th>类型</th><th class="text-right">移动时间</th><th class="text-right">IF</th><th class="text-right">负荷</th><th>计算方式</th></tr></thead>
                            <tbody>${activityRows}</tbody>
                        </table>
                    `) : '<div class="zone-empty">当前范围暂无活动</div>'}
                </div>
            `;
        }

        async function loadTrainingDashboard(btn) {
            if (btn) setActiveMenu(btn);
            setLoading('训练负荷与状态');
            destroyTrainingCharts();

            // 趋势范围由全局时间范围折算成天数；FTP 记录在 URL 参数里
            trainingFtp = currentRoute ? (currentRoute.params.ftp || '') : trainingFtp;
            const params = new URLSearchParams({ days: String(periodDays()) });
            if (String(trainingFtp).trim()) params.set('ftp', String(trainingFtp).trim());

            try {
                await ensureActivitiesSynced();
                const res = await fetch('/training-load?' + params.toString());
                const data = await res.json();
                if (!res.ok) {
                    setError('训练负荷与状态', data.error || '获取训练负荷失败');
                    return;
                }
                trainingFtp = data.summary && data.summary.ftp ? String(data.summary.ftp) : trainingFtp;
                setHtml('训练负荷与状态', buildTrainingDashboard(data));
                renderTrainingCharts(data);
                initTableScrollSync();
            } catch (err) {
                setError('训练负荷与状态', '请求出错: ' + err.message);
            }
        }

        function applyTrainingFilters() {
            trainingFtp = document.getElementById('training-ftp').value.trim();
            replaceParams({ ftp: trainingFtp });
            loadTrainingDashboard(null);
        }

        function renderTrainingCharts(data) {
            const daily = data.daily || [];
            const labels = daily.map(item => item.date.slice(5));
            const trendCtx = document.getElementById('trainingTrendCanvas').getContext('2d');
            createChart('training:trend', trendCtx, {
                data: {
                    labels,
                    datasets: [
                        { type: 'bar', label: '每日负荷', data: daily.map(item => item.load), backgroundColor: 'rgba(252,76,2,0.55)', borderRadius: 3, yAxisID: 'y', order: 3 },
                        { type: 'line', label: 'ATL（疲劳）', data: daily.map(item => item.atl), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1', order: 1 },
                        { type: 'line', label: 'CTL（体能）', data: daily.map(item => item.ctl), borderColor: '#2563eb', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1', order: 2 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 7 } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 15, color: '#666' } },
                        y: { beginAtZero: true, position: 'left', title: { display: true, text: '每日负荷' }, grid: { color: 'rgba(0,0,0,0.05)' } },
                        y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'ATL / CTL' }, grid: { drawOnChartArea: false } }
                    }
                }
            });

            const tsbCtx = document.getElementById('trainingTsbCanvas').getContext('2d');
            createChart('training:tsb', tsbCtx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'TSB',
                        data: daily.map(item => item.tsb),
                        borderColor: '#7c3aed',
                        backgroundColor: 'rgba(124,58,237,0.10)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, color: '#666' } },
                        y: { title: { display: true, text: 'TSB' }, grid: { color: 'rgba(0,0,0,0.05)' } }
                    }
                }
            });

            const weekly = data.weekly || [];
            const weeklyCtx = document.getElementById('trainingWeeklyCanvas').getContext('2d');
            createChart('training:weekly', weeklyCtx, {
                type: 'bar',
                data: {
                    labels: weekly.map(item => item.label),
                    datasets: [{
                        label: '周负荷',
                        data: weekly.map(item => item.load),
                        backgroundColor: 'rgba(34,197,94,0.65)',
                        borderColor: '#16a34a',
                        borderWidth: 1,
                        borderRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { title: items => items.length ? `周一开始：${weekly[items[0].dataIndex].week_start}` : '' } }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666' } },
                        y: { beginAtZero: true, title: { display: true, text: '负荷' }, grid: { color: 'rgba(0,0,0,0.05)' } }
                    }
                }
            });
        }

        // Wrap a table HTML with scroll containers: a top horizontal scrollbar and the actual scroll area
