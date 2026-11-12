/* segments.js — 赛段分析（列表 / 历史趋势 / 单次分析），由 templates/dashboard.html 拆分 */

// ============== 赛段分析 ==============
        function destroySegmentCharts() {
            ChartRegistry.destroyGroup('segment:');
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

        function _segDay(item) {
            const d = activityStartDate(item);
            return d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` : '-';
        }

        // 统一错误/空态：401 引导授权、402 解释订阅限制，其余展示后端信息
        function _segmentErrorState(res, data, backAction) {
            const status = res ? res.status : 0;
            let icon = 'error';
            let title = '获取赛段数据失败';
            let desc = data && data.error ? data.error : '未知错误';
            if (status === 401) {
                icon = 'lock';
                title = '尚未连接 Strava';
                desc = '请先在右上角点击「立即同步」完成授权，再回来查看赛段。';
            } else if (status === 402) {
                icon = 'lock';
                title = '需要 Strava 订阅权限';
                desc = '赛段历史数据依赖 Strava 的订阅（Subscription）接口，当前账号暂无权限访问。';
            }
            return buildStateBlock({ icon, title, desc, actionHtml: backAction });
        }

        async function analyzeSegments(activityId, activityName) {
            currentSegmentActivityId = activityId;
            setLoading('赛段分析');
            destroySegmentCharts();

            try {
                // 活动列表一并拉取：为标题兜底（从 URL 直达时没有活动名）
                const [activities, res] = await Promise.all([
                    ensureActivitiesSynced(),
                    fetch(`/activities/${activityId}/segments`)
                ]);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setHtml('赛段分析', _segmentErrorState(res, data,
                        `<button class="btn-back" onclick="analyzeActivity('${activityId}')">返回活动分析</button>`));
                    return;
                }

                const activity = (Array.isArray(activities) ? activities : [])
                    .find(a => String(a.id) === String(activityId));
                renderSegmentList(data, activity);
            } catch (err) {
                setHtml('赛段分析', buildStateBlock({
                    icon: 'error',
                    title: '请求出错',
                    desc: err.message,
                    actionHtml: `<button class="btn-back" onclick="analyzeActivity('${activityId}')">返回活动分析</button>`,
                }));
            }
        }

        // 列表页：按赛段聚合（后端返回的是 effort 列表，同一赛段多次通过会重复出现）
        function renderSegmentList(efforts, activity) {
            const activityName = activity ? activity.name : null;
            const title = '赛段分析' + (activityName ? ' · ' + activityName : '');
            const backHtml = `
                <div class="segment-back">
                    <a class="analysis-back-link" onclick="analyzeActivity('${activity && activity.id ? activity.id : (currentSegmentActivityId || '')}')">← 返回活动分析</a>
                </div>`;

            if (!Array.isArray(efforts) || efforts.length === 0) {
                setHtml(title, backHtml + buildStateBlock({
                    icon: 'empty',
                    title: '该活动没有记录赛段',
                    desc: '经过带赛段的路段时 Strava 才会生成赛段记录。',
                    actionHtml: `<button class="btn-back" onclick="analyzeActivity('${activity && activity.id ? activity.id : (currentSegmentActivityId || '')}')">返回活动分析</button>`,
                }));
                return;
            }

            const groups = new Map();
            efforts.forEach(e => {
                const key = e.segment_id || e.name || 'unknown';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(e);
            });

            const cards = [...groups.values()].map(passes => {
                passes.sort((a, b) => (a.elapsed_time || 0) - (b.elapsed_time || 0));
                const best = passes[0];
                const worst = passes[passes.length - 1];
                const n = passes.length;
                const wattsArr = passes.map(p => p.average_watts).filter(v => v !== null && v !== undefined);
                const avgWatts = wattsArr.length
                    ? Math.round(wattsArr.reduce((s, v) => s + v, 0) / wattsArr.length) : null;
                const nameEsc = escapeHtml(best.name).replace(/'/g, "\\'");

                const passRows = passes.slice()
                    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
                    .map((p, i) => `
                        <div class="pass-row" onclick="openSegmentEffort('${p.effort_id}', '${nameEsc}', '${best.segment_id}')">
                            <span class="pass-idx">第 ${i + 1} 次</span>
                            <span class="pass-date">${_segDay(p)}</span>
                            <span class="pass-time">${formatTime(p.elapsed_time)}${p.effort_id === best.effort_id ? ' <span class="pr-badge">最快</span>' : ''}</span>
                            ${p.average_watts !== null && p.average_watts !== undefined ? `<span class="pass-watts">${p.average_watts.toFixed(0)} W</span>` : ''}
                            <span class="pass-go">查看 »</span>
                        </div>
                    `).join('');

                return `
                    <div class="segment-card" onclick="openSegmentHistory('${best.segment_id}', '${nameEsc}')">
                        <div class="seg-head">
                            <div class="name">${escapeHtml(best.name)}</div>
                            <div class="seg-meta">
                                ${formatDistance(best.distance)}
                                · 平均坡度 ${best.average_grade !== null && best.average_grade !== undefined ? best.average_grade.toFixed(1) + '%' : '-'}
                                ${best.maximum_grade !== null && best.maximum_grade !== undefined ? ` · 最大 ${best.maximum_grade.toFixed(1)}%` : ''}
                            </div>
                        </div>
                        <div class="analysis-stats-row seg-stats">
                            <div class="astat"><b>${n}</b><span>通过次数</span></div>
                            <div class="astat"><b>${formatTime(best.elapsed_time)}</b><span>最快${n > 1 ? `（${_segDay(best)}）` : ''}</span></div>
                            ${n > 1 ? `<div class="astat"><b>${formatTime(worst.elapsed_time)}</b><span>最慢</span></div>` : ''}
                            ${avgWatts ? `<div class="astat"><b>${avgWatts} W</b><span>平均功率</span></div>` : ''}
                        </div>
                        ${n > 1 ? `
                            <details class="seg-passes" onclick="event.stopPropagation()">
                                <summary>每次通过（${n}）</summary>
                                ${passRows}
                            </details>
                        ` : ''}
                    </div>
                `;
            }).join('');

            setHtml(title, `
                ${backHtml}
                <div class="seg-summary">${groups.size} 个赛段 · 共通过 ${efforts.length} 次</div>
                <div class="segment-list">${cards}</div>
            `);
        }

        async function loadSegmentHistory(segmentId, segmentName) {
            setLoading('赛段历史趋势');
            destroySegmentCharts();

            try {
                const res = await fetch(`/segments/${segmentId}/efforts`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setHtml('赛段历史趋势', _segmentErrorState(res, data,
                        `<button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>`));
                    return;
                }

                renderSegmentHistory(data, segmentName);
            } catch (err) {
                setHtml('赛段历史趋势', buildStateBlock({
                    icon: 'error',
                    title: '请求出错',
                    desc: err.message,
                    actionHtml: `<button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>`,
                }));
            }
        }

        function renderSegmentHistory(data, segmentName) {
            const title = '赛段历史趋势' + (segmentName ? ' · ' + escapeHtml(segmentName) : '');
            const efforts = data.efforts || [];

            if (!efforts.length) {
                setHtml(title, buildStateBlock({
                    icon: 'empty',
                    title: '暂无该赛段的历史数据',
                    actionHtml: `<button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>`,
                }));
                return;
            }

            // PR 信息：取 efforts 中最佳（最小 elapsed_time）
            const bestEffort = efforts.reduce((best, e) => {
                if (!e.elapsed_time) return best;
                if (!best || e.elapsed_time < best.elapsed_time) return e;
                return best;
            }, null);

            const prHtml = bestEffort ? `
                <div class="analysis-head-card">
                    <div class="analysis-stats-row" style="margin-top:0;">
                        <div class="astat"><b>${formatTime(bestEffort.elapsed_time)}</b><span>历史最佳</span></div>
                        <div class="astat"><b>${_segDay(bestEffort)}</b><span>最佳日期</span></div>
                        <div class="astat"><b>${efforts.length}</b><span>总尝试次数</span></div>
                    </div>
                </div>
            ` : '';

            // 历史 effort 列表：PR 行高亮，日期去秒
            const effortRows = efforts.slice().reverse().map(e => {
                const isPr = bestEffort && e.effort_id === bestEffort.effort_id;
                const nameEsc = escapeHtml(segmentName).replace(/'/g, "\\'");
                return `
                <div class="effort-row${isPr ? ' pr' : ''}" onclick="openSegmentEffort('${e.effort_id}', '${nameEsc}', '${e.segment_id}')">
                    <div class="date">${_segDay(e)}${isPr ? ' <span class="pr-badge">PR</span>' : ''}</div>
                    <div class="stats">
                        <span>${formatTime(e.elapsed_time)}</span>
                        ${e.average_watts !== null && e.average_watts !== undefined ? `<span>${e.average_watts.toFixed(0)} W</span>` : ''}
                        <span>${formatDistance(e.distance)}</span>
                    </div>
                    <span class="row-go">查看 »</span>
                </div>
            `;
            }).join('');

            // 季节性对比：保留表格（月份数量少，表格比两张柱图更直观）
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
                    <h4>季节性对比（按月）</h4>
                    <table class="data-table">
                        <thead><tr><th>月份</th><th>次数</th><th>平均用时</th><th>平均功率</th></tr></thead>
                        <tbody>${seasonalRows}</tbody>
                    </table>
                </div>
            ` : '';

            setHtml(title, `
                <div class="segment-back">
                    <a class="analysis-back-link" onclick="backToSegmentList()">← 返回赛段列表</a>
                </div>
                ${prHtml}
                <div class="section-title">趋势</div>
                <div class="analysis-grid" style="margin-top:0;">
                    <div class="analysis-chart-card">
                        <div class="chart-title">耗时趋势</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentTimeCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card" id="segmentPowerCard">
                        <div class="chart-title">功率趋势</div>
                        <div class="analysis-chart-wrapper"><canvas id="segmentPowerCanvas"></canvas></div>
                    </div>
                </div>
                <div class="section-title">明细</div>
                <div class="segment-detail-card" style="margin-top:0;">
                    <h4>历史记录（点击查看单次分析）</h4>
                    ${effortRows}
                </div>
                ${seasonalTable}
            `);

            renderSegmentTrendCharts(data);
        }

        function renderSegmentTrendCharts(data) {
            const efforts = (data.efforts || []).slice().sort((a, b) => (activityStartDate(a) || 0) - (activityStartDate(b) || 0));
            const labels = efforts.map(e => {
                const d = activityStartDate(e);
                return d ? `${d.getMonth() + 1}/${d.getDate()}` : '-';
            });
            const timeTooltip = {
                callbacks: {
                    label: (ctx) => `${ctx.dataset.label}: ${formatTime(ctx.parsed.y)}`,
                }
            };

            // 耗时趋势：总用时 + 骑行时间（虚线）
            const timeCtx = document.getElementById('segmentTimeCanvas').getContext('2d');
            createChart('segment:time', timeCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '总用时',
                            data: efforts.map(e => e.elapsed_time),
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: '骑行时间',
                            data: efforts.map(e => e.moving_time),
                            borderColor: '#22c55e',
                            backgroundColor: 'transparent',
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            pointRadius: 2,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false }, tooltip: timeTooltip },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 }, callback: v => formatTime(v) }, title: { display: true, text: '用时', color: '#999', font: { size: 12 } } }
                    }
                }
            });

            // 功率趋势：无功率数据时隐藏对应卡
            const hasWatts = efforts.some(e => e.average_watts !== null && e.average_watts !== undefined);
            const powerCard = document.getElementById('segmentPowerCard');
            if (powerCard) powerCard.style.display = hasWatts ? '' : 'none';
            if (hasWatts) {
                const powerCtx = document.getElementById('segmentPowerCanvas').getContext('2d');
                createChart('segment:power', powerCtx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: '平均功率 (W)',
                            data: efforts.map(e => e.average_watts),
                            borderColor: '#f97316',
                            backgroundColor: 'rgba(249, 115, 22, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            tension: 0.3,
                            fill: true
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } } },
                            y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
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
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setHtml('赛段单次分析', _segmentErrorState(res, data,
                        `<button class="btn-back" onclick="openSegmentHistory('${segmentId || ''}', '${escapeHtml(segmentName).replace(/'/g, "\\'")}')">返回赛段趋势</button>`));
                    return;
                }

                renderSegmentEffortDetail(data, segmentName, segmentId);
            } catch (err) {
                setHtml('赛段单次分析', buildStateBlock({
                    icon: 'error',
                    title: '请求出错',
                    desc: err.message,
                    actionHtml: `<button class="btn-back" onclick="backToSegmentList()">返回赛段列表</button>`,
                }));
            }
        }

        function renderSegmentEffortDetail(data, segmentName, segmentId) {
            const s = data.summary || {};
            const m = data.metrics || {};
            const pr = data.pr || {};
            const title = '赛段单次分析' + (segmentName ? ' · ' + escapeHtml(segmentName) : '');
            const sid = segmentId || s.segment_id || '';
            const backHtml = `
                <div class="segment-back">
                    <a class="analysis-back-link" onclick="openSegmentHistory('${sid}', '${escapeHtml(segmentName).replace(/'/g, "\\'")}')">← 返回赛段趋势</a>
                </div>`;

            // 核心指标条：与活动分析页同款统计块
            const wkgLabel = m.wkg !== null && m.wkg !== undefined
                ? `W/kg${m.estimated_wkg !== null && m.estimated_wkg !== undefined ? `（理论 ${m.estimated_wkg}）` : ''}`
                : null;
            const stats = [
                { label: '用时', value: formatTime(s.elapsed_time) },
                { label: '骑行时间', value: formatTime(s.moving_time) },
                { label: '平均功率', value: s.average_watts !== null && s.average_watts !== undefined ? s.average_watts.toFixed(0) + ' W' : null },
                { label: 'VAM', value: m.vam !== null && m.vam !== undefined ? m.vam + ' m/h' : null },
                { label: wkgLabel || 'W/kg', value: m.wkg !== null && m.wkg !== undefined ? String(m.wkg) : null },
                { label: '效率比', value: m.efficiency !== null && m.efficiency !== undefined ? (m.efficiency * 100).toFixed(1) + '%' : null },
            ];
            const statsHtml = stats.map(c => `
                <div class="astat${c.value === null ? ' muted' : ''}">
                    <b>${c.value === null ? '无数据' : c.value}</b>
                    <span>${c.label}</span>
                </div>
            `).join('');

            // vs PR 对比横幅：本次 / PR / 差距一眼可读
            const prGap = data.pr_gap_seconds;
            let prBanner = '';
            if (pr.pr_elapsed_time) {
                const gapText = prGap !== null && prGap !== undefined
                    ? (Math.abs(prGap) < 60 ? Math.round(Math.abs(prGap)) + 's' : formatTime(Math.abs(prGap)))
                    : '';
                const gapHtml = gapText
                    ? `<span class="pr-gap ${prGap > 0 ? 'slow' : 'fast'}">${prGap > 0 ? '▲ 慢' : '▼ 快'} ${gapText}</span>`
                    : '';
                prBanner = `
                    <div class="pr-banner">
                        <div class="pr-main">
                            <span class="pr-item"><b>${formatTime(s.elapsed_time)}</b><span>本次</span></span>
                            <span class="pr-vs">vs</span>
                            <span class="pr-item best"><b>${formatTime(pr.pr_elapsed_time)}</b><span>历史最佳</span></span>
                            ${gapHtml}
                        </div>
                        <div class="pr-sub">PR 达成于 ${_segDay({ start_date_local: pr.pr_date })} · 共尝试 ${pr.effort_count !== null && pr.effort_count !== undefined ? pr.effort_count : '-'} 次</div>
                    </div>
                `;
            }

            // 效率条：紧凑全宽（骑行 vs 停脚）
            const elapsed = s.elapsed_time || 0;
            const moving = s.moving_time || 0;
            const stopped = Math.max(0, elapsed - moving);
            const efficiencyHtml = elapsed > 0 ? `
                <div class="efficiency-bar-wrap">
                    <div class="efficiency-bar">
                        <div class="moving" style="flex:${moving};">骑行 ${formatTime(moving)}</div>
                        ${stopped > 0 ? `<div class="stopped" style="flex:${stopped};">停 ${formatTime(stopped)}</div>` : ''}
                    </div>
                    <div class="eff-note">骑行时间 / 总用时 = ${m.efficiency !== null && m.efficiency !== undefined ? (m.efficiency * 100).toFixed(1) + '%' : '-'}</div>
                </div>
            ` : '';

            setHtml(title, `
                ${backHtml}
                <div class="analysis-head-card">
                    <div class="analysis-stats-row" style="margin-top:0;">${statsHtml}</div>
                </div>
                ${prBanner}
                ${efficiencyHtml}
            `);
        }
