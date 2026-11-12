/* charts.js — Chart.js 全局主题、实例注册表与图表渲染（由 templates/dashboard.html 拆分） */

// 统一图表实例注册表：按 key 创建/替换/销毁，页面切换时不再逐个手动 destroy
const ChartRegistry = {
    _charts: new Map(),

    add(key, chart) {
        this.destroy(key);
        this._charts.set(key, chart);
        return chart;
    },

    destroy(key) {
        const chart = this._charts.get(key);
        if (chart) {
            chart.destroy();
            this._charts.delete(key);
        }
    },

    destroyGroup(prefix) {
        for (const key of [...this._charts.keys()]) {
            if (key.startsWith(prefix)) this.destroy(key);
        }
    },

    destroyAll() {
        for (const key of [...this._charts.keys()]) this.destroy(key);
    },
};

// 创建图表的统一入口：先销毁同名旧实例，再创建新图表。
// 销毁必须发生在 new Chart 之前——同一 canvas 重建时，旧实例若还挂着，
// Chart.js 会抛 "Canvas is already in use"。
function createChart(key, ctx, config) {
    ChartRegistry.destroy(key);
    const chart = new Chart(ctx, config);
    ChartRegistry._charts.set(key, chart);
    return chart;
}

// 全局主题：所有图表共享字体、legend、tooltip 与网格样式
(function applyChartTheme() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#5a636e';
    Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.06)';
    Chart.defaults.animation.duration = 350;
    Chart.defaults.plugins.legend.position = 'top';
    Chart.defaults.plugins.legend.align = 'end';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.plugins.legend.labels.boxWidth = 7;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(31, 35, 41, 0.92)';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
    Chart.defaults.plugins.tooltip.boxPadding = 4;
})();


        function renderChart(labels, series, metric) {
            const ctx = document.getElementById('chartCanvas').getContext('2d');
            const values = (series[metric] || []).map(v => Number(v) || 0);
            const isLine = metric === 'elevation_gain_m';
            const label = metricLabels[metric] || metric;

            // 渐变色背景
            const gradient = ctx.createLinearGradient(0, 0, 0, 380);
            gradient.addColorStop(0, 'rgba(252, 76, 2, 0.45)');
            gradient.addColorStop(1, 'rgba(252, 76, 2, 0.05)');

            const cfg = {
                type: isLine ? 'line' : 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: label,
                        data: values,
                        backgroundColor: isLine ? gradient : 'rgba(252, 76, 2, 0.75)',
                        borderColor: '#fc4c02',
                        borderWidth: isLine ? 2 : 0,
                        borderRadius: isLine ? 0 : 4,
                        borderSkipped: false,
                        fill: isLine,
                        tension: isLine ? 0.35 : 0,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: '#fc4c02',
                        pointBorderWidth: 2,
                        pointRadius: isLine ? 4 : 0,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(40, 40, 40, 0.9)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: {
                                title: function (context) {
                                    return context[0] ? context[0].label : '';
                                },
                                label: function (context) {
                                    const idx = context.dataIndex;
                                    const distance = series.distance_km
                                        ? Number(series.distance_km[idx] || 0).toFixed(2)
                                        : '-';
                                    const elevation = series.elevation_gain_m
                                        ? Number(series.elevation_gain_m[idx] || 0).toFixed(0)
                                        : '-';
                                    return [
                                        `${label}: ${context.parsed.y}`,
                                        `距离: ${distance} km`,
                                        `爬升: ${elevation} m`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: '#666', font: { size: 12 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0, 0, 0, 0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: {
                                display: true,
                                text: label,
                                color: '#999',
                                font: { size: 12 }
                            }
                        }
                    }
                }
            };

            createChart('main', ctx, cfg);
        }

        function renderPowerDist(data) {
            const ctx = document.getElementById('powerDistCanvas').getContext('2d');
            const labels = data.labels || [];
            const hours = (data.hours || []).map(v => Number(v) || 0);
            const counts = (data.counts || []).map(v => Number(v) || 0);
            const curve = (data.curve || []).map(v => Number(v) || 0);

            if (!labels.length) {
                // 没有功率数据时清空画布
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            createChart('power', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            type: 'line',
                            label: '正态分布拟合',
                            data: curve,
                            borderColor: '#ef4444',
                            backgroundColor: 'transparent',
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.4,
                            yAxisID: 'y',
                            order: 1
                        },
                        {
                            type: 'bar',
                            label: '活动时间',
                            data: hours,
                            backgroundColor: 'rgba(252, 76, 2, 0.5)',
                            borderColor: 'transparent',
                            borderWidth: 0,
                            borderRadius: 4,
                            borderSkipped: false,
                            yAxisID: 'y',
                            order: 2
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(40, 40, 40, 0.9)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: {
                                title: (ctx) => '功率区间: ' + (ctx[0] ? ctx[0].label : ''),
                                label: (ctx) => {
                                    const idx = ctx.dataIndex;
                                    if (ctx.dataset.type === 'line') {
                                        return `正态分布拟合: ${ctx.parsed.y} h`;
                                    }
                                    const count = counts[idx] !== undefined ? counts[idx] : '-';
                                    return [
                                        `活动时间: ${ctx.parsed.y} h`,
                                        `活动数量: ${count}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: '#666', font: { size: 11 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: { display: true, text: '活动时间 (h)', color: '#999', font: { size: 12 } }
                        }
                    }
                }
            });
        }

        function renderHRZones(data) {
            const ctx = document.getElementById('hrZoneCanvas').getContext('2d');
            const labels = data.labels || [];
            const hours = (data.hours || []).map(v => Number(v) || 0);
            const counts = (data.counts || []).map(v => Number(v) || 0);

            if (!labels.length) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            const gradient = 'rgba(66, 153, 225, 0.6)';

            createChart('hr', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '活动时间',
                        data: hours,
                        backgroundColor: gradient,
                        borderColor: '#3182ce',
                        borderWidth: 1,
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(40, 40, 40, 0.9)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: {
                                title: (ctx) => '心率区间: ' + (ctx[0] ? ctx[0].label : ''),
                                label: (ctx) => {
                                    const idx = ctx.dataIndex;
                                    const count = counts[idx] !== undefined ? counts[idx] : '-';
                                    return [
                                        `活动时间: ${ctx.parsed.y} h`,
                                        `活动数量: ${count}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: '#666', font: { size: 12 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: { display: true, text: '活动时间 (h)', color: '#999', font: { size: 12 } }
                        }
                    }
                }
            });
        }

        function _truncateName(name, maxLen = 22) {
            if (!name) return '-';
            if (name.length <= maxLen) return name;
            return name.slice(0, maxLen) + '…';
        }

        // --- 排行榜：HTML 列表（奖牌、迷你条、可点击进分析） ---
        function _rankRowHtml(item, index, maxVal, valueNum, valueText, tone) {
            const d = activityStartDate(item);
            const dateStr = d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
            const meta = [dateStr, item.sport_type || item.type].filter(Boolean).join(' · ');
            const pct = maxVal > 0 ? Math.max(1.5, (valueNum / maxVal) * 100) : 0;
            const rankCls = index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : '';
            return `
                <div class="rank-row${index >= 10 ? ' rank-extra' : ''}" onclick="openActivityAnalysis('${item.id}')">
                    <span class="rank-badge ${rankCls}">${index + 1}</span>
                    <span class="rank-info">
                        <span class="rank-name">${escapeHtml(_truncateName(item.name, 26))}</span>
                        ${meta ? `<span class="rank-meta">${escapeHtml(meta)}</span>` : ''}
                    </span>
                    <span class="rank-bar-wrap"><span class="rank-bar ${tone}" style="width:${pct.toFixed(1)}%;"></span></span>
                    <span class="rank-value">${valueText}</span>
                </div>
            `;
        }

        function _renderRankList(containerId, chartKey, items, valueNum, valueText, tone, emptyTitle) {
            const el = document.getElementById(containerId);
            if (!el) return;
            ChartRegistry.destroy(chartKey); // 清理旧 canvas 版本残留的实例

            if (!items.length) {
                el.innerHTML = buildStateBlock({
                    icon: 'empty',
                    title: emptyTitle,
                    desc: '当前筛选条件下没有可比的活动。',
                });
                const t = el.parentElement.querySelector('.rank-toggle');
                if (t) t.style.display = 'none';
                return;
            }

            const max = Math.max(...items.map(valueNum), 1);
            el.innerHTML = items
                .map((it, i) => _rankRowHtml(it, i, max, valueNum(it), valueText(it), tone))
                .join('');
            el.classList.remove('expanded');

            const btn = el.parentElement.querySelector('.rank-toggle');
            if (btn) {
                btn.style.display = items.length > 10 ? '' : 'none';
                btn.textContent = 'TOP20';
            }
        }

        function toggleRankRows(btn) {
            const list = btn.closest('.chart-card').querySelector('.rank-list');
            if (!list) return;
            const expanded = list.classList.toggle('expanded');
            btn.textContent = expanded ? '收起' : 'TOP20';
        }

        function renderTopElevation(data) {
            _renderRankList(
                'topElevationList', 'topElevation',
                Array.isArray(data) ? data : [],
                a => a.total_elevation_gain || 0,
                a => Math.round(a.total_elevation_gain || 0).toLocaleString() + ' m',
                'green',
                '暂无爬升排行'
            );
        }

        function renderTopDistance(data) {
            _renderRankList(
                'topDistanceList', 'topDistance',
                Array.isArray(data) ? data : [],
                a => a.distance || 0,
                a => ((a.distance || 0) / 1000).toFixed(1) + ' km',
                'orange',
                '暂无里程排行'
            );
        }

        // --- 活动流数据分析 ---
        function destroyAnalysisCharts() {
            ChartRegistry.destroyGroup('analysis:');
            destroyActivityRouteMap();
        }

        function _analysisDistanceLabels(distance_km) {
            return (distance_km || []).map(d => Number(d).toFixed(1));
        }

        // 爬坡段红色底纹插件：直接画在海拔剖面图上（替代独立的双轴联动图）
        function _climbBandPlugin(climbSegments, distanceKm) {
            return {
                id: 'climbBands',
                beforeDatasetsDraw(chart) {
                    if (!climbSegments || !climbSegments.length) return;
                    const { ctx, chartArea, scales } = chart;
                    const x = scales.x;
                    ctx.save();
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
                    climbSegments.forEach(c => {
                        const i0 = distanceKm.findIndex(d => d >= c.start_km);
                        const i1 = distanceKm.findIndex(d => d >= c.end_km);
                        if (i0 < 0 || i1 < 0 || i1 <= i0) return;
                        const px0 = x.getPixelForValue(i0);
                        const px1 = x.getPixelForValue(i1);
                        ctx.fillRect(px0, chartArea.top, px1 - px0, chartArea.bottom - chartArea.top);
                    });
                    ctx.restore();
                }
            };
        }

        function _mkAnalysisGradient(ctx, colorStart, colorEnd) {
            const gradient = ctx.createLinearGradient(0, 0, 0, 260);
            gradient.addColorStop(0, colorStart);
            gradient.addColorStop(1, colorEnd);
            return gradient;
        }

        function renderElevationProfile(data) {
            const ctx = document.getElementById('elevationCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const altitudes = (data.altitude || []).map(v => Number(v) || 0);
            const gradient = _mkAnalysisGradient(ctx, 'rgba(34, 197, 94, 0.5)', 'rgba(34, 197, 94, 0.05)');
            const climbs = (data.summary && data.summary.climb_segments) || [];
            createChart('analysis:elevation', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '海拔 (m)',
                        data: altitudes,
                        borderColor: '#16a34a',
                        backgroundColor: gradient,
                        borderWidth: 2,
                        fill: true,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '海拔 (m)', color: '#999', font: { size: 12 } } }
                    }
                },
                plugins: [_climbBandPlugin(climbs, data.distance_km || [])]
            });
        }

        function renderHRCurve(data) {
            const ctx = document.getElementById('hrCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const hr = (data.heartrate || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_heartrate ? Number(data.summary.avg_heartrate) : null;
            const avgData = avg !== null ? hr.map(() => avg) : [];
            createChart('analysis:hr', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '心率 (bpm)',
                            data: hr,
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: false
                        },
                        {
                            label: `平均心率 ${avg || '-'} bpm`,
                            data: avgData,
                            borderColor: '#ef4444',
                            borderWidth: 1,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '心率 (bpm)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderSpeedCurve(data) {
            const ctx = document.getElementById('speedCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const speed = (data.velocity_kmh || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_velocity_kmh ? Number(data.summary.avg_velocity_kmh) : null;
            const avgData = avg !== null ? speed.map(() => avg) : [];
            createChart('analysis:speed', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '速度 (km/h)',
                            data: speed,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.08)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: `平均速度 ${avg || '-'} km/h`,
                            data: avgData,
                            borderColor: '#3b82f6',
                            borderWidth: 1,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '速度 (km/h)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderPowerCurve(data) {
            const ctx = document.getElementById('powerCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const watts = (data.watts || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_watts ? Number(data.summary.avg_watts) : null;
            const avgData = avg !== null ? watts.map(() => avg) : [];
            if (!data.has_watts) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }
            createChart('analysis:power', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '功率 (W)',
                            data: watts,
                            borderColor: '#f97316',
                            backgroundColor: 'rgba(249, 115, 22, 0.08)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: `平均功率 ${avg || '-'} W`,
                            data: avgData,
                            borderColor: '#f97316',
                            borderWidth: 1,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderHRZoneDistribution(data) {
            const ctx = document.getElementById('hrZoneCanvas').getContext('2d');
            const stats = data.hr_zone_stats || [];
            if (!stats.length) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }
            const labels = stats.map(s => `Z${s.zone}`);
            const hours = stats.map(s => s.hours);
            const pcts = stats.map(s => s.pct);
            const colors = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];
            createChart('analysis:hrZoneDist', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '时长 (h)',
                        data: hours,
                        backgroundColor: colors.slice(0, hours.length),
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const s = stats[ctx.dataIndex];
                                    return [`时长: ${s.hours} h`, `占比: ${s.pct}%`, s.label];
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '时长 (h)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderAnalysisCharts(data) {
            destroyAnalysisCharts();
            renderActivityRouteMap(data);

            // 空态降级：无对应数据的卡整卡隐藏，不再留空白占位
            const hasAlt = (data.altitude || []).some(v => v !== null && v !== undefined);
            const hasHR = data.has_hr && (data.heartrate || []).some(v => v !== null);
            const hasWatts = data.has_watts && (data.watts || []).some(v => v !== null);
            const hasSpeed = (data.velocity_kmh || []).some(v => v !== null);
            const zoneStats = data.hr_zone_stats || [];
            _toggleAnalysisCard('elevationCard', hasAlt);
            _toggleAnalysisCard('hrCard', hasHR);
            _toggleAnalysisCard('powerCard', hasWatts);
            _toggleAnalysisCard('speedCard', hasSpeed);
            _toggleAnalysisCard('hrZoneCard', zoneStats.length > 0);

            if (hasAlt) renderElevationProfile(data);
            if (hasHR) renderHRCurve(data);
            if (hasSpeed) renderSpeedCurve(data);
            if (hasWatts) renderPowerCurve(data);
            if (zoneStats.length) renderHRZoneDistribution(data);
        }

        function _toggleAnalysisCard(id, show) {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? '' : 'none';
        }
