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

        function _buildTopActivityTooltip(activity) {
            return [
                `距离: ${formatDistance(activity.distance)}`,
                `爬升: ${formatElevation(activity.total_elevation_gain)}`,
                `移动时间: ${formatTime(activity.moving_time)}`,
                `平均速度: ${formatSpeed(activity.average_speed)}`,
                `平均心率: ${formatHeartRate(activity.average_heartrate)}`,
                `最大功率: ${formatWatts(activity.average_watts)}`,
                `开始时间: ${formatActivityDate(activity)}`
            ];
        }

        function renderTopElevation(data) {
            const ctx = document.getElementById('topElevationCanvas').getContext('2d');
            const items = Array.isArray(data) ? data : [];
            if (items.length === 0) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            // 横柱状图：最高的在最上面，所以数组反转为升序，配合 y reverse
            const chartData = [...items].reverse();
            const labels = chartData.map(a => _truncateName(a.name));
            const values = chartData.map(a => a.total_elevation_gain || 0);

            // 单色柱，第一名（反转后为最后一项）加深强调
            const top1 = chartData.length - 1;
            const barColors = chartData.map((_, i) =>
                i === top1 ? 'rgba(22, 163, 74, 0.95)' : 'rgba(34, 197, 94, 0.45)');

            createChart('topElevation', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '爬升 (m)',
                        data: values,
                        backgroundColor: barColors,
                        borderColor: 'transparent',
                        borderWidth: 0,
                        borderRadius: 5,
                        borderSkipped: false
                    }]
                },
                options: {
                    indexAxis: 'y',
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
                                title: (ctx) => ctx[0] ? items[items.length - 1 - ctx[0].dataIndex].name : '',
                                label: (ctx) => _buildTopActivityTooltip(items[items.length - 1 - ctx.dataIndex])
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 11 } },
                            title: { display: true, text: '爬升 (m)', color: '#999', font: { size: 12 } }
                        },
                        y: {
                            grid: { display: false },
                            ticks: { color: '#555', font: { size: 12 } },
                            reverse: true
                        }
                    }
                }
            });
        }

        function renderTopDistance(data) {
            const ctx = document.getElementById('topDistanceCanvas').getContext('2d');
            const items = Array.isArray(data) ? data : [];
            if (items.length === 0) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            const chartData = [...items].reverse();
            const labels = chartData.map(a => _truncateName(a.name));
            const values = chartData.map(a => (a.distance || 0) / 1000);

            const top1 = chartData.length - 1;
            const barColors = chartData.map((_, i) =>
                i === top1 ? 'rgba(252, 76, 2, 0.95)' : 'rgba(252, 76, 2, 0.45)');

            createChart('topDistance', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '距离 (km)',
                        data: values,
                        backgroundColor: barColors,
                        borderColor: 'transparent',
                        borderWidth: 0,
                        borderRadius: 5,
                        borderSkipped: false
                    }]
                },
                options: {
                    indexAxis: 'y',
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
                                title: (ctx) => ctx[0] ? items[items.length - 1 - ctx[0].dataIndex].name : '',
                                label: (ctx) => _buildTopActivityTooltip(items[items.length - 1 - ctx.dataIndex])
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 11 } },
                            title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } }
                        },
                        y: {
                            grid: { display: false },
                            ticks: { color: '#555', font: { size: 12 } },
                            reverse: true
                        }
                    }
                }
            });
        }

        // --- 活动流数据分析 ---
        function destroyAnalysisCharts() {
            ChartRegistry.destroyGroup('analysis:');
            destroyActivityRouteMap();
        }

        function _analysisDistanceLabels(distance_km) {
            return (distance_km || []).map(d => Number(d).toFixed(1));
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
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '海拔 (m)', color: '#999', font: { size: 12 } } }
                    }
                }
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
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
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
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
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
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderHRPowerOverlay(data) {
            const ctx = document.getElementById('hrPowerCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const hr = (data.heartrate || []).map(v => Number(v) || 0);
            const watts = (data.watts || []).map(v => Number(v) || 0);
            createChart('analysis:hrPower', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '心率 (bpm)',
                            data: hr,
                            borderColor: '#ef4444',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            yAxisID: 'y'
                        },
                        {
                            label: '功率 (W)',
                            data: watts,
                            borderColor: '#f97316',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#ef4444', font: { size: 12 } }, title: { display: true, text: '心率 (bpm)', color: '#ef4444', font: { size: 12 } } },
                        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#f97316', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#f97316', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderElevationGrade(data) {
            const ctx = document.getElementById('elevationGradeCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const altitude = (data.altitude || []).map(v => Number(v) || 0);
            const grade = (data.grade || []).map(v => Number(v) || 0);
            const climbs = data.summary && data.summary.climb_segments ? data.summary.climb_segments : [];
            // 高亮爬坡段：构造背景色数组
            const climbColors = grade.map((g, i) => {
                const km = Number(data.distance_km[i]) || 0;
                const inClimb = climbs.some(c => km >= c.start_km && km <= c.end_km);
                return g > 5 || inClimb ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.25)';
            });
            createChart('analysis:elevationGrade', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '坡度 (%)',
                            data: grade,
                            backgroundColor: climbColors,
                            borderWidth: 0,
                            yAxisID: 'y1'
                        },
                        {
                            type: 'line',
                            label: '海拔 (m)',
                            data: altitude,
                            borderColor: '#16a34a',
                            backgroundColor: 'rgba(34, 197, 94, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: false,
                            yAxisID: 'y'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#16a34a', font: { size: 12 } }, title: { display: true, text: '海拔 (m)', color: '#16a34a', font: { size: 12 } } },
                        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '坡度 (%)', color: '#666', font: { size: 12 } } }
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
            renderElevationProfile(data);
            renderHRCurve(data);
            renderSpeedCurve(data);
            renderPowerCurve(data);
            renderHRPowerOverlay(data);
            renderElevationGrade(data);
            renderHRZoneDistribution(data);
        }
