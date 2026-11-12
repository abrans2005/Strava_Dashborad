/* analysis.js — 单次活动分析面板（由 templates/dashboard.html 拆分） */

function buildAnalysisPanel(activity, data) {
            const summary = data.summary || {};
            const hasHR = data.has_hr;
            const hasWatts = data.has_watts;

            // 紧凑统计条：无数据的指标显示灰态
            const stats = [
                { label: '距离', value: formatDistance(activity.distance) },
                { label: '移动时长', value: formatTime(activity.moving_time) },
                { label: '爬升', value: formatElevation(activity.total_elevation_gain) },
                { label: '平均速度', value: summary.avg_velocity_kmh ? summary.avg_velocity_kmh + ' km/h' : '-' },
                { label: '平均心率', value: hasHR && summary.avg_heartrate ? summary.avg_heartrate + ' bpm' : null },
                { label: '平均功率', value: hasWatts && summary.avg_watts ? summary.avg_watts + ' W' : null },
            ];
            const statsHtml = stats.map(s => `
                <div class="astat${s.value === null ? ' muted' : ''}">
                    <b>${s.value === null ? '无数据' : s.value}</b>
                    <span>${s.label}</span>
                </div>
            `).join('');

            // 爬坡段与坡度图例收进地图卡底部
            const climbs = summary.climb_segments || [];
            const climbHtml = climbs.length
                ? climbs.map(c =>
                    `<span class="climb-tag">${c.start_km}-${c.end_km} km (${c.distance_km} km)</span>`).join('')
                : '<span class="climb-none">无显著爬坡段（>5%）</span>';
            const gradeChips = ROUTE_GRADE_BUCKETS
                .map(b => `<span class="grade-chip"><i style="background:${b.color};"></i>${b.label}</span>`)
                .join('')
                + `<span class="grade-chip"><i style="background:${ROUTE_COLOR_DEEP};opacity:.45;"></i>爬坡段 >5%</span>`;

            return `
                <div class="analysis-header">
                    <a class="analysis-back-link" onclick="backToActivityList()">← 返回列表</a>
                    <button class="btn-primary" onclick="openSegments('${activity.id}', '${escapeHtml(activity.name).replace(/'/g, "\\'")}')">赛段分析</button>
                </div>
                <div class="analysis-head-card">
                    <div class="analysis-title">${escapeHtml(activity.name)}</div>
                    <div class="analysis-date">${formatActivityDate(activity)}${activity.sport_type ? ' · ' + escapeHtml(activity.sport_type) : ''}</div>
                    <div class="analysis-stats-row">${statsHtml}</div>
                </div>
                <div class="section-title">概览</div>
                <div class="analysis-chart-card" style="margin-bottom:16px;">
                    <div class="chart-title">线路轨迹</div>
                    <div id="activityRouteMap" class="route-map route-map-activity"></div>
                    <div class="route-foot">
                        <div class="grade-chips">${gradeChips}</div>
                        <div class="climb-note">${climbHtml}</div>
                    </div>
                </div>
                <div class="section-title">数据曲线</div>
                <div class="analysis-chart-card analysis-full" id="elevationCard">
                    <div class="chart-title">海拔剖面 <span class="chart-sub">红色底纹为 &gt;5% 爬坡段</span></div>
                    <div class="analysis-chart-wrapper"><canvas id="elevationCanvas"></canvas></div>
                </div>
                <div class="analysis-grid">
                    <div class="analysis-chart-card" id="hrCard">
                        <div class="chart-title">心率曲线${hasHR && summary.avg_heartrate ? ` <span class="chart-sub">平均 ${summary.avg_heartrate} bpm</span>` : ''}</div>
                        <div class="analysis-chart-wrapper"><canvas id="hrCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card" id="powerCard">
                        <div class="chart-title">功率曲线${hasWatts && summary.avg_watts ? ` <span class="chart-sub">平均 ${summary.avg_watts} W</span>` : ''}</div>
                        <div class="analysis-chart-wrapper"><canvas id="powerCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card" id="speedCard">
                        <div class="chart-title">速度曲线${summary.avg_velocity_kmh ? ` <span class="chart-sub">平均 ${summary.avg_velocity_kmh} km/h</span>` : ''}</div>
                        <div class="analysis-chart-wrapper"><canvas id="speedCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card" id="hrZoneCard">
                        <div class="chart-title">心率区间分布</div>
                        <div class="analysis-chart-wrapper"><canvas id="hrZoneCanvas"></canvas></div>
                    </div>
                </div>
            `;
        }

        // 列表行「分析」入口：状态进 URL，可后退/分享
        function openActivityAnalysis(activityId) {
            navigate('activity/' + activityId);
        }

        function backToActivityList() {
            // 回到离开活动列表前的筛选与页码；focus 让列表定位到刚分析过的活动所在页
            navigate('activities', { ...lastListParams.activities, focus: lastAnalyzedActivityId || '' });
        }

        async function analyzeActivity(activityId) {
            setLoading('活动分析');
            lastAnalyzedActivityId = activityId;

            try {
                const [activities, streamsRes] = await Promise.all([
                    ensureActivitiesSynced(),
                    fetch(`/activities/${activityId}/streams`)
                ]);

                const streamsData = streamsRes.ok ? await streamsRes.json() : null;

                if (!streamsRes.ok) {
                    const errorMsg = streamsData && streamsData.error ? streamsData.error : '未知错误';
                    setHtml('活动分析', `
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            <div style="margin-bottom:16px;">获取流数据失败：${escapeHtml(errorMsg)}</div>
                            <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                        </div>
                    `);
                    return;
                }

                const activity = activities.find(a => String(a.id) === String(activityId));
                if (!activity) {
                    setHtml('活动分析', `
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            <div style="margin-bottom:16px;">未找到对应活动</div>
                            <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                        </div>
                    `);
                    return;
                }

                setHtml('活动分析', buildAnalysisPanel(activity, streamsData));
                renderAnalysisCharts(streamsData);
            } catch (err) {
                setHtml('活动分析', `
                    <div style="color:#c00;padding:20px 0;text-align:center;">
                        <div style="margin-bottom:16px;">请求出错：${escapeHtml(err.message)}</div>
                        <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                    </div>
                `);
            }
        }
