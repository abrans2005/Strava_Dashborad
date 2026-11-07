/* chart-page.js — 运动员资料与图表分析页（由 templates/dashboard.html 拆分） */

function buildZonesPanel(zonesData) {
            // zonesData 应为数组；兼容旧对象格式
            let zones = [];
            if (Array.isArray(zonesData)) {
                zones = zonesData;
            } else if (zonesData && typeof zonesData === 'object') {
                if (zonesData.error) {
                    return `<div class="zone-card"><div class="zone-empty" style="color:#c00;">获取失败：${escapeHtml(zonesData.error)}<br><small style="color:#888;">请尝试重新授权，并确认 Strava 应用已开启 <b>profile:read_all</b> 权限。</small></div></div>`;
                }
                zones = [];
            }

            zones = zones.filter(z => z && Array.isArray(z.distribution_buckets) && z.distribution_buckets.length > 0);
            if (zones.length === 0) {
                return `<div class="zone-card"><h3>心率 / 功率区间</h3><div class="zone-empty">暂无区间数据</div></div>`;
            }

            return zones.map(zone => {
                const type = zone.type || 'heart_rate';
                const title = type === 'power' ? '功率区间' : '心率区间';
                const unit = type === 'power' ? 'W' : 'bpm';
                const tag = type === 'power' ? 'Power' : 'Heart Rate';

                const buckets = zone.distribution_buckets
                    .map((b, i) => ({ ...b, index: i }))
                    .filter(b => b.max !== null || b.min !== null);

                if (buckets.length === 0) {
                    return `<div class="zone-card"><h3>${title} <span class="zone-type-tag">${tag}</span></h3><div class="zone-empty">暂无有效区间</div></div>`;
                }

                // 最后一个 bucket 的 max 可能为 null / -1，表示无上限
                const definedMaxes = buckets.map(b => b.max).filter(v => v !== null && v !== undefined && v !== -1);
                const globalMax = definedMaxes.length ? Math.max(...definedMaxes) : Math.max(...buckets.map(b => (b.min || 0)));
                const tail = Math.max(type === 'power' ? 50 : 10, Math.round(globalMax * 0.08));

                const displayBuckets = buckets.map(b => {
                    const min = b.min !== null && b.min !== undefined ? b.min : 0;
                    const hasMax = b.max !== null && b.max !== undefined && b.max !== -1;
                    const max = hasMax ? b.max : (globalMax + tail);
                    return { ...b, min, max, hasMax };
                });

                const minBase = Math.min(...displayBuckets.map(b => b.min));
                const totalRange = Math.max(...displayBuckets.map(b => b.max)) - minBase;
                const effectiveTotal = totalRange > 0 ? totalRange : 1;

                const segments = displayBuckets.map((b, i) => {
                    const width = ((b.max - b.min) / effectiveTotal) * 100;
                    const color = zoneColors[i % zoneColors.length];
                    const rangeText = b.hasMax ? `${b.min}-${b.max}` : `${b.min}+`;
                    // 在区间段上显示心率/功率上限数字
                    const label = width > 8 ? (b.hasMax ? String(b.max) : '+') : '';
                    const timeText = b.time ? ' · 时间 ' + formatTimeSeconds(b.time) : '';
                    return `<div class="zone-segment" style="flex:${Math.max(width, 1)};background:${color};" title="Z${i + 1}: ${rangeText} ${unit}${timeText}"><span class="segment-label">${label}</span></div>`;
                }).join('');

                const legend = displayBuckets.map((b, i) => {
                    const color = zoneColors[i % zoneColors.length];
                    const rangeText = b.hasMax ? `${b.min}-${b.max}` : `${b.min}+`;
                    const timeText = b.time ? formatTimeSeconds(b.time) : '-';
                    return `
                        <div class="zone-legend-item">
                            <div class="zone-dot" style="background:${color}"></div>
                            <span>Z${i + 1}: ${rangeText} ${unit}</span>
                            <span class="zone-time">${timeText}</span>
                        </div>
                    `;
                }).join('');

                const note = zone.source === 'estimated'
                    ? `<span style="font-size:12px;color:#3182ce;font-weight:600;margin-left:8px;">根据历史活动估算（最大心率约 ${escapeHtml(zone.estimated_max_hr)} bpm）</span>`
                    : (zone.custom_zones
                        ? '<span style="font-size:12px;color:#fc4c02;font-weight:600;margin-left:8px;">自定义区间</span>'
                        : '<span style="font-size:12px;color:#888;font-weight:600;margin-left:8px;">Strava 默认区间</span>');

                return `
                    <div class="zone-card">
                        <h3>${title} <span class="zone-type-tag">${tag}</span>${note}</h3>
                        <div class="zone-bar">${segments}</div>
                        <div class="zone-legend">${legend}</div>
                    </div>
                `;
            }).join('');
        }

        function buildAthleteProfile(athlete, zonesData) {
            const fullName = escapeHtml(((athlete.firstname || '') + ' ' + (athlete.lastname || '')).trim()) || '运动员';
            const avatarUrl = athlete.profile_medium || athlete.profile || '';
            const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=fc4c02&color=fff&size=200`;
            const username = athlete.username ? `@${athlete.username}` : '';
            const location = [athlete.city, athlete.state, athlete.country].filter(Boolean).join(', ') || '-';
            const joined = athlete.created_at ? formatCreatedAt(athlete.created_at) : '-';
            const premiumBadge = athlete.premium
                ? '<span class="athlete-badge premium">Premium</span>'
                : '<span class="athlete-badge free">Free</span>';

            const stats = [
                { label: '体重', value: athlete.weight !== null && athlete.weight !== undefined ? athlete.weight.toFixed(1) + ' kg' : '-' },
                { label: 'FTP', value: athlete.ftp !== null && athlete.ftp !== undefined ? athlete.ftp + ' W' : '-' },
                { label: '关注者', value: athlete.follower_count !== null && athlete.follower_count !== undefined ? athlete.follower_count : '-' },
                { label: '好友', value: athlete.friend_count !== null && athlete.friend_count !== undefined ? athlete.friend_count : '-' },
                { label: '加入时间', value: joined },
            ];

            const statsHtml = stats.map(s => `
                <div class="athlete-stat">
                    <div class="label">${s.label}</div>
                    <div class="value">${s.value}</div>
                </div>
            `).join('');

            const bikes = Array.isArray(athlete.bikes) ? athlete.bikes : [];
            const shoes = Array.isArray(athlete.shoes) ? athlete.shoes : [];

            function buildGearSelectHtml(items, type, title) {
                if (!items.length) {
                    return `
                        <div class="athlete-card">
                            <div class="athlete-subsection-title">${title}</div>
                            <div class="zone-empty" style="padding:12px 0;font-size:13px;">暂无${title}数据</div>
                        </div>
                    `;
                }
                const options = items.map((item, i) => {
                    const name = escapeHtml(item.name || '-');
                    const dist = item.distance !== null && item.distance !== undefined ? formatDistance(item.distance) : '-';
                    const primaryTag = item.primary ? ' · 主用' : '';
                    return `<option value="${i}">${name} (${dist})${primaryTag}</option>`;
                }).join('');

                const details = items.map((item, i) => {
                    const name = escapeHtml(item.name || '-');
                    const dist = item.distance !== null && item.distance !== undefined ? formatDistance(item.distance) : '-';
                    const id = escapeHtml(item.id || '-');
                    const primary = item.primary ? '是' : '否';
                    return `
                        <div class="gear-detail ${i === 0 ? '' : 'hidden'}" id="${type}-detail-${i}">
                            <div><strong>名称：</strong>${name}</div>
                            <div><strong>累计里程：</strong>${dist}</div>
                            <div><strong>装备 ID：</strong>${id}</div>
                            <div><strong>主用：</strong>${primary}</div>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="athlete-card">
                        <div class="athlete-subsection-title">${title}</div>
                        <select class="gear-select" onchange="updateGearDetail(this, '${type}')">
                            ${options}
                        </select>
                        ${details}
                    </div>
                `;
            }

            function buildCompactZoneCard(zone) {
                const type = zone.type || 'heart_rate';
                const title = type === 'power' ? '功率区间' : '心率区间';
                const unit = type === 'power' ? 'W' : 'bpm';
                const buckets = zone.distribution_buckets
                    .map((b, i) => ({ ...b, index: i }))
                    .filter(b => b.max !== null || b.min !== null);
                if (!buckets.length) {
                    return `<div class="zone-card"><h3>${title}</h3><div class="zone-empty" style="font-size:13px;">暂无数据</div></div>`;
                }
                const definedMaxes = buckets.map(b => b.max).filter(v => v !== null && v !== undefined && v !== -1);
                const globalMax = definedMaxes.length ? Math.max(...definedMaxes) : Math.max(...buckets.map(b => (b.min || 0)));
                const tail = Math.max(type === 'power' ? 50 : 10, Math.round(globalMax * 0.08));
                const displayBuckets = buckets.map(b => {
                    const min = b.min !== null && b.min !== undefined ? b.min : 0;
                    const hasMax = b.max !== null && b.max !== undefined && b.max !== -1;
                    const max = hasMax ? b.max : (globalMax + tail);
                    return { ...b, min, max, hasMax };
                });
                const minBase = Math.min(...displayBuckets.map(b => b.min));
                const totalRange = Math.max(...displayBuckets.map(b => b.max)) - minBase;
                const effectiveTotal = totalRange > 0 ? totalRange : 1;
                const segments = displayBuckets.map((b, i) => {
                    const width = ((b.max - b.min) / effectiveTotal) * 100;
                    const color = zoneColors[i % zoneColors.length];
                    const rangeText = b.hasMax ? `${b.min}-${b.max}` : `${b.min}+`;
                    const label = width > 8 ? (b.hasMax ? String(b.max) : '+') : '';
                    const timeText = b.time ? ' · 时间 ' + formatTimeSeconds(b.time) : '';
                    return `<div class="zone-segment" style="flex:${Math.max(width, 1)};background:${color};" title="Z${i + 1}: ${rangeText} ${unit}${timeText}"><span class="segment-label">${label}</span></div>`;
                }).join('');
                const legend = displayBuckets.map((b, i) => {
                    const color = zoneColors[i % zoneColors.length];
                    const rangeText = b.hasMax ? `${b.min}-${b.max}` : `${b.min}+`;
                    const timeText = b.time ? formatTimeSeconds(b.time) : '-';
                    return `
                        <div class="zone-legend-item">
                            <div class="zone-dot" style="background:${color}"></div>
                            <span>Z${i + 1}: ${rangeText}</span>
                            <span class="zone-time">${timeText}</span>
                        </div>
                    `;
                }).join('');
                const note = zone.source === 'estimated'
                    ? `<span style="font-size:11px;color:#3182ce;font-weight:600;margin-left:6px;">估算</span>`
                    : (zone.custom_zones
                        ? '<span style="font-size:11px;color:#fc4c02;font-weight:600;margin-left:6px;">自定义</span>'
                        : '<span style="font-size:11px;color:#888;font-weight:600;margin-left:6px;">默认</span>');
                return `
                    <div class="zone-card">
                        <h3>${title}${note}</h3>
                        <div class="zone-bar">${segments}</div>
                        <div class="zone-legend">${legend}</div>
                    </div>
                `;
            }

            const bikesHtml = buildGearSelectHtml(bikes, 'bike', '自行车');
            const shoesHtml = buildGearSelectHtml(shoes, 'shoe', '跑鞋');

            let zones = [];
            if (Array.isArray(zonesData)) zones = zonesData;
            const hrZone = zones.find(z => z && z.type === 'heart_rate' && Array.isArray(z.distribution_buckets) && z.distribution_buckets.length > 0);
            const hrCard = hrZone ? buildCompactZoneCard(hrZone) : `<div class="zone-card"><h3>心率区间</h3><div class="zone-empty" style="font-size:13px;">暂无数据</div></div>`;

            const gearHtml = `
                <div class="athlete-gear-row">
                    ${bikesHtml}
                    ${shoesHtml}
                    ${hrCard}
                </div>
            `;

            const powerZones = zones.filter(z => z && z.type === 'power' && Array.isArray(z.distribution_buckets) && z.distribution_buckets.length > 0);
            const extraZonesHtml = powerZones.length ? `
                <div class="zones-panel" style="margin-top:18px;">
                    ${powerZones.map(z => buildCompactZoneCard(z)).join('')}
                </div>
            ` : '';

            return `
                <div class="athlete-section">
                    <div class="athlete-header">
                        <img src="${escapeHtml(avatarUrl)}" alt="avatar" class="athlete-avatar" onerror="this.src='${fallbackAvatar}'">
                        <div class="athlete-title">
                            <div class="athlete-name">${fullName} ${premiumBadge}</div>
                            ${username ? `<div class="athlete-username">${escapeHtml(username)}</div>` : ''}
                            <div class="athlete-location">📍 ${escapeHtml(location)}</div>
                            <div class="athlete-joined">加入时间：${joined}</div>
                        </div>
                    </div>
                    <div class="athlete-stats">${statsHtml}</div>
                    ${gearHtml}
                    ${extraZonesHtml}
                </div>
            `;
        }

        function updateGearDetail(select, type) {
            const parent = select.parentElement;
            const details = parent.querySelectorAll('.gear-detail');
            details.forEach(d => d.classList.add('hidden'));
            const target = parent.querySelector('#' + type + '-detail-' + select.value);
            if (target) target.classList.remove('hidden');
        }

        // --- 图表分析 ---
        async function ensureActivitiesSynced(force = false) {
            if (activitiesLoaded && !force) return allActivities;
            if (activitiesSyncPromise) return activitiesSyncPromise;

            activitiesSyncPromise = (async () => {
                const res = await fetch('/activities?fields=' + ACTIVITY_REQUEST_FIELDS);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || '活动同步失败');
                if (!Array.isArray(data)) throw new Error('活动数据格式无效');
                allActivities = data;
                activitiesLoaded = true;
                // 全局筛选栏的运动类型选项依赖活动数据
                populateGlobalSportOptions();
                return data;
            })();

            try {
                return await activitiesSyncPromise;
            } finally {
                activitiesSyncPromise = null;
            }
        }

        function buildChartControls() {
            // 年份/月份/运动类型已由顶部全局筛选栏接管，这里只保留图表自身指标
            const metricValue = currentRoute && currentRoute.params.metric ? currentRoute.params.metric : 'distance_km';

            return `
                <div id="athlete-profile-section"></div>
                <div class="filter-bar">
                    <div class="filter-group">
                        <label for="chart-metric">指标</label>
                        <select id="chart-metric">
                            <option value="count" ${metricValue === 'count' ? 'selected' : ''}>运动次数</option>
                            <option value="distance_km" ${metricValue === 'distance_km' ? 'selected' : ''}>距离 (km)</option>
                            <option value="moving_time_hours" ${metricValue === 'moving_time_hours' ? 'selected' : ''}>移动时长 (h)</option>
                            <option value="elevation_gain_m" ${metricValue === 'elevation_gain_m' ? 'selected' : ''}>爬升 (m)</option>
                        </select>
                    </div>
                </div>
                <div id="chart-summary" class="summary-cards"></div>
                <div class="chart-card">
                    <div class="chart-wrapper">
                        <canvas id="chartCanvas"></canvas>
                    </div>
                </div>
                <div class="chart-row">
                    <div class="chart-card">
                        <div class="chart-title">平均功率分布</div>
                        <div class="chart-wrapper" style="height:280px;">
                            <canvas id="powerDistCanvas"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <div class="chart-title">心率区间分布</div>
                        <div class="chart-wrapper" style="height:280px;">
                            <canvas id="hrZoneCanvas"></canvas>
                        </div>
                    </div>
                </div>
                <div class="chart-row" style="margin-top:20px;">
                    <div class="chart-card">
                        <div class="chart-title" id="top-elevation-title">骑行爬升 TOP20</div>
                        <div class="chart-wrapper" style="height:520px;">
                            <canvas id="topElevationCanvas"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <div class="chart-title" id="top-distance-title">骑行里程 TOP20</div>
                        <div class="chart-wrapper" style="height:520px;">
                            <canvas id="topDistanceCanvas"></canvas>
                        </div>
                    </div>
                </div>
            `;
        }

        async function renderAthleteProfileSection() {
            const section = document.getElementById('athlete-profile-section');
            if (!section) return;

            try {
                const [athleteRes, zonesRes] = await Promise.all([
                    fetch('/athlete'),
                    fetch('/athlete/zones')
                ]);

                const athlete = athleteRes.ok ? await athleteRes.json() : null;
                const zonesData = zonesRes.ok
                    ? await zonesRes.json()
                    : { error: '获取心率区间失败' };

                if (athlete && athlete.error) {
                    section.innerHTML = `<div style="color:#c00;padding:12px 0;">运动员信息加载失败：${escapeHtml(athlete.error)}</div>`;
                    return;
                }

                if (athlete) {
                    section.innerHTML = buildAthleteProfile(athlete, zonesData);
                }
            } catch (e) {
                section.innerHTML = `<div style="color:#c00;padding:12px 0;">运动员信息加载失败：${escapeHtml(e.message)}</div>`;
                console.error('加载运动员信息失败:', e);
            }
        }

        async function loadAthleteProfileOnly(btn) {
            setActiveMenu(btn);
            setLoading('运动员信息');

            try {
                const [athleteRes, zonesRes] = await Promise.all([
                    fetch('/athlete'),
                    fetch('/athlete/zones')
                ]);

                const athlete = athleteRes.ok ? await athleteRes.json() : null;
                const zonesData = zonesRes.ok
                    ? await zonesRes.json()
                    : { error: '获取心率区间失败' };

                if (athlete && athlete.error) {
                    setError('运动员信息', '获取失败: ' + athlete.error);
                    return;
                }

                if (!athlete) {
                    setError('运动员信息', '未能获取运动员信息');
                    return;
                }

                setHtml('运动员信息', buildAthleteProfile(athlete, zonesData));
            } catch (err) {
                setError('运动员信息', '请求出错: ' + err.message);
            }
        }

        async function loadChart(btn) {
            setActiveMenu(btn);
            setLoading('图表分析');

            try {
                await ensureActivitiesSynced();
            } catch (err) {
                setError('图表分析', '活动同步失败: ' + err.message);
                return;
            }

            populateGlobalSportOptions();
            setHtml('图表分析', buildChartControls());

            await renderAthleteProfileSection();

            // 指标切换：只更新 URL 参数与主图，不整页重载
            document.getElementById('chart-metric').addEventListener('change', e => {
                replaceParams({ metric: e.target.value });
                fetchAndRenderStats(e.target.value);
            });

            // 默认立即查询一次
            await fetchAndRenderStats(currentRoute.params.metric || 'distance_km');
        }

        function updateTopChartTitles(sportType) {
            const elevationTitle = document.getElementById('top-elevation-title');
            const distanceTitle = document.getElementById('top-distance-title');
            if (elevationTitle) {
                elevationTitle.textContent = sportType ? `${sportType} · 爬升 TOP20` : '骑行爬升 TOP20';
            }
            if (distanceTitle) {
                distanceTitle.textContent = sportType ? `${sportType} · 里程 TOP20` : '骑行里程 TOP20';
            }
        }

        async function fetchAndRenderStats(metric) {
            try {
                // 时间范围与运动类型来自顶部全局筛选栏（start/end + sport_type）
                const baseQs = globalDateQuery();

                const metricQs = [...baseQs, 'metric=' + encodeURIComponent(metric)];

                const mainUrl = '/chart?' + metricQs.join('&');
                const powerUrl = '/chart/power-distribution?' + baseQs.join('&');
                const hrUrl = '/chart/hr-zones?' + baseQs.join('&');
                const topElevationUrl = '/chart/top-elevation?' + baseQs.join('&');
                const topDistanceUrl = '/chart/top-distance?' + baseQs.join('&');

                const [mainRes, powerRes, hrRes, topElevationRes, topDistanceRes] = await Promise.all([
                    fetch(mainUrl),
                    fetch(powerUrl),
                    fetch(hrUrl),
                    fetch(topElevationUrl),
                    fetch(topDistanceUrl)
                ]);

                const [data, powerData, hrData, topElevationData, topDistanceData] = await Promise.all([
                    mainRes.json(),
                    powerRes.json(),
                    hrRes.json(),
                    topElevationRes.json(),
                    topDistanceRes.json()
                ]);

                if (!mainRes.ok) {
                    setError('图表分析', '获取失败: ' + (data.error || '未知错误'));
                    return;
                }

                updateTopChartTitles(globalFilters.sport);

                const summaryEl = document.getElementById('chart-summary');
                if (data.summary) {
                    summaryEl.innerHTML = `
                        <div class="metric-card">
                            <div class="label">运动次数</div>
                            <div class="value">${data.summary.count}</div>
                        </div>
                        <div class="metric-card">
                            <div class="label">总距离</div>
                            <div class="value">${data.summary.distance_km} km</div>
                        </div>
                        <div class="metric-card">
                            <div class="label">移动时长</div>
                            <div class="value">${data.summary.moving_time_hours} h</div>
                        </div>
                        <div class="metric-card">
                            <div class="label">总爬升</div>
                            <div class="value">${data.summary.elevation_gain_m} m</div>
                        </div>
                    `;
                } else {
                    summaryEl.innerHTML = '';
                }

                const labels = data.labels || [];
                // 后端现在返回每个时间点的全量指标序列，方便 tooltip 一并展示
                const series = data.series || { [metric]: data.values || [] };
                const values = (series[metric] || []).map(v => Number(v) || 0);

                if (!labels.length || !values.length) {
                    // 该筛选组合下没有数据：只清空主图，其余图表继续渲染，避免整页报错
                    ChartRegistry.destroy('main');
                    const emptyCtx = document.getElementById('chartCanvas').getContext('2d');
                    emptyCtx.clearRect(0, 0, emptyCtx.canvas.width, emptyCtx.canvas.height);
                } else {
                    renderChart(labels, series, metric || data.metric || 'metric');
                }

                if (powerRes.ok) {
                    renderPowerDist(powerData);
                }
                if (hrRes.ok) {
                    renderHRZones(hrData);
                }
                if (topElevationRes.ok) {
                    renderTopElevation(topElevationData);
                }
                if (topDistanceRes.ok) {
                    renderTopDistance(topDistanceData);
                }
            } catch (err) {
                setError('图表分析', '请求出错: ' + err.message);
            }
        }
