/* segments.js — 赛段分析（由 templates/dashboard.html 拆分） */

// ============== 赛段分析 ==============
        function destroySegmentCharts() {
            ChartRegistry.destroyGroup('segment:');
        }

        function formatLatLng(latlng) {
            if (!latlng || !Array.isArray(latlng) || latlng.length < 2) return '-';
            const lat = Number(latlng[0]).toFixed(5);
            const lng = Number(latlng[1]).toFixed(5);
            return `${lat}, ${lng}`;
        }


        // —— 路由入口：页面状态进 URL，支持后退与分享 ——
        function openSegments(activityId, activityName) {
            navigate('segments/' + activityId, { name: activityName });
        }

        function openSegmentHistory(segmentId, segmentName) {
            navigate('segment-history/' + segmentId, { name: segmentName });
        }

        function openSegmentEffort(effortId, segmentName, segmentId) {
            navigate('segment-effort/' + effortId, { name: segmentName, segment: segmentId });
        }

        function backToSegmentList() {
            navigate('segments/' + (currentSegmentActivityId || ''));
        }

        async function analyzeSegments(activityId, activityName) {
            currentSegmentActivityId = activityId;
            setLoading('赛段分析');
            destroySegmentCharts();

            try {
                const res = await fetch(`/activities/${activityId}/segments`);
                const data = await res.json();
                if (!res.ok) {
                    setHtml('赛段分析', `
                        <div class="segment-back">
                            <button class="btn-back" onclick="analyzeActivity(${activityId})">返回活动分析</button>
                        </div>
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            获取赛段列表失败：${escapeHtml(data.error || '未知错误')}
                        </div>
                    `);
                    return;
                }

                renderSegmentList(data, activityName);
            } catch (err) {
                setHtml('赛段分析', `
                    <div class="segment-back">
                        <button class="btn-back" onclick="analyzeActivity(${activityId})">返回活动分析</button>
                    </div>
                    <div style="color:#c00;padding:20px 0;text-align:center;">
                        请求出错：${escapeHtml(err.message)}
                    </div>
                `);
            }
        }

        function renderSegmentList(segments, activityName) {
            const title = `赛段分析 · ${escapeHtml(activityName)}`;
            if (!segments || segments.length === 0) {
                setHtml(title, `
                    <div class="segment-back">
                        <button class="btn-back" onclick="analyzeActivity('${currentSegmentActivityId || ''}')">返回活动分析</button>
                    </div>
                    <div style="padding:40px 0;text-align:center;color:#888;">该活动没有记录赛段。</div>
                `);
                return;
            }

            const cards = segments.map(s => `
                <div class="segment-card" onclick="openSegmentHistory('${s.segment_id}', '${escapeHtml(s.name).replace(/'/g, "\\'")}')">
                    <div class="name">${escapeHtml(s.name)}</div>
                    <div class="meta">
                        <span>📏 ${formatDistance(s.distance)}</span>
                        <span>⛰️ ${s.average_grade !== null && s.average_grade !== undefined ? s.average_grade.toFixed(1) + '%' : '-'}</span>
                        <span>⏱️ ${formatTime(s.elapsed_time)}</span>
                        ${s.average_watts !== null && s.average_watts !== undefined ? `<span>⚡ ${s.average_watts.toFixed(0)} W</span>` : ''}
                    </div>
                </div>
            `).join('');

            setHtml(title, `
                <div class="segment-back">
                    <button class="btn-back" onclick="analyzeActivity('${currentSegmentActivityId || ''}')">返回活动分析</button>
                </div>
                <div class="segment-grid">${cards}</div>
            `);
        }

        async function loadSegmentHistory(segmentId, segmentName) {
            setLoading('赛段历史趋势');
            destroySegmentCharts();

            try {
                const res = await fetch(`/segments/${segmentId}/efforts`);
                const data = await res.json();
                if (!res.ok) {
                    setHtml('赛段历史趋势', `
                        <div class="segment-back">
                            <button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>
                        </div>
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            ${escapeHtml(data.error || '获取失败')}
                        </div>
                    `);
                    return;
                }

                renderSegmentHistory(data, segmentName);
            } catch (err) {
                setHtml('赛段历史趋势', `
                    <div class="segment-back">
                        <button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>
                    </div>
                    <div style="color:#c00;padding:20px 0;text-align:center;">
                        请求出错：${escapeHtml(err.message)}
                    </div>
                `);
            }
        }

        function renderSegmentHistory(data, segmentName) {
            const title = `赛段历史趋势 · ${escapeHtml(segmentName)}`;
            const efforts = data.efforts || [];

            if (!efforts.length) {
                setHtml(title, `
                    <div class="segment-back">
                        <button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>
                    </div>
                    <div style="padding:40px 0;text-align:center;color:#888;">暂无该赛段的历史数据。</div>
                `);
                return;
            }

            // PR 信息：取 efforts 中最佳（最小 elapsed_time）
            const bestEffort = efforts.reduce((best, e) => {
                if (!e.elapsed_time) return best;
                if (!best || e.elapsed_time < best.elapsed_time) return e;
                return best;
            }, null);

            const prHtml = bestEffort ? `
                <div class="metric-highlight" style="margin-top:0;margin-bottom:16px;">
                    <div class="card"><div class="label">历史最佳用时</div><div class="value">${formatTime(bestEffort.elapsed_time)}</div></div>
                    <div class="card"><div class="label">最佳日期</div><div class="value">${formatActivityDate(bestEffort)}</div></div>
                    <div class="card"><div class="label">总尝试次数</div><div class="value">${efforts.length}</div></div>
                </div>
            ` : '';

            // 单次 effort 列表
            const effortRows = efforts.slice().reverse().map(e => `
                <div class="effort-row" onclick="openSegmentEffort('${e.effort_id}', '${escapeHtml(segmentName).replace(/'/g, "\\'")}', '${e.segment_id}')">
                    <div class="date">${formatActivityDate(e)}</div>
                    <div class="stats">
                        <span>⏱️ ${formatTime(e.elapsed_time)}</span>
                        <span>🚴 ${formatTime(e.moving_time)}</span>
                        ${e.average_watts !== null && e.average_watts !== undefined ? `<span>⚡ ${e.average_watts.toFixed(0)} W</span>` : ''}
                        <span>📏 ${formatDistance(e.distance)}</span>
                        <span>⛰️ ${e.average_grade !== null && e.average_grade !== undefined ? e.average_grade.toFixed(1) + '%' : '-'}</span>
                    </div>
                </div>
            `).join('');

            // 季节性对比表
            const byYearMonth = data.by_year_month || {};
            const seasonalKeys = Object.keys(byYearMonth).sort();
            const seasonalRows = seasonalKeys.map(k => {
                const v = byYearMonth[k];
                return `
                    <tr>
                        <td>${k}</td>
                        <td>${v.count}</td>
                        <td>${formatTime(v.avg_elapsed_time)}</td>
                        <td>${v.avg_watts !== null && v.avg_watts !== undefined ? v.avg_watts.toFixed(0) + ' W' : '-'}</td>
                    </tr>
                `;
            }).join('');
            const seasonalTable = seasonalRows ? `
                <div class="segment-detail-card">
                    <h4>季节性对比</h4>
                    <table class="data-table">
                        <thead><tr><th>月份</th><th>次数</th><th>平均用时</th><th>平均功率</th></tr></thead>
                        <tbody>${seasonalRows}</tbody>
                    </table>
                </div>
            ` : '';

            setHtml(title, `
                <div class="segment-back">
                    <button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>
                </div>
                ${prHtml}
                <div class="analysis-grid">
                    <div class="analysis-chart-card">
                        <div class="chart-title">耗时趋势</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentTimeCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">功率趋势</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentPowerCanvas"></canvas></div>
                    </div>
                </div>
                <div class="analysis-grid" style="margin-top:20px;">
                    <div class="analysis-chart-card">
                        <div class="chart-title">季节性对比（平均功率）</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentSeasonPowerCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">季节性对比（平均用时）</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentSeasonTimeCanvas"></canvas></div>
                    </div>
                </div>
                <div class="segment-detail-card" style="margin-top:20px;">
                    <h4>历史 effort 列表（点击展开单次分析）</h4>
                    ${effortRows}
                </div>
                ${seasonalTable}
                <div style="text-align:center;margin-top:20px;">
                    <button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>
                </div>
            `);

            renderSegmentTrendCharts(data);
        }

        function renderSegmentTrendCharts(data) {
            const efforts = (data.efforts || []).slice().sort((a, b) => (activityStartDate(a) || 0) - (activityStartDate(b) || 0));
            const labels = efforts.map(e => {
                const d = activityStartDate(e);
                return d ? `${d.getMonth() + 1}/${d.getDate()}` : '-';
            });

            // 耗时趋势
            const timeCtx = document.getElementById('segmentTimeCanvas').getContext('2d');
            createChart('segment:time', timeCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'elapsed_time (s)',
                            data: efforts.map(e => e.elapsed_time),
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            borderWidth: 2,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'moving_time (s)',
                            data: efforts.map(e => e.moving_time),
                            borderColor: '#22c55e',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            borderDash: [6, 4],
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            tension: 0.3,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '日期', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '时间 (s)', color: '#999', font: { size: 12 } } }
                    }
                }
            });

            // 功率趋势
            const hasWatts = efforts.some(e => e.average_watts !== null && e.average_watts !== undefined);
            if (hasWatts) {
                const powerCtx = document.getElementById('segmentPowerCanvas').getContext('2d');
                createChart('segment:power', powerCtx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'average_watts (W)',
                            data: efforts.map(e => e.average_watts),
                            borderColor: '#f97316',
                            backgroundColor: 'rgba(249, 115, 22, 0.1)',
                            borderWidth: 2,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            tension: 0.3,
                            fill: true
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                        scales: {
                            x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '日期', color: '#999', font: { size: 12 } } },
                            y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
                        }
                    }
                });
            }

            // 季节性对比图
            const byYearMonth = data.by_year_month || {};
            const seasonalKeys = Object.keys(byYearMonth).sort();
            if (seasonalKeys.length > 0) {
                const seasonPowerCtx = document.getElementById('segmentSeasonPowerCanvas').getContext('2d');
                createChart('segment:seasonPower', seasonPowerCtx, {
                    type: 'bar',
                    data: {
                        labels: seasonalKeys,
                        datasets: [{
                            label: '平均功率 (W)',
                            data: seasonalKeys.map(k => byYearMonth[k].avg_watts),
                            backgroundColor: 'rgba(249, 115, 22, 0.75)',
                            borderColor: '#f97316',
                            borderWidth: 1,
                            borderRadius: 6,
                            borderSkipped: false
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } } },
                            y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
                        }
                    }
                });

                const seasonTimeCtx = document.getElementById('segmentSeasonTimeCanvas').getContext('2d');
                createChart('segment:seasonTime', seasonTimeCtx, {
                    type: 'bar',
                    data: {
                        labels: seasonalKeys,
                        datasets: [{
                            label: '平均用时 (s)',
                            data: seasonalKeys.map(k => byYearMonth[k].avg_elapsed_time),
                            backgroundColor: 'rgba(59, 130, 246, 0.75)',
                            borderColor: '#3b82f6',
                            borderWidth: 1,
                            borderRadius: 6,
                            borderSkipped: false
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } } },
                            y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '时间 (s)', color: '#999', font: { size: 12 } } }
                        }
                    }
                });
            }
        }

        async function analyzeSegmentEffort(effortId, segmentName, segmentId) {
            setLoading('赛段单次分析');
            destroySegmentCharts();

            try {
                const res = await fetch(`/segment_efforts/${effortId}`);
                const data = await res.json();
                if (!res.ok) {
                    setHtml('赛段单次分析', `
                        <div class="segment-back">
                            <button class="btn-back" onclick="openSegmentHistory('${segmentId || ''}', '${escapeHtml(segmentName).replace(/'/g, "\\'")}')">返回赛段趋势</button>
                        </div>
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            ${escapeHtml(data.error || '获取失败')}
                        </div>
                    `);
                    return;
                }

                renderSegmentEffortDetail(data, segmentName, segmentId);
            } catch (err) {
                setHtml('赛段单次分析', `
                    <div class="segment-back">
                        <button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>
                    </div>
                    <div style="color:#c00;padding:20px 0;text-align:center;">
                        请求出错：${escapeHtml(err.message)}
                    </div>
                `);
            }
        }

        function renderSegmentEffortDetail(data, segmentName, segmentId) {
            const s = data.summary || {};
            const m = data.metrics || {};
            const pr = data.pr || {};

            const title = `赛段单次分析 · ${escapeHtml(segmentName)}`;
            const sid = segmentId || s.segment_id || '';

            // 核心指标卡片
            const cards = [
                { label: '用时', value: formatTime(s.elapsed_time) },
                { label: '移动时间', value: formatTime(s.moving_time) },
                { label: '平均功率', value: s.average_watts !== null && s.average_watts !== undefined ? s.average_watts.toFixed(0) + ' W' : '-' },
                { label: 'VAM', value: m.vam !== null && m.vam !== undefined ? m.vam + ' m/h' : '-' },
                { label: 'W/kg', value: m.wkg !== null && m.wkg !== undefined ? `${m.wkg}<small>（理论 ${m.estimated_wkg !== null && m.estimated_wkg !== undefined ? m.estimated_wkg : '-'}）</small>` : '-' },
                { label: '效率比', value: m.efficiency !== null && m.efficiency !== undefined ? (m.efficiency * 100).toFixed(1) + '%' : '-' },
            ];

            const cardsHtml = cards.map(c => `
                <div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>
            `).join('');

            // 效率分析
            const elapsed = s.elapsed_time || 0;
            const moving = s.moving_time || 0;
            const stopped = Math.max(0, elapsed - moving);
            const efficiencyBar = elapsed > 0 ? `
                <div style="display:flex;height:28px;border-radius:8px;overflow:hidden;margin:12px 0;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.06);">
                    <div style="flex:${moving};background:#22c55e;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;">移动 ${formatTime(moving)}</div>
                    <div style="flex:${stopped};background:#ef4444;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;">停脚 ${formatTime(stopped)}</div>
                </div>
            ` : '<p>无时间数据</p>';

            // 与 PR 对比
            const prGap = data.pr_gap_seconds;
            let prHtml = '';
            if (pr.pr_elapsed_time) {
                prHtml = `
                    <div class="segment-detail-card">
                        <h4>PR 信息</h4>
                        <p>PR 用时：${formatTime(pr.pr_elapsed_time)}</p>
                        <p>PR 日期：${pr.pr_date ? formatDate(pr.pr_date) : '-'}</p>
                        <p>总尝试次数：${pr.effort_count !== null && pr.effort_count !== undefined ? pr.effort_count : '-'}</p>
                        ${prGap !== null && prGap !== undefined ? `<p>本次差距：${prGap > 0 ? '慢 ' + formatTime(prGap) : '快 ' + formatTime(-prGap)}</p>` : ''}
                    </div>
                `;
            }

            // 地理位置
            const geoHtml = (s.start_latlng || s.end_latlng) ? `
                <div class="segment-detail-card">
                    <h4>地理位置</h4>
                    <p>起点：${formatLatLng(s.start_latlng)}</p>
                    <p>终点：${formatLatLng(s.end_latlng)}</p>
                </div>
            ` : '';

            setHtml(title, `
                <div class="segment-back">
                    <button class="btn-back" onclick="openSegmentHistory('${sid}', '${escapeHtml(segmentName).replace(/'/g, "\\'")}')">返回赛段趋势</button>
                </div>
                <div class="metric-highlight">${cardsHtml}</div>
                <div class="analysis-grid">
                    <div class="analysis-chart-card">
                        <div class="chart-title">坡度-功率匹配</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentGradePowerCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">效率分析（移动 vs 停脚）</div>
                        <div class="analysis-chart-wrapper" style="display:flex;flex-direction:column;justify-content:center;">
                            ${efficiencyBar}
                            <p style="font-size:12px;color:#888;text-align:center;">移动时间 /  elapsed_time = ${m.efficiency !== null && m.efficiency !== undefined ? (m.efficiency * 100).toFixed(1) + '%' : '-'}</p>
                        </div>
                    </div>
                </div>
                ${prHtml}
                ${geoHtml}
                <div style="text-align:center;margin-top:20px;">
                    <button class="btn-back" onclick="openSegmentHistory('${sid}', '${escapeHtml(segmentName).replace(/'/g, "\\'")}')">返回赛段趋势</button>
                </div>
            `);

            // 坡度-功率匹配图：由于没有 effort 级 stream，用赛段整体数据模拟单点
            const gradeCtx = document.getElementById('segmentGradePowerCanvas').getContext('2d');
            createChart('segment:gradePower', gradeCtx, {
                type: 'bar',
                data: {
                    labels: ['本次 effort'],
                    datasets: [
                        {
                            label: '平均坡度 (%)',
                            data: [s.average_grade],
                            backgroundColor: 'rgba(34, 197, 94, 0.7)',
                            borderColor: '#16a34a',
                            borderWidth: 1,
                            yAxisID: 'y'
                        },
                        {
                            label: '平均功率 (W)',
                            data: [s.average_watts],
                            backgroundColor: 'rgba(249, 115, 22, 0.7)',
                            borderColor: '#f97316',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 12 } } },
                        y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#16a34a', font: { size: 12 } }, title: { display: true, text: '坡度 (%)', color: '#16a34a', font: { size: 12 } } },
                        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#f97316', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#f97316', font: { size: 12 } } }
                    }
                }
            });
        }
